import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import "reflect-metadata";
import { DailyRankingSnapshotService } from "@server-toss/domain/modules/dailyRanking/daily-ranking-snapshot.service";
import { MissionSeedService } from "@server-toss/domain/modules/mission/service/mission.seed";
import { PromptSeedService } from "@server-toss/domain/modules/prompt/prompt.seed";
import { DataMaintenanceModule } from "./maintenance.module";

export type DataMaintenanceTask = "content" | "rankings";

const DEFAULT_TASKS: DataMaintenanceTask[] = ["content", "rankings"];

export const parseDataMaintenanceTasks = (
  args: string[],
): DataMaintenanceTask[] => {
  if (args.length === 0) return DEFAULT_TASKS;

  const tasks = new Set<DataMaintenanceTask>();
  for (const arg of args) {
    if (arg === "--content") tasks.add("content");
    else if (arg === "--rankings") tasks.add("rankings");
    else {
      throw new Error(
        `지원하지 않는 데이터 점검 옵션이에요: ${arg}. --content 또는 --rankings만 사용할 수 있어요.`,
      );
    }
  }

  if (tasks.size === 0) {
    throw new Error("실행할 데이터 점검 작업을 선택해야 해요.");
  }

  return [...tasks];
};

export async function runDataMaintenance(
  tasks: DataMaintenanceTask[] = DEFAULT_TASKS,
): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    DataMaintenanceModule,
    {
      bufferLogs: true,
    },
  );

  try {
    app.useLogger(app.get(Logger));
    if (tasks.includes("content")) {
      await app.get(PromptSeedService).run();
      await app.get(MissionSeedService).run();
    }
    if (tasks.includes("rankings")) {
      await app.get(DailyRankingSnapshotService).backfillMissingSnapshots();
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void runDataMaintenance(parseDataMaintenanceTasks(process.argv.slice(2)));
}
