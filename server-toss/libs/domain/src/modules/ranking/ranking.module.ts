import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { InternalSchedulerBasicAuthGuard } from "@server-toss/platform/common/guards/internal-scheduler-basic-auth.guard";
import { Ranking } from "./ranking.entity";
import { RankingController } from "./ranking.controller";
import { InternalRankingController } from "./internal-ranking.controller";
import { RankingService } from "./ranking.service";
import { RankingCleanupScheduler } from "./ranking.cleanup.scheduler";
import { DailyRankingModule } from "../dailyRanking/daily-ranking.module";
import { Drawing } from "../drawing/drawing.entity";

@Module({
  imports: [MikroOrmModule.forFeature([Ranking, Drawing]), DailyRankingModule],
  controllers: [RankingController, InternalRankingController],
  providers: [
    RankingService,
    RankingCleanupScheduler,
    InternalSchedulerBasicAuthGuard,
  ],
  exports: [RankingService],
})
export class RankingModule {}
