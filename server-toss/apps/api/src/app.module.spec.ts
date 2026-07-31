import { MODULE_METADATA } from "@nestjs/common/constants";
import { ScheduleModule } from "@nestjs/schedule";

jest.mock("@server-toss/database/mikro-orm.config", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("@server-toss/platform/common/config/env.validation", () => ({
  validateChanceWhitelistEnv: (env: Record<string, string>) => env,
}));

import { AppModule } from "./app.module";

describe("API 루트 모듈", () => {
  it("스케줄 모듈을 등록하지 않아요", () => {
    const imports =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? [];

    expect(
      imports.some(
        (importedModule: { module?: unknown }) =>
          importedModule === ScheduleModule ||
          importedModule.module === ScheduleModule,
      ),
    ).toBe(false);
  });
});
