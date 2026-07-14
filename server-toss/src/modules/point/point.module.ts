import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Module } from "@nestjs/common";
import { InternalSchedulerBasicAuthGuard } from "src/common/guards/internal-scheduler-basic-auth.guard";
import { InternalPointController } from "./internal-point.controller";
import { PointController } from "./point.controller";
import { PointGrantRequest } from "./entity/point-grant-request.entity";
import { PointLog } from "./entity/point-log.entity";
import { PointService } from "./point.service";
import { PointGrantPurgeScheduler } from "./scheduler/point-grant-purge.scheduler";
@Module({
  imports: [MikroOrmModule.forFeature([PointLog, PointGrantRequest])],
  controllers: [PointController, InternalPointController],
  providers: [
    PointService,
    PointGrantPurgeScheduler,
    InternalSchedulerBasicAuthGuard,
  ],
  exports: [PointService],
})
export class PointModule {}
