import {
  Injectable,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class DynamicConfigService
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly SERVER_STATE = {
    PENDING: 'pending',
    RUNNING: 'running',
    GRANING: 'graning',
    TERMINATED: 'terminated',
  };

  private state;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DynamicConfigService.name);
    this.state = this.SERVER_STATE.PENDING;
  }

  onModuleInit() {
    this.state = this.SERVER_STATE.RUNNING;
  }

  onModuleDestroy() {
    this.state = this.SERVER_STATE.GRANING;
  }

  onApplicationShutdown(signal?: string) {
    this.logger.info({ signal }, 'onApplicationShutdown');
    this.state = this.SERVER_STATE.TERMINATED;
  }

  isGraining() {
    return this.state === this.SERVER_STATE.GRANING;
  }
}
