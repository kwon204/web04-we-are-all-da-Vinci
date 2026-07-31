import { Injectable, Logger } from "@nestjs/common";
import { DailyRankingSnapshotService } from "../dailyRanking/daily-ranking-snapshot.service";
import { RankingService } from "./ranking.service";

@Injectable()
export class RankingCleanupScheduler {
  private readonly logger = new Logger(RankingCleanupScheduler.name);

  constructor(
    private readonly rankingService: RankingService,
    private readonly dailyRankingSnapshotService: DailyRankingSnapshotService,
  ) {}

  async run(): Promise<void> {
    try {
      await this.dailyRankingSnapshotService.createYesterdaySnapshot();
      await this.rankingService.cleanupRanking();
    } catch (err) {
      this.logger.error(
        { event: "ranking.cleanup.scheduler.failed", err },
        "랭킹 클린업 스케줄러 실패",
      );
      throw err;
    }
  }
}
