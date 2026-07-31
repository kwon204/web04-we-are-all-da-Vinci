import { HttpStatus, UnauthorizedException } from "@nestjs/common";
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ConfigService } from "@nestjs/config";
import type { ExecutionContext } from "@nestjs/common";
import { InternalSchedulerBasicAuthGuard } from "@server-toss/platform/common/guards/internal-scheduler-basic-auth.guard";
import { InternalRankingController } from "../internal-ranking.controller";

describe("내부 랭킹 정리 API", () => {
  const rankingCleanupScheduler = { run: jest.fn() };
  const controller = new InternalRankingController(
    rankingCleanupScheduler as never,
  );
  const guard = new InternalSchedulerBasicAuthGuard({
    getOrThrow: jest.fn((key: string) => {
      if (key === "INTERNAL_JOB_BASIC_AUTH_USERNAME") return "internal-job";
      if (key === "INTERNAL_JOB_BASIC_AUTH_PASSWORD") return "secret";
      throw new Error(`unexpected key: ${key}`);
    }),
  } as unknown as ConfigService);

  const executionContext = (authorization?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.resetAllMocks();
    rankingCleanupScheduler.run.mockResolvedValue(undefined);
  });

  it("랭킹 정리를 한 번 실행하고 204로 설정돼요", async () => {
    await controller.cleanup();

    expect(rankingCleanupScheduler.run).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(PATH_METADATA, controller.cleanup)).toBe(
      "cleanup",
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.cleanup)).toBe(
      HttpStatus.NO_CONTENT,
    );
  });

  it.each([
    undefined,
    "Bearer token",
    "Basic not-base64",
    `Basic ${Buffer.from("wrong:secret").toString("base64")}`,
  ])("Basic Auth가 없거나 잘못되면 (%s) 401을 반환해요", (authorization) => {
    expect(() => guard.canActivate(executionContext(authorization))).toThrow(
      UnauthorizedException,
    );
  });

  it("올바른 Basic Auth는 통과해요", () => {
    const authorization = `Basic ${Buffer.from("internal-job:secret").toString("base64")}`;

    expect(guard.canActivate(executionContext(authorization))).toBe(true);
  });

  it("실행 서비스 오류를 전파해 Nest가 5xx를 반환할 수 있어요", async () => {
    rankingCleanupScheduler.run.mockRejectedValue(new Error("정리 실패"));

    await expect(controller.cleanup()).rejects.toThrow("정리 실패");
  });
});
