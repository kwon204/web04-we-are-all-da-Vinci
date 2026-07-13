import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { InternalNotificationBasicAuthGuard } from "src/common/guards/internal-notification-basic-auth.guard";
import { InternalPointController } from "./internal-point.controller";
import { PointController } from "./point.controller";
import { PointGrantRequest } from "./entity/point-grant-request.entity";
import { PointLog } from "./entity/point-log.entity";
import { PointService } from "./point.service";
import { PointGrantPurgeScheduler } from "./scheduler/point-grant-purge.scheduler";
import { PointGrantScheduler } from "./scheduler/point-grant.scheduler";
@Module({
  imports: [MikroOrmModule.forFeature([PointLog, PointGrantRequest])],
  controllers: [PointController, InternalPointController],
  providers: [
    PointService,
    PointGrantScheduler,
    PointGrantPurgeScheduler,
    InternalNotificationBasicAuthGuard,
  ],
  exports: [PointService],
})
export class PointModule {}
