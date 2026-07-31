import { Injectable, Logger } from "@nestjs/common";
import { PointService } from "../point.service";

@Injectable()
export class PointGrantPurgeScheduler {
  private readonly logger = new Logger(PointGrantPurgeScheduler.name);

  constructor(private readonly pointService: PointService) {}

  async run(): Promise<void> {
    try {
      await this.pointService.purgeProcessedGrantRequests();
    } catch (err) {
      this.logger.error(
        { event: "point_grant.purge.failed", err },
        "포인트 지급 요청 purge 실패",
      );
      throw err;
    }
  }
}
