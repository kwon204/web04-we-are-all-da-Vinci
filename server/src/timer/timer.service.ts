import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import os from 'node:os';
import {
  TimerCacheService,
  TimerSnapshot,
} from 'src/redis/cache/timer-cache.service';
import type { RoomTimerDto } from '@shared/types';

@Injectable()
export class TimerService implements OnModuleInit, OnModuleDestroy {
  private globalIntervalId?: NodeJS.Timeout;
  private onTimerTickCallback?: (payload: RoomTimerDto) => void;
  private onTimerEndCallback?: (roomId: string) => Promise<void>;
  private readonly serverInstanceId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly timerCacheService: TimerCacheService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TimerService.name);

    this.serverInstanceId =
      this.configService.get<string>('SERVER_INSTANCE_ID') ??
      this.configService.get<string>('TIMER_SERVER_ID') ??
      `${os.hostname()}:${process.pid}`;
  }

  onModuleInit() {
    this.startGlobalTimer();
  }

  onModuleDestroy() {
    if (this.globalIntervalId) {
      clearInterval(this.globalIntervalId);
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
    const expiredTimerBatch = await this.timerCacheService.popExpiredTimers();

    for (const timer of expiredTimerBatch.timers) {
      const timeLeft = await this.timerCacheService.decrementTimer(
        timer.roomId,
      );

      if (timeLeft === null) {
        await this.timerCacheService.deleteTimer(timer.roomId);
        continue;
      }

      if (timeLeft > 0) {
        await this.timerCacheService.scheduleTimer(
          timer.roomId,
          timer.round,
          timer.scheduledAt + 1000,
        );
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
    timer: Pick<TimerSnapshot, 'roomId' | 'round' | 'scheduledAt'>,
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
}
