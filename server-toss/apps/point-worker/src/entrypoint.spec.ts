jest.mock("@server-toss/database/mikro-orm.config", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("@server-toss/platform/common/config/env.validation", () => ({
  validateChanceWhitelistEnv: (env: Record<string, string>) => env,
}));

import {
  parseSecretEnvironment,
  respondToWorkerHealthCheck,
} from "./entrypoint";

describe("포인트 작업자 비밀값 설정", () => {
  it("환경변수와 Secret Manager 이름의 매핑을 읽어요", () => {
    expect(
      parseSecretEnvironment(
        "MYSQL_PASSWORD=toss-db-password,JWT_SECRET=toss-jwt",
      ),
    ).toEqual([
      { envName: "MYSQL_PASSWORD", secretName: "toss-db-password" },
      { envName: "JWT_SECRET", secretName: "toss-jwt" },
    ]);
  });

  it("잘못된 매핑 형식은 거부해요", () => {
    expect(() => parseSecretEnvironment("MYSQL_PASSWORD")).toThrow(
      "WORKER_SECRET_ENV",
    );
  });

  it("MIG 헬스체크 요청에 정상 상태를 반환해요", () => {
    const response = {
      writeHead: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };

    respondToWorkerHealthCheck("/health", response as never);

    expect(response.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(response.end).toHaveBeenCalledWith('{"status":"ok"}');
  });
});
