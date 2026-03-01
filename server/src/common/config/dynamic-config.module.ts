import { Module } from '@nestjs/common';
import { DynamicConfigService } from './dynamic-config.service';

@Module({ providers: [DynamicConfigService], exports: [DynamicConfigService] })
export class DynamicConfigModule {}
