import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

jest.mock("@server-toss/database/mikro-orm.config", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("@server-toss/platform/common/config/env.validation", () => ({
  validateChanceWhitelistEnv: (env: Record<string, string>) => env,
}));

import { DataMaintenanceModule } from "./maintenance.module";
import { parseDataMaintenanceTasks, runDataMaintenance } from "./main";
import { DailyRankingSnapshotService } from "@server-toss/domain/modules/dailyRanking/daily-ranking-snapshot.service";
import { MissionSeedService } from "@server-toss/domain/modules/mission/service/mission.seed";
import { PromptSeedService } from "@server-toss/domain/modules/prompt/prompt.seed";

describe("데이터 점검 작업", () => {
  it("HTTP 포트 없이 시드와 누락 랭킹 보정을 순서대로 실행하고 컨텍스트를 닫는다", async () => {
    const promptSeedService = { run: jest.fn().mockResolvedValue(undefined) };
    const missionSeedService = { run: jest.fn().mockResolvedValue(undefined) };
    const dailyRankingSnapshotService = {
      backfillMissingSnapshots: jest.fn().mockResolvedValue(undefined),
    };
    const app = {
      get: jest.fn((token: unknown) => {
        if (token === Logger) return "logger";
        if (token === PromptSeedService) return promptSeedService;
        if (token === MissionSeedService) return missionSeedService;
        if (token === DailyRankingSnapshotService) {
          return dailyRankingSnapshotService;
        }
        return undefined;
      }),
      useLogger: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const createApplicationContext = jest
      .spyOn(NestFactory, "createApplicationContext")
      .mockResolvedValue(app as never);

    await runDataMaintenance();

    expect(createApplicationContext).toHaveBeenCalledWith(
      DataMaintenanceModule,
      {
        bufferLogs: true,
      },
    );
    expect(promptSeedService.run.mock.invocationCallOrder[0]).toBeLessThan(
      missionSeedService.run.mock.invocationCallOrder[0],
    );
    expect(missionSeedService.run.mock.invocationCallOrder[0]).toBeLessThan(
      dailyRankingSnapshotService.backfillMissingSnapshots.mock
        .invocationCallOrder[0],
    );
    expect(app.close).toHaveBeenCalledTimes(1);
    expect("listen" in app).toBe(false);
  });

  it("작업이 실패해도 컨텍스트를 닫고 오류를 전달한다", async () => {
    const failure = new Error("seed failed");
    const app = {
      get: jest.fn((token: unknown) => {
        if (token === Logger) return "logger";
        if (token === PromptSeedService) {
          return { run: jest.fn().mockRejectedValue(failure) };
        }
        return undefined;
      }),
      useLogger: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(NestFactory, "createApplicationContext")
      .mockResolvedValue(app as never);

    await expect(runDataMaintenance()).rejects.toThrow(failure);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("콘텐츠 동기화만 선택하면 랭킹 보정은 실행하지 않는다", async () => {
    const promptSeedService = { run: jest.fn().mockResolvedValue(undefined) };
    const missionSeedService = { run: jest.fn().mockResolvedValue(undefined) };
    const dailyRankingSnapshotService = {
      backfillMissingSnapshots: jest.fn().mockResolvedValue(undefined),
    };
    const app = {
      get: jest.fn((token: unknown) => {
        if (token === Logger) return "logger";
        if (token === PromptSeedService) return promptSeedService;
        if (token === MissionSeedService) return missionSeedService;
        if (token === DailyRankingSnapshotService) {
          return dailyRankingSnapshotService;
        }
        return undefined;
      }),
      useLogger: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(NestFactory, "createApplicationContext")
      .mockResolvedValue(app as never);

    await runDataMaintenance(["content"]);

    expect(promptSeedService.run).toHaveBeenCalledTimes(1);
    expect(missionSeedService.run).toHaveBeenCalledTimes(1);
    expect(
      dailyRankingSnapshotService.backfillMissingSnapshots,
    ).not.toHaveBeenCalled();
  });

  it("허용하지 않은 작업 옵션은 거부한다", () => {
    expect(() => parseDataMaintenanceTasks(["--unknown"])).toThrow(
      "지원하지 않는 데이터 점검 옵션",
    );
  });
});
