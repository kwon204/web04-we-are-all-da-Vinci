import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import {
  TimerCacheService,
  TimerSnapshot,
} from 'src/redis/cache/timer-cache.service';
import type { BenchmarkMode } from 'src/redis/cache/timer-cache.service';
import { RedisService } from 'src/redis/redis.service';
import type { RoomTimerDto } from '@shared/types';

@Injectable()
export class TimerService implements OnModuleInit, OnModuleDestroy {
  private globalIntervalId?: NodeJS.Timeout;
  private onTimerTickCallback?: (payload: RoomTimerDto) => void;
  private onTimerEndCallback?: (roomId: string) => Promise<void>;
  private readonly serverInstanceId: string;
  private readonly benchmarkMode: BenchmarkMode;
  private readonly benchmarkRunId?: string;
  private readonly benchmarkEventKey?: string;
  private readonly benchmarkProfileEventKey?: string;
  private readonly benchmarkProfileWriteBackEventKey?: string;
  private readonly eventLoopDelayMonitor?: ReturnType<
    typeof monitorEventLoopDelay
  >;
  private lastCpuUsage = process.cpuUsage();

  constructor(
    private readonly configService: ConfigService,
    private readonly timerCacheService: TimerCacheService,
    private readonly redisService: RedisService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TimerService.name);

    this.serverInstanceId =
      this.configService.get<string>('SERVER_INSTANCE_ID') ??
      this.configService.get<string>('TIMER_SERVER_ID') ??
      `${os.hostname()}:${process.pid}`;

    this.benchmarkMode = this.normalizeBenchmarkMode(
      this.configService.get<string>('BENCHMARK_MODE'),
    );

    this.benchmarkRunId = this.configService.get<string>(
      'TIMER_BENCHMARK_RUN_ID',
    );

    if (this.benchmarkRunId) {
      this.benchmarkEventKey = `test:${this.benchmarkRunId}:timer:ticks`;
      if (this.benchmarkMode === 'profile') {
        this.benchmarkProfileEventKey = `test:${this.benchmarkRunId}:timer:profile`;
        this.benchmarkProfileWriteBackEventKey = `test:${this.benchmarkRunId}:timer:profile:writeback`;
      }
      this.eventLoopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
      this.eventLoopDelayMonitor.enable();
    }
  }

  onModuleInit() {
    this.startGlobalTimer();
  }

  onModuleDestroy() {
    if (this.globalIntervalId) {
      clearInterval(this.globalIntervalId);
    }

    if (this.eventLoopDelayMonitor) {
      this.eventLoopDelayMonitor.disable();
    }
  }

  setOnTimerTick(callback: (payload: RoomTimerDto) => void) {
    this.onTimerTickCallback = callback;
  }

  setOnTimerEnd(callback: (roomId: string) => Promise<void>) {
    this.onTimerEndCallback = callback;
  }

  startGlobalTimer() {
    this.globalIntervalId = setInterval(() => {
      void this.tick().catch((error: Error) => {
        this.logger.error({ error }, 'Timer tick failed');
      });
    }, 1000);
    this.logger.info('Global Timer Started');
  }

  async tick() {
    const tickStartedAt = performance.now();
    const cpuUsageBeforeTick = this.lastCpuUsage;
    const scanStartedAt = performance.now();
    const expiredTimerBatch = await this.timerCacheService.popExpiredTimers(
      this.benchmarkMode,
    );
    const scanMs = performance.now() - scanStartedAt;

    let decrementMs = 0;
    let unlinkMs = 0;
    let rescheduleMs = 0;

    for (const timer of expiredTimerBatch.timers) {
      const decrementStartedAt = performance.now();
      const timeLeft = await this.timerCacheService.decrementTimer(
        timer.roomId,
      );
      decrementMs += performance.now() - decrementStartedAt;

      if (timeLeft === null) {
        const unlinkStartedAt = performance.now();
        await this.timerCacheService.deleteTimer(timer.roomId);
        unlinkMs += performance.now() - unlinkStartedAt;
        continue;
      }

      if (timeLeft > 0) {
        const rescheduleStartedAt = performance.now();
        await this.timerCacheService.scheduleTimer(
          timer.roomId,
          timer.scheduledAt + 1000,
        );
        rescheduleMs += performance.now() - rescheduleStartedAt;
      }

      const processedAt = Date.now();
      const payload = this.createTimerPayload(timer, timeLeft, processedAt);

      if (timeLeft >= 0 && this.onTimerTickCallback) {
        // Gateway에 알림
        this.onTimerTickCallback(payload);
      }

      if (timeLeft === 0 && this.onTimerEndCallback) {
        try {
          await this.onTimerEndCallback(timer.roomId);
        } catch (err) {
          this.logger.error(
            { roomId: timer.roomId, err },
            'Timer end callback failed. Remove Timer',
          );
          const unlinkStartedAt = performance.now();
          await this.timerCacheService.deleteTimer(timer.roomId);
          unlinkMs += performance.now() - unlinkStartedAt;
        }
      }
    }

    const tickEndedAt = performance.now();
    const cpuUsage = process.cpuUsage(cpuUsageBeforeTick);
    this.lastCpuUsage = process.cpuUsage();

    const commonSample = {
      benchmarkMode: this.benchmarkMode,
      tickStartedAt,
      tickEndedAt,
      scanMs,
      decrementMs,
      unlinkMs,
      rescheduleMs,
      timersProcessed: expiredTimerBatch.timers.length,
      cpuUserMs: cpuUsage.user / 1000,
      cpuSystemMs: cpuUsage.system / 1000,
      eventLoopDelayMs: this.eventLoopDelayMonitor
        ? this.eventLoopDelayMonitor.max / 1_000_000
        : null,
    };

    await this.recordBenchmarkTick(commonSample);

    if (
      this.benchmarkMode === 'profile' &&
      this.benchmarkProfileEventKey &&
      this.benchmarkProfileWriteBackEventKey
    ) {
      await this.recordBenchmarkProfileTick({
        ...commonSample,
        ...expiredTimerBatch.profileMetrics,
      });
    }

    if (this.eventLoopDelayMonitor) {
      this.eventLoopDelayMonitor.reset();
    }
  }

  async startTimer(roomId: string, round: number, timeLeft: number) {
    const timer = await this.timerCacheService.registerTimer(
      roomId,
      round,
      timeLeft,
    );

    // 초기 타이머 값 즉시 브로드캐스트 (1초 대기 없이)
    if (this.onTimerTickCallback) {
      this.onTimerTickCallback(
        this.createTimerPayload(timer, timeLeft, Date.now()),
      );
    }
    this.logger.info({ roomId, timeLeft }, 'Start Timer');
  }

  async cancelTimer(roomId: string) {
    await this.timerCacheService.deleteTimer(roomId);
  }

  async getRecoveryTimerPayload(roomId: string): Promise<RoomTimerDto | null> {
    const timer = await this.timerCacheService.getTimer(roomId);
    if (!timer) return null;

    const now = Date.now();
    return this.createTimerPayload(timer, timer.timeLeft, now);
  }

  private createTimerPayload(
    timer: TimerSnapshot,
    timeLeft: number,
    processedAt: number,
  ): RoomTimerDto {
    return {
      roomId: timer.roomId,
      round: timer.round,
      timeLeft,
      scheduledAt: timer.scheduledAt,
      processedAt,
      serverSentAt: processedAt,
      processedByServerId: this.serverInstanceId,
    };
  }

  private normalizeBenchmarkMode(value?: string | null): BenchmarkMode {
    const normalized = value?.toLowerCase();
    if (
      normalized === 'baseline' ||
      normalized === 'improved' ||
      normalized === 'profile'
    ) {
      return normalized;
    }

    return 'improved';
  }

  private async recordBenchmarkTick(sample: {
    benchmarkMode: BenchmarkMode;
    tickStartedAt: number;
    tickEndedAt: number;
    scanMs: number;
    decrementMs: number;
    unlinkMs: number;
    rescheduleMs: number;
    timersProcessed: number;
    cpuUserMs: number;
    cpuSystemMs: number;
    eventLoopDelayMs: number | null;
  }) {
    if (!this.benchmarkEventKey) {
      return;
    }

    try {
      const client = this.redisService.getClient();
      await client.rPush(
        this.benchmarkEventKey,
        JSON.stringify({
          ...sample,
          totalTickMs: sample.tickEndedAt - sample.tickStartedAt,
          cpuTotalMs: sample.cpuUserMs + sample.cpuSystemMs,
          serverInstanceId: this.serverInstanceId,
          capturedAt: Date.now(),
        }),
      );
    } catch (error) {
      this.logger.warn({ error }, 'Failed to write timer benchmark sample');
    }
  }

  private async recordBenchmarkProfileTick(sample: {
    benchmarkMode: BenchmarkMode;
    tickStartedAt: number;
    tickEndedAt: number;
    scanMs: number;
    decrementMs: number;
    unlinkMs: number;
    rescheduleMs: number;
    timersProcessed: number;
    cpuUserMs: number;
    cpuSystemMs: number;
    eventLoopDelayMs: number | null;
    luaEvalMs?: number;
    luaQueryMs?: number;
    luaDeleteMs?: number;
    hydrateMs?: number;
  }) {
    if (
      !this.benchmarkProfileEventKey ||
      !this.benchmarkProfileWriteBackEventKey
    ) {
      return;
    }

    try {
      const client = this.redisService.getClient();
      const writeBackStartedAt = performance.now();
      const profilePayload = JSON.stringify({
        ...sample,
        totalTickMs: sample.tickEndedAt - sample.tickStartedAt,
        cpuTotalMs: sample.cpuUserMs + sample.cpuSystemMs,
        serverInstanceId: this.serverInstanceId,
        capturedAt: Date.now(),
      });
      await client.rPush(this.benchmarkProfileEventKey, profilePayload);
      const writeBackMs = performance.now() - writeBackStartedAt;

      await client.rPush(
        this.benchmarkProfileWriteBackEventKey,
        String(writeBackMs),
      );
    } catch (error) {
      this.logger.warn(
        { error },
        'Failed to write timer profile benchmark sample',
      );
    }
  }
}
