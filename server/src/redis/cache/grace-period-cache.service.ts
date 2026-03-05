import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis.service';

const GRACE_PERIOD_TTL = 3; // 3초 유예 시간

export interface GracePeriodData {
  socketId: string;
  profileId: string;
  roomId: string;
  nickname: string;
}

@Injectable()
export class GracePeriodCacheService {
  constructor(private readonly redisService: RedisService) {}

  async set(
    roomId: string,
    profileId: string,
    socketId: string,
    nickname: string,
  ): Promise<void> {
    const client = this.redisService.getClient();
    // const key = RedisKeys.gracePeriod(roomId, profileId, socketId);

    // const data: GracePeriodData = {
    //   oldSocketId: socketId,
    //   disconnectedAt: Date.now(),
    // };

    const key = `gracePeriod`;
    const data = JSON.stringify({ roomId, profileId, socketId, nickname });

    await client.zAdd(key, {
      score: Date.now() + GRACE_PERIOD_TTL * 1000,
      value: data,
    });
    // await client.setEx(key, GRACE_PERIOD_TTL, JSON.stringify(data));
  }

  // async get(
  //   roomId: string,
  //   profileId: string,
  //   socketId: string,
  // ): Promise<GracePeriodData | null> {
  //   const client = this.redisService.getClient();
  //   const key = RedisKeys.gracePeriod(roomId, profileId, socketId);

  //   const data = await client.get(key);
  //   if (!data) return null;

  //   return JSON.parse(data) as GracePeriodData;
  // }

  async exists(
    roomId: string,
    profileId: string,
    socketId: string,
    nickname: string,
  ): Promise<boolean> {
    const client = this.redisService.getClient();
    // const key = RedisKeys.gracePeriod(roomId, profileId, socketId);
    const key = `gracePeriod`;
    const data = JSON.stringify({ roomId, profileId, socketId, nickname });

    return (await client.zScore(key, data)) !== null;
  }

  async delete(
    roomId: string,
    profileId: string,
    socketId: string,
    nickname: string,
  ): Promise<void> {
    const client = this.redisService.getClient();
    const key = `gracePeriod`;
    const data = JSON.stringify({ roomId, profileId, socketId, nickname });

    await client.zRem(key, data);
  }

  async getUntil(time: number) {
    const client = this.redisService.getClient();
    const key = `key`;

    const [rangeResult] = await client
      .multi()
      .zRangeByScore(key, -1, time)
      .zRemRangeByScore(key, -1, time)
      .exec<'typed'>();

    return rangeResult.map((result) => JSON.parse(result) as GracePeriodData);
  }
}
