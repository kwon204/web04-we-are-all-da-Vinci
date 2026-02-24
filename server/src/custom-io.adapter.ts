import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import { Server, ServerOptions } from 'socket.io';
import { RedisService } from './redis/redis.service';
import { INestApplication } from '@nestjs/common';

export class CustomIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(app: INestApplication, redisService: RedisService) {
    super(app);
    this.adapterConstructor = createAdapter(redisService.getClient());
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      connectionStateRecovery: {
        // the backup duration of the sessions and the packets
        maxDisconnectionDuration: 2 * 60 * 1000,
        // whether to skip middlewares upon successful recovery
        skipMiddlewares: true,
      },
    } as ServerOptions) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
