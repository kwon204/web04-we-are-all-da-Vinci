import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import "reflect-metadata";
import { DataMaintenanceModule } from "./data-maintenance.module";
import { DailyRankingSnapshotService } from "./modules/dailyRanking/daily-ranking-snapshot.service";
import { MissionSeedService } from "./modules/mission/service/mission.seed";
import { PromptSeedService } from "./modules/prompt/prompt.seed";

export async function runDataMaintenance(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    DataMaintenanceModule,
    {
      bufferLogs: true,
    },
  );

  try {
    app.useLogger(app.get(Logger));
    await app.get(PromptSeedService).run();
    await app.get(MissionSeedService).run();
    await app.get(DailyRankingSnapshotService).backfillMissingSnapshots();
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void runDataMaintenance();
}
