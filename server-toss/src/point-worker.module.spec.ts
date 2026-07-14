import { MODULE_METADATA } from "@nestjs/common/constants";
import { ScheduleModule } from "@nestjs/schedule";

jest.mock("./mikro-orm.config", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("./common/config/env.validation", () => ({
  validateChanceWhitelistEnv: (env: Record<string, string>) => env,
}));

import { InternalSchedulerBasicAuthGuard } from "./common/guards/internal-scheduler-basic-auth.guard";
import { InternalPointController } from "./modules/point/internal-point.controller";
import { PointGrantWorkerModule } from "./modules/point/point-grant-worker.module";
import { PointController } from "./modules/point/point.controller";
import { PointModule } from "./modules/point/point.module";
import { PointWorkerModule } from "./point-worker.module";

describe("포인트 작업자 모듈", () => {
  it("스케줄과 지급 작업 전용 모듈을 등록해요", () => {
    const imports =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, PointWorkerModule) ?? [];

    expect(imports).toContain(PointGrantWorkerModule);
    expect(imports).not.toContain(PointModule);
    expect(
      imports.some(
        (importedModule: { module?: unknown }) =>
          importedModule === ScheduleModule ||
          importedModule.module === ScheduleModule,
      ),
    ).toBe(true);
  });

  it("HTTP 컨트롤러와 API 인증 가드를 등록하지 않아요", () => {
    const controllers =
      Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        PointGrantWorkerModule,
      ) ?? [];
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PointGrantWorkerModule) ??
      [];

    expect(controllers).not.toContain(PointController);
    expect(controllers).not.toContain(InternalPointController);
    expect(providers).not.toContain(InternalSchedulerBasicAuthGuard);
  });
});
