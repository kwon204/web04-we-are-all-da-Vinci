import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";
import { validateChanceWhitelistEnv } from "@server-toss/platform/common/config/env.validation";
import { createLoggerParams } from "@server-toss/platform/common/logging/logger.config";
import { ExternalModule } from "@server-toss/toss-integration/external/external.module";
import config from "@server-toss/database/mikro-orm.config";
import { PointGrantWorkerModule } from "@server-toss/domain/modules/point/point-grant-worker.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
      validate: validateChanceWhitelistEnv,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return createLoggerParams({
          nodeEnv: configService.get<string>("NODE_ENV"),
          logLevel: configService.get<string>("LOG_LEVEL"),
        });
      },
    }),
    MikroOrmModule.forRoot(config),
    ExternalModule.register(),
    ScheduleModule.forRoot(),
    PointGrantWorkerModule,
  ],
})
export class PointWorkerModule {}
