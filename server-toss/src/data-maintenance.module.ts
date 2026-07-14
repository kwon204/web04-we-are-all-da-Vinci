import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { validateChanceWhitelistEnv } from "./common/config/env.validation";
import { createLoggerParams } from "./common/logging/logger.config";
import config from "./mikro-orm.config";
import { Drawing } from "./modules/drawing/drawing.entity";
import { DailyUserRanking } from "./modules/dailyRanking/daily-user-ranking.entity";
import { DailyRankingSnapshotService } from "./modules/dailyRanking/daily-ranking-snapshot.service";
import { Mission } from "./modules/mission/entity/mission.entity";
import { UserMission } from "./modules/mission/entity/user-mission.entity";
import { MissionSeedService } from "./modules/mission/service/mission.seed";
import { DailyPrompt } from "./modules/prompt/daily-prompt.entity";
import { Prompt } from "./modules/prompt/prompt.entity";
import { PromptSeedService } from "./modules/prompt/prompt.seed";

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
      useFactory: (configService: ConfigService) =>
        createLoggerParams({
          nodeEnv: configService.get<string>("NODE_ENV"),
          logLevel: configService.get<string>("LOG_LEVEL"),
        }),
    }),
    MikroOrmModule.forRoot(config),
    MikroOrmModule.forFeature([
      Drawing,
      DailyUserRanking,
      Mission,
      UserMission,
      Prompt,
      DailyPrompt,
    ]),
  ],
  providers: [
    PromptSeedService,
    MissionSeedService,
    DailyRankingSnapshotService,
  ],
})
export class DataMaintenanceModule {}
