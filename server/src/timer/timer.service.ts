import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import {
  TimerCacheService,
  TimerSnapshot,
} from 'src/redis/cache/timer-cache.service';
import { RedisService } from 'src/redis/redis.service';
import type { RoomTimerDto } from '@shared/types';

@Injectable()
export class TimerService implements OnModuleInit, OnModuleDestroy {
  private globalIntervalId?: NodeJS.Timeout;
  private onTimerTickCallback?: (payload: RoomTimerDto) => void;
  private onTimerEndCallback?: (roomId: string) => Promise<void>;
  private readonly serverInstanceId: string;
  private readonly benchmarkRunId?: string;
  private readonly benchmarkEventKey?: string;
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

    this.benchmarkRunId = this.configService.get<string>(
      'TIMER_BENCHMARK_RUN_ID',
    );

    if (this.benchmarkRunId) {
      this.benchmarkEventKey = `test:${this.benchmarkRunId}:timer:ticks`;
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
    const expiredTimerBatch = await this.timerCacheService.popExpiredTimers();
    const dueTimerQueryMs = expiredTimerBatch.queryMicros / 1000;
    const queryDeleteMs =
      (expiredTimerBatch.queryMicros + expiredTimerBatch.deleteMicros) / 1000;

    let decrementMs = 0;
    let rescheduleMs = 0;

    for (const timer of expiredTimerBatch.timers) {
      const decrementStartedAt = performance.now();
      const timeLeft = await this.timerCacheService.decrementTimer(
        timer.roomId,
      );
      decrementMs += performance.now() - decrementStartedAt;

      if (timeLeft === null) {
        await this.timerCacheService.deleteTimer(timer.roomId);
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
          await this.timerCacheService.deleteTimer(timer.roomId);
        }
      }
    }

    const tickEndedAt = performance.now();
    const cpuUsage = process.cpuUsage(cpuUsageBeforeTick);
    this.lastCpuUsage = process.cpuUsage();

    await this.recordBenchmarkTick({
      tickStartedAt,
      tickEndedAt,
      dueTimerQueryMs,
      queryDeleteMs,
      decrementMs,
      rescheduleMs,
      timersProcessed: expiredTimerBatch.timers.length,
      cpuUserMs: cpuUsage.user / 1000,
      cpuSystemMs: cpuUsage.system / 1000,
      eventLoopDelayMs: this.eventLoopDelayMonitor
        ? this.eventLoopDelayMonitor.max / 1_000_000
        : null,
    });
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

  private async recordBenchmarkTick(sample: {
    tickStartedAt: number;
    tickEndedAt: number;
    dueTimerQueryMs: number;
    queryDeleteMs: number;
    decrementMs: number;
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
    } finally {
      if (this.eventLoopDelayMonitor) {
        this.eventLoopDelayMonitor.reset();
      }
    }
  }
}
