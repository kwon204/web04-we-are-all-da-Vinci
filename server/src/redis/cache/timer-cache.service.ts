import { Injectable } from '@nestjs/common';
import { RedisKeys } from '../redis-keys';
import { RedisService } from '../redis.service';

export interface TimerSnapshot {
  roomId: string;
  round: number;
  timeLeft: number;
  scheduledAt: number;
}

export interface ExpiredTimerBatch {
  timers: TimerSnapshot[];
  queryMicros: number;
  deleteMicros: number;
}

@Injectable()
export class TimerCacheService {
  constructor(private readonly redisService: RedisService) {}

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
      .zAdd(zKey, { score: scheduledAt, value: roomId })
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

    const luaScript = `
      local zKey = KEYS[1]
      local now = tonumber(ARGV[1])

      local function toMicros(timeParts)
        return (tonumber(timeParts[1]) * 1000000) + tonumber(timeParts[2])
      end

      local startedAt = redis.call("TIME")
      local rangeResult = redis.call("ZRANGEBYSCORE", zKey, 0, now, "WITHSCORES")
      local queryFinishedAt = redis.call("TIME")
      local removedCount = redis.call("ZREMRANGEBYSCORE", zKey, 0, now)
      local deletedAt = redis.call("TIME")

      local timers = {}
      for index = 1, #rangeResult, 2 do
        table.insert(timers, {
          roomId = rangeResult[index],
          timestamp = tonumber(rangeResult[index + 1]),
        })
      end

      return cjson.encode({
        timers = timers,
        queryMicros = toMicros(queryFinishedAt) - toMicros(startedAt),
        deleteMicros = toMicros(deletedAt) - toMicros(queryFinishedAt),
        removedCount = removedCount,
      })
    `;

    const result = await client.eval(luaScript, {
      keys: [zKey],
      arguments: [String(now)],
    });

    const parsed = JSON.parse(result as string) as {
      timers: Array<{ roomId: string; timestamp: number }>;
      queryMicros: number;
      deleteMicros: number;
      removedCount: number;
    };

    const timerSnapshots = await Promise.all(
      parsed.timers.map(async (timer) => {
        const data = await client.hGetAll(RedisKeys.timer(timer.roomId));

        if (!data || Object.keys(data).length === 0) {
          return {
            roomId: timer.roomId,
            round: 0,
            timeLeft: 0,
            scheduledAt: timer.timestamp,
          };
        }

        return {
          roomId: data.roomId,
          round: Number.parseInt(data.round, 10) || 0,
          timeLeft: Number.parseInt(data.timeLeft, 10) || 0,
          scheduledAt: Number.parseInt(data.scheduledAt, 10) || timer.timestamp,
        };
      }),
    );

    return {
      timers: timerSnapshots,
      queryMicros: parsed.queryMicros,
      deleteMicros: parsed.deleteMicros,
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

  async scheduleTimer(roomId: string, timestamp: number) {
    const client = this.redisService.getClient();
    const key = RedisKeys.timer(roomId);
    const zKey = RedisKeys.timers();

    await client
      .multi()
      .hSet(key, {
        scheduledAt: String(timestamp),
      })
      .zAdd(zKey, { score: timestamp, value: roomId })
      .exec();
  }
}
