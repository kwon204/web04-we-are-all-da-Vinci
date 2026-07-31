import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import config from "@server-toss/database/mikro-orm.config";
import { Drawing } from "@server-toss/domain/modules/drawing/drawing.entity";
import { DailyUserRanking } from "@server-toss/domain/modules/dailyRanking/daily-user-ranking.entity";
import { DailyRankingSnapshotService } from "@server-toss/domain/modules/dailyRanking/daily-ranking-snapshot.service";
import { Mission } from "@server-toss/domain/modules/mission/entity/mission.entity";
import { UserMission } from "@server-toss/domain/modules/mission/entity/user-mission.entity";
import { MissionSeedService } from "@server-toss/domain/modules/mission/service/mission.seed";
import { DailyPrompt } from "@server-toss/domain/modules/prompt/daily-prompt.entity";
import { Prompt } from "@server-toss/domain/modules/prompt/prompt.entity";
import { PromptSeedService } from "@server-toss/domain/modules/prompt/prompt.seed";
import { validateChanceWhitelistEnv } from "@server-toss/platform/common/config/env.validation";
import { createLoggerParams } from "@server-toss/platform/common/logging/logger.config";

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
