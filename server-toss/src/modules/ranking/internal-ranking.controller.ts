import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { InternalNotificationBasicAuthGuard } from "src/common/guards/internal-notification-basic-auth.guard";
import { RankingCleanupScheduler } from "./ranking.cleanup.scheduler";

@ApiExcludeController()
@Controller("internal/rankings")
@UseGuards(InternalNotificationBasicAuthGuard)
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
