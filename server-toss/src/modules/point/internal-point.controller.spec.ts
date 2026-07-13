import { HttpStatus, UnauthorizedException } from "@nestjs/common";
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InternalNotificationBasicAuthGuard } from "src/common/guards/internal-notification-basic-auth.guard";
import { InternalPointController } from "./internal-point.controller";

describe("내부 포인트 지급 요청 정리 API", () => {
  const pointGrantPurgeScheduler = { run: jest.fn() };
  const controller = new InternalPointController(
    pointGrantPurgeScheduler as never,
  );
  const guard = new InternalNotificationBasicAuthGuard({
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
    pointGrantPurgeScheduler.run.mockResolvedValue(undefined);
  });

  it("지급 요청 정리를 한 번 실행하고 204로 설정돼요", async () => {
    await controller.grantPurge();

    expect(pointGrantPurgeScheduler.run).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(PATH_METADATA, controller.grantPurge)).toBe(
      "grant-purge",
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.grantPurge)).toBe(
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

  it("정리 작업 오류를 전파해 Nest가 5xx를 반환할 수 있어요", async () => {
    pointGrantPurgeScheduler.run.mockRejectedValue(new Error("정리 실패"));

    await expect(controller.grantPurge()).rejects.toThrow("정리 실패");
  });
});
