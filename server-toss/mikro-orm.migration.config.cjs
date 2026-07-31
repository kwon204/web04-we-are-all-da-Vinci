require("dotenv/config");

const { User } = require("./dist/libs/domain/src/modules/user/user.entity");
const { Drawing } = require("./dist/libs/domain/src/modules/drawing/drawing.entity");
const { Prompt } = require("./dist/libs/domain/src/modules/prompt/prompt.entity");
const { DailyPrompt } = require("./dist/libs/domain/src/modules/prompt/daily-prompt.entity");
const { PointLog } = require("./dist/libs/domain/src/modules/point/entity/point-log.entity");
const { AdView } = require("./dist/libs/domain/src/modules/chance/ad-view.entity");
const { Ranking } = require("./dist/libs/domain/src/modules/ranking/ranking.entity");
const { PlayChance } = require("./dist/libs/domain/src/modules/chance/play-chance.entity");
const { ShareLog } = require("./dist/libs/domain/src/modules/chance/share-log.entity");
const { Mission } = require("./dist/libs/domain/src/modules/mission/entity/mission.entity");
const {
  UserMission,
} = require("./dist/libs/domain/src/modules/mission/entity/user-mission.entity");
const {
  SentNotification,
} = require("./dist/libs/domain/src/modules/notification/sent-notification.entity");
const {
  NotificationAgreement,
} = require("./dist/libs/domain/src/modules/notification/notification-agreement.entity");
const {
  PointGrantRequest,
} = require("./dist/libs/domain/src/modules/point/entity/point-grant-request.entity");
const { Attendance } = require("./dist/libs/domain/src/modules/attendance/attendance.entity");

const { Migrator } = require("@mikro-orm/migrations");
const { SeedManager } = require("@mikro-orm/seeder");
const { defineConfig } = require("@mikro-orm/mysql");

module.exports = defineConfig({
  dbName: process.env.MYSQL_DATABASE ?? "daVinci_toss",
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: parseInt(process.env.MYSQL_PORT ?? "3306"),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  entities: [
    User,
    Drawing,
    Prompt,
    DailyPrompt,
    PointLog,
    AdView,
    Ranking,
    PlayChance,
    ShareLog,
    Mission,
    UserMission,
    SentNotification,
    NotificationAgreement,
    PointGrantRequest,
    Attendance,
  ],
  debug: process.env.NODE_ENV !== "production",
  forceUtcTimezone: true, // UTC로 시간 설정 고정
  allowGlobalContext: process.env.NODE_ENV === "test", // 테스트환경의 전역 em 사용을 위한 설정
  preferTs: false, // 이 config는 dist(컴파일된 JS) 전용 — 마이그레이션/시더 모두 alias 이미 해석된 dist를 사용
  extensions: [Migrator, SeedManager],
  migrations: {
    snapshot: process.env.NODE_ENV !== "production",
    path: "dist/libs/database/src/migrations",
    pathTs: "libs/database/src/migrations",
    transactional: false,
    allOrNothing: false,
  },
  seeder: {
    path: "dist/libs/database/src/seeders",
    pathTs: "libs/database/src/seeders",
    emit: "ts",
    glob: "!(*.d).{js,ts}",
    fileName: (className) => className,
  },
});
