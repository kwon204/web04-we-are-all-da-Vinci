import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";
import { validateChanceWhitelistEnv } from "./common/config/env.validation";
import { createLoggerParams } from "./common/logging/logger.config";
import { ExternalModule } from "./external/external.module";
import config from "./mikro-orm.config";
import { PointGrantWorkerModule } from "./modules/point/point-grant-worker.module";

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
