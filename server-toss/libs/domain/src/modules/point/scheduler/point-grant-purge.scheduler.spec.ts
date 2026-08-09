import { Logger } from "@nestjs/common";
import { PointGrantPurgeScheduler } from "./point-grant-purge.scheduler";

describe("포인트 지급 요청 정리 작업", () => {
  it("지급 요청 정리를 한 번 실행해요", async () => {
    const purgeProcessedGrantRequests = jest.fn().mockResolvedValue({
      succeededDeleted: 1,
      failedDeleted: 2,
    });
    const scheduler = new PointGrantPurgeScheduler({
      purgeProcessedGrantRequests,
    } as never);

    await scheduler.run();

    expect(purgeProcessedGrantRequests).toHaveBeenCalledTimes(1);
  });

  it("정리 실패를 로그로 남기고 전파해요", async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const scheduler = new PointGrantPurgeScheduler({
      purgeProcessedGrantRequests: jest
        .fn()
        .mockRejectedValue(new Error("정리 실패")),
    } as never);

    await expect(scheduler.run()).rejects.toThrow("정리 실패");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
