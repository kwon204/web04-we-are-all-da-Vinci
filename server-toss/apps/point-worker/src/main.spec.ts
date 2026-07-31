import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";

jest.mock("@server-toss/database/mikro-orm.config", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("@server-toss/platform/common/config/env.validation", () => ({
  validateChanceWhitelistEnv: (env: Record<string, string>) => env,
}));

import { bootstrap } from "./main";
import { PointWorkerModule } from "./worker.module";

describe("포인트 작업자 부팅", () => {
  it("HTTP 포트 없이 애플리케이션 컨텍스트로 시작해요", async () => {
    const app = {
      enableShutdownHooks: jest.fn(),
      get: jest.fn().mockReturnValue("logger"),
      useLogger: jest.fn(),
    };
    const createApplicationContext = jest
      .spyOn(NestFactory, "createApplicationContext")
      .mockResolvedValue(app as never);

    await bootstrap();

    expect(createApplicationContext).toHaveBeenCalledWith(PointWorkerModule, {
      bufferLogs: true,
    });
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(app.get).toHaveBeenCalledWith(Logger);
    expect(app.useLogger).toHaveBeenCalledWith("logger");
    expect("listen" in app).toBe(false);
  });
});
