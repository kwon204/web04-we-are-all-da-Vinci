import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { InternalSchedulerBasicAuthGuard } from "src/common/guards/internal-scheduler-basic-auth.guard";
import { RankingCleanupScheduler } from "./ranking.cleanup.scheduler";

@ApiExcludeController()
@Controller("internal/rankings")
@UseGuards(InternalSchedulerBasicAuthGuard)
export class InternalRankingController {
  constructor(
    private readonly rankingCleanupScheduler: RankingCleanupScheduler,
  ) {}

  @Post("cleanup")
  @HttpCode(HttpStatus.NO_CONTENT)
  async cleanup(): Promise<void> {
    await this.rankingCleanupScheduler.run();
  }
}
