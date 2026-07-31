import { PointGrantScheduler } from "./point-grant.scheduler";

describe("포인트 지급 처리 작업", () => {
  it("지급 대기 요청을 한 번 처리해요", async () => {
    const settleGrantRequests = jest.fn().mockResolvedValue(undefined);
    const scheduler = new PointGrantScheduler(
      {} as never,
      {
        settleGrantRequests,
      } as never,
    );

    await scheduler.processEligiblePoints();

    expect(settleGrantRequests).toHaveBeenCalledTimes(1);
  });
});
