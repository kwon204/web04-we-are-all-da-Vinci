import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { InternalSchedulerBasicAuthGuard } from "@server-toss/platform/common/guards/internal-scheduler-basic-auth.guard";
import { AttendanceModule } from "../attendance/attendance.module";
import { PromptModule } from "../prompt/prompt.module";
import { AttendanceStreakNotificationScheduler } from "./attendance-streak-notification.scheduler";
import { DailyPromptNotificationScheduler } from "./daily-prompt-notification.scheduler";
import { InternalNotificationController } from "./internal-notification.controller";
import { RankingChangedListener } from "./listeners/ranking-changed.listener";
import { NotificationAgreement } from "./notification-agreement.entity";
import { NotificationAgreementService } from "./notification-agreement.service";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { SentNotification } from "./sent-notification.entity";
import { SentNotificationStaleCleanupScheduler } from "./sent-notification-stale-cleanup.scheduler";

@Module({
  imports: [
    MikroOrmModule.forFeature([SentNotification, NotificationAgreement]),
    PromptModule,
    AttendanceModule,
  ],
  controllers: [NotificationController, InternalNotificationController],
  providers: [
    NotificationService,
    NotificationAgreementService,
    DailyPromptNotificationScheduler,
    AttendanceStreakNotificationScheduler,
    SentNotificationStaleCleanupScheduler,
    InternalSchedulerBasicAuthGuard,
    RankingChangedListener,
  ],
  exports: [NotificationService, NotificationAgreementService],
})
export class NotificationModule {}
