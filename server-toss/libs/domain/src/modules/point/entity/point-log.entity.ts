import type { Rel } from "@mikro-orm/core";
import {
  Entity,
  Enum,
  ManyToOne,
  PrimaryKey,
  Property,
} from "@mikro-orm/decorators/legacy";
import { BaseEntity } from "@server-toss/platform/common/entitiy/base.entity";
import { User } from "@server-toss/domain/modules/user/user.entity";

@Entity({ tableName: "point_logs" })
export class PointLog extends BaseEntity {
  @PrimaryKey({ type: "bigint" })
  id!: bigint;

  @Enum({ items: () => PointReason, fieldName: "point_reason" })
  reason!: PointReason;

  @Property({ fieldName: "point_amount", type: "int" })
  pointAmount!: number;

  @ManyToOne(() => User, { joinColumn: "user_key" })
  user!: Rel<User>;
}

export enum PointReason {
  AD = "ad",
  SHARE = "share",
  DRAWING = "drawing",
  MISSION = "mission",
  ATTENDANCE = "attendance",
}
