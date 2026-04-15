import { Injectable } from '@nestjs/common';
import { RedisKeys } from '../redis-keys';
import { RedisService } from '../redis.service';

export interface TimerSnapshot {
  roomId: string;
  round: number;
  timeLeft: number;
  scheduledAt: number;
}

export interface ExpiredTimerSnapshot {
  roomId: string;
  round: number;
  scheduledAt: number;
}

export interface ExpiredTimerBatch {
  timers: ExpiredTimerSnapshot[];
}

@Injectable()
export class TimerCacheService {
  constructor(private readonly redisService: RedisService) {}

  private encodeTimerMember(roomId: string, round: number) {
    return JSON.stringify({ roomId, round });
  }

  private decodeTimerMember(value: string): { roomId: string; round: number } {
    try {
      const parsed = JSON.parse(value) as {
        roomId?: unknown;
        round?: unknown;
      };

      if (typeof parsed.roomId === 'string') {
        return {
          roomId: parsed.roomId,
          round: Number(parsed.round) || 0,
        };
      }
    } catch {
      // Fall through to legacy roomId-only member values.
    }

    return {
      roomId: value,
      round: 0,
    };
  }

  async registerTimer(roomId: string, round: number, timeLeft: number) {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);
    const zKey = RedisKeys.timers();
    const scheduledAt = Date.now();

    await client
      .multi()
      .hSet(key, {
        roomId,
        round: String(round),
        timeLeft: String(timeLeft),
        scheduledAt: String(scheduledAt),
      })
      .zAdd(zKey, {
        score: scheduledAt,
        value: this.encodeTimerMember(roomId, round),
      })
      .exec();

    return {
      roomId,
      round,
      timeLeft,
      scheduledAt,
    };
  }

  async getTimer(roomId: string): Promise<TimerSnapshot | null> {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);
    const data = await client.hGetAll(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      roomId: data.roomId || roomId,
      round: Number.parseInt(data.round, 10) || 0,
      timeLeft: Number.parseInt(data.timeLeft, 10) || 0,
      scheduledAt: Number.parseInt(data.scheduledAt, 10) || Date.now(),
    };
  }

  async popExpiredTimers(): Promise<ExpiredTimerBatch> {
    const client = this.redisService.getClient();
    const zKey = RedisKeys.timers();
    const now = Date.now();

    const result = await client
      .multi()
      .zRangeByScoreWithScores(zKey, 0, now)
      .zRemRangeByScore(zKey, 0, now)
      .exec();
    const dueTimers = (
      (result?.[0] as unknown as Array<{
        value: string;
        score: number;
      }> | null) ?? []
    ).filter(Boolean);

    return {
      timers: dueTimers.map((timer) => {
        const member = this.decodeTimerMember(timer.value);

        return {
          roomId: member.roomId,
          round: member.round,
          scheduledAt: Number(timer.score) || now,
        };
      }),
    };
  }

  async decrementTimer(roomId: string) {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);

    const timeLeft = await client.hIncrBy(key, 'timeLeft', -1);

    if (timeLeft == -1) {
      return null;
    }
    return timeLeft;
  }

  async deleteTimer(roomId: string) {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);
    const zKey = RedisKeys.timers();

    await client.multi().unlink(key).zRem(zKey, roomId).exec();
  }

  async scheduleTimer(roomId: string, round: number, timestamp: number) {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);
    const zKey = RedisKeys.timers();

    await client
      .multi()
      .hSet(key, {
        scheduledAt: String(timestamp),
      })
      .zAdd(zKey, {
        score: timestamp,
        value: this.encodeTimerMember(roomId, round),
      })
      .exec();
  }
}
