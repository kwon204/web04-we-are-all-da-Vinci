import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AttendanceStreakNotificationScheduler } from "./attendance-streak-notification.scheduler";
import { DailyPromptNotificationScheduler } from "./daily-prompt-notification.scheduler";
import { InternalNotificationBasicAuthGuard } from "./guards/internal-notification-basic-auth.guard";
import { SentNotificationStaleCleanupScheduler } from "./sent-notification-stale-cleanup.scheduler";

@ApiExcludeController()
@Controller("internal/notifications")
@UseGuards(InternalNotificationBasicAuthGuard)
export class InternalNotificationController {
  constructor(
    private readonly dailyPromptNotificationScheduler: DailyPromptNotificationScheduler,
    private readonly attendanceStreakNotificationScheduler: AttendanceStreakNotificationScheduler,
    private readonly sentNotificationStaleCleanupScheduler: SentNotificationStaleCleanupScheduler,
  ) {}

  @Post("daily-prompt")
  @HttpCode(HttpStatus.NO_CONTENT)
  async dailyPrompt(): Promise<void> {
    await this.dailyPromptNotificationScheduler.run();
  }

  @Post("attendance-streak")
  @HttpCode(HttpStatus.NO_CONTENT)
  async attendanceStreak(): Promise<void> {
    await this.attendanceStreakNotificationScheduler.run();
  }

  @Post("stale-cleanup")
  @HttpCode(HttpStatus.NO_CONTENT)
  async staleCleanup(): Promise<void> {
    await this.sentNotificationStaleCleanupScheduler.run();
  }
}
