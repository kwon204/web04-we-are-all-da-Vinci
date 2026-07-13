import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { InternalSchedulerBasicAuthGuard } from "src/common/guards/internal-scheduler-basic-auth.guard";
import { PointGrantPurgeScheduler } from "./scheduler/point-grant-purge.scheduler";

@ApiExcludeController()
@Controller("internal/points")
@UseGuards(InternalSchedulerBasicAuthGuard)
export class InternalPointController {
  constructor(
    private readonly pointGrantPurgeScheduler: PointGrantPurgeScheduler,
  ) {}

  @Post("grant-purge")
  @HttpCode(HttpStatus.NO_CONTENT)
  async grantPurge(): Promise<void> {
    await this.pointGrantPurgeScheduler.run();
  }
}
