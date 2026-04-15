import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { RedisKeys } from '../redis-keys';
import { RedisService } from '../redis.service';

export type BenchmarkMode = 'baseline' | 'improved' | 'profile';

export interface TimerSnapshot {
  roomId: string;
  round: number;
  timeLeft: number;
  scheduledAt: number;
}

export interface ExpiredTimerBatch {
  timers: TimerSnapshot[];
  profileMetrics?: {
    luaEvalMs: number;
    luaQueryMs: number;
    luaDeleteMs: number;
    hydrateMs: number;
  };
}

type DiscoveredDueTimers =
  | {
      roomIds: string[];
      profileMetrics?: ExpiredTimerBatch['profileMetrics'];
    }
  | string[];

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

  async popExpiredTimers(
    mode: BenchmarkMode = 'improved',
  ): Promise<ExpiredTimerBatch> {
    const client = this.redisService.getClient();
    const zKey = RedisKeys.timers();

    const now = Date.now();
    const discoverDueRoomIds = async (): Promise<DiscoveredDueTimers> => {
      if (mode === 'baseline') {
        const result = await client
          .multi()
          .zRangeByScore(zKey, 0, now)
          .zRemRangeByScore(zKey, 0, now)
          .exec();

        return ((result?.[0] as unknown as string[] | null) ?? []).filter(
          Boolean,
        );
      }

      const luaScript =
        mode === 'profile'
          ? `
      local zKey = KEYS[1]
      local now = tonumber(ARGV[1])

      local function toMicros(timeParts)
        return (tonumber(timeParts[1]) * 1000000) + tonumber(timeParts[2])
      end

      local startedAt = redis.call("TIME")
      local rangeResult = redis.call("ZRANGEBYSCORE", zKey, 0, now)
      local queryFinishedAt = redis.call("TIME")
      local removedCount = redis.call("ZREMRANGEBYSCORE", zKey, 0, now)
      local deletedAt = redis.call("TIME")

      return cjson.encode({
        timers = rangeResult,
        queryMicros = toMicros(queryFinishedAt) - toMicros(startedAt),
        deleteMicros = toMicros(deletedAt) - toMicros(queryFinishedAt),
        removedCount = removedCount,
      })
    `
          : `
      local zKey = KEYS[1]
      local now = tonumber(ARGV[1])

      local rangeResult = redis.call("ZRANGEBYSCORE", zKey, 0, now)
      redis.call("ZREMRANGEBYSCORE", zKey, 0, now)

      return cjson.encode({
        timers = rangeResult,
      })
    `;

      const luaStartedAt = performance.now();
      const result = await client.eval(luaScript, {
        keys: [zKey],
        arguments: [String(now)],
      });
      const luaEvalMs = performance.now() - luaStartedAt;
      const rawResult = result as string;

      if (mode !== 'profile') {
        const parsed = JSON.parse(rawResult) as {
          timers: string[];
        };

        return {
          roomIds: parsed.timers.filter(Boolean),
        };
      }

      const parsed = JSON.parse(rawResult) as {
        timers: string[];
        queryMicros: number;
        deleteMicros: number;
        removedCount: number;
      };

      return {
        roomIds: parsed.timers.filter(Boolean),
        profileMetrics: {
          luaEvalMs,
          luaQueryMs: parsed.queryMicros / 1000,
          luaDeleteMs: parsed.deleteMicros / 1000,
          hydrateMs: 0,
        },
      };
    };

    const discovered = await discoverDueRoomIds();
    const roomIds = Array.isArray(discovered) ? discovered : discovered.roomIds;

    const hydrateStartedAt = performance.now();
    const timerSnapshots = await Promise.all(
      roomIds.map(async (roomId) => {
        const data = await client.hGetAll(RedisKeys.timer(roomId));

        if (!data || Object.keys(data).length === 0) {
          return {
            roomId,
            round: 0,
            timeLeft: 0,
            scheduledAt: now,
          };
        }

        return {
          roomId: data.roomId || roomId,
          round: Number.parseInt(data.round, 10) || 0,
          timeLeft: Number.parseInt(data.timeLeft, 10) || 0,
          scheduledAt: Number.parseInt(data.scheduledAt, 10) || now,
        };
      }),
    );
    const hydrateMs = performance.now() - hydrateStartedAt;

    if (mode !== 'profile') {
      return {
        timers: timerSnapshots,
      };
    }

    return {
      timers: timerSnapshots,
      profileMetrics: {
        luaEvalMs: !Array.isArray(discovered)
          ? (discovered.profileMetrics?.luaEvalMs ?? 0)
          : 0,
        luaQueryMs: !Array.isArray(discovered)
          ? (discovered.profileMetrics?.luaQueryMs ?? 0)
          : 0,
        luaDeleteMs: !Array.isArray(discovered)
          ? (discovered.profileMetrics?.luaDeleteMs ?? 0)
          : 0,
        hydrateMs,
      },
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
