import { Injectable } from '@nestjs/common';
import { RedisKeys } from '../redis-keys';
import { RedisService } from '../redis.service';

interface Timer {
  roomId: string;
  timeLeft: number;
}

@Injectable()
export class TimerCacheService {
  constructor(private readonly redisService: RedisService) {}

  async addTimer(roomId: string, timeLeft: number) {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);
    const zKey = RedisKeys.timers();

    await Promise.all([
      client.hSet(key, { roomId, timeLeft }),
      client.zAdd(zKey, { score: Date.now(), value: roomId }),
    ]);
  }

  async getTimer(roomId: string): Promise<Timer | null> {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);
    const data = await client.hGetAll(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return { roomId: data.roomId, timeLeft: parseInt(data.timeLeft) };
  }

  async getAllTimers(): Promise<{ roomId: string; timestamp: number }[]> {
    const client = this.redisService.getClient();
    const zKey = RedisKeys.timers();

    const now = Date.now();

    const results = await Promise.all([
      client.zRangeByScoreWithScores(zKey, 0, now),
      client.zRemRangeByScore(zKey, 0, now),
    ]);

    const timers = results[0].map((timer) => ({
      roomId: timer.value,
      timestamp: timer.score,
    }));

    return timers;
  }

  async decrementTimer(roomId: string) {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);

    const timeLeft = await client.hIncrBy(key, 'timeLeft', -1);

    // 타이머가 처음 등록된 케이스
    if (timeLeft === -1) {
      await client.unlink(key);
      return null;
    }

    return timeLeft;
  }

  async deleteTimer(roomId: string) {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);
    const zKey = RedisKeys.timers();
    await Promise.all([client.unlink(key), client.zRem(zKey, roomId)]);
  }

  async scheduleTimer(roomId: string, timestamp: number) {
    const client = this.redisService.getClient();
    const zKey = RedisKeys.timers();
    await client.zAdd(zKey, { score: timestamp, value: roomId });
  }
}
