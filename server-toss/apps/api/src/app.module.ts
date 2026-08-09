import { MikroOrmModule } from "@mikro-orm/nestjs";
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { LoggerModule } from "nestjs-pino";
import { validateChanceWhitelistEnv } from "@server-toss/platform/common/config/env.validation";
import { createLoggerParams } from "@server-toss/platform/common/logging/logger.config";
import { RequestContextHelper } from "@server-toss/platform/common/middleware/request-context-helper.middleware";
import { TraceAopModule } from "@server-toss/platform/common/observability/trace-aop.module";
import { ExternalModule } from "@server-toss/toss-integration/external/external.module";
import { HealthModule } from "./health/health.module";
import config from "@server-toss/database/mikro-orm.config";
import { ArchiveModule } from "@server-toss/domain/modules/archive/archive.module";
import { AttendanceModule } from "@server-toss/domain/modules/attendance/attendance.module";
import { AuthModule } from "@server-toss/domain/modules/auth/auth.module";
import { ChanceModule } from "@server-toss/domain/modules/chance/chance.module";
import { DrawingModule } from "@server-toss/domain/modules/drawing/drawing.module";
import { MissionModule } from "@server-toss/domain/modules/mission/mission.module";
import { NotificationModule } from "@server-toss/domain/modules/notification/notification.module";
import { PlayModule } from "@server-toss/domain/modules/play/play.module";
import { PointModule } from "@server-toss/domain/modules/point/point.module";
import { PromptModule } from "@server-toss/domain/modules/prompt/prompt.module";
import { RankingModule } from "@server-toss/domain/modules/ranking/ranking.module";
import { UserModule } from "@server-toss/domain/modules/user/user.module";

@Module({
  imports: [
    HealthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
      validate: validateChanceWhitelistEnv,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return createLoggerParams({
          nodeEnv: configService.get<string>("NODE_ENV"),
          logLevel: configService.get<string>("LOG_LEVEL"),
        });
      },
    }),
    ...(process.env.OTEL_ENABLED === "true" ? [TraceAopModule] : []),
    // 도메인 이벤트 발행/구독. ranking.changed처럼 트랜잭션 커밋 후 비동기
    // 후처리(알림 발송 등)에 사용. in-memory이므로 프로세스 재시작 시 처리 중
    // 이벤트는 손실되는 한계 존재 — 큐 도입 시점에 BullMQ로 이행 호환.
    EventEmitterModule.forRoot(),
    MikroOrmModule.forRoot(config),
    ExternalModule.register(),
    AuthModule,
    ArchiveModule,
    UserModule,
    DrawingModule,
    PromptModule,
    PointModule,
    PlayModule,
    ChanceModule,
    RankingModule,
    MissionModule,
    NotificationModule,
    AttendanceModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextHelper).forRoutes("*");
  }
}
