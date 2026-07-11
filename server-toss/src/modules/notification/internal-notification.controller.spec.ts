import { HttpStatus, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PATH_METADATA, HTTP_CODE_METADATA } from "@nestjs/common/constants";
import type { ExecutionContext } from "@nestjs/common";
import { InternalNotificationController } from "./internal-notification.controller";
import { InternalNotificationBasicAuthGuard } from "./guards/internal-notification-basic-auth.guard";

describe("InternalNotificationController", () => {
  const dailyPromptScheduler = { run: jest.fn() };
  const attendanceStreakScheduler = { run: jest.fn() };
  const staleCleanupScheduler = { run: jest.fn() };
  const controller = new InternalNotificationController(
    dailyPromptScheduler as never,
    attendanceStreakScheduler as never,
    staleCleanupScheduler as never,
  );
  const guard = new InternalNotificationBasicAuthGuard({
    getOrThrow: jest.fn((key: string) => {
      if (key === "INTERNAL_JOB_BASIC_AUTH_USERNAME") return "internal-job";
      if (key === "INTERNAL_JOB_BASIC_AUTH_PASSWORD") return "secret";
      throw new Error(`unexpected key: ${key}`);
    }),
  } as unknown as ConfigService);
  const authHeader = `Basic ${Buffer.from("internal-job:secret").toString("base64")}`;

  const executionContext = (authorization?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.resetAllMocks();
    dailyPromptScheduler.run.mockResolvedValue(undefined);
    attendanceStreakScheduler.run.mockResolvedValue(undefined);
    staleCleanupScheduler.run.mockResolvedValue(undefined);
  });

  it.each([
    ["dailyPrompt", "daily-prompt", dailyPromptScheduler],
    ["attendanceStreak", "attendance-streak", attendanceStreakScheduler],
    ["staleCleanup", "stale-cleanup", staleCleanupScheduler],
  ])(
    "%s는 실행 서비스를 한 번 호출하고 204로 설정돼요",
    async (method, path, scheduler) => {
      await controller[method as keyof InternalNotificationController]();

      expect(scheduler.run).toHaveBeenCalledTimes(1);
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          controller[method as keyof InternalNotificationController],
        ),
      ).toBe(path);
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          controller[method as keyof InternalNotificationController],
        ),
      ).toBe(HttpStatus.NO_CONTENT);
    },
  );

  it.each([
    undefined,
    "Bearer token",
    "Basic not-base64",
    `Basic ${Buffer.from("wrong:secret").toString("base64")}`,
    `Basic ${Buffer.from("internal-job:wrong").toString("base64")}`,
  ])("Basic Auth가 없거나 잘못되면 (%s) 401을 반환해요", (authorization) => {
    expect(() => guard.canActivate(executionContext(authorization))).toThrow(
      UnauthorizedException,
    );
  });

  it("올바른 Basic Auth는 통과해요", () => {
    expect(guard.canActivate(executionContext(authHeader))).toBe(true);
  });

  it("실행 서비스 오류를 전파해 Nest가 5xx를 반환할 수 있어요", async () => {
    dailyPromptScheduler.run.mockRejectedValue(new Error("db down"));

    await expect(controller.dailyPrompt()).rejects.toThrow("db down");
  });
});
