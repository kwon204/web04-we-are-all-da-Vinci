import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import "reflect-metadata";
import { PointWorkerModule } from "./point-worker.module";

export async function bootstrap() {
  const app = await NestFactory.createApplicationContext(PointWorkerModule, {
    bufferLogs: true,
  });

  app.enableShutdownHooks();
  app.useLogger(app.get(Logger));
}

if (require.main === module) {
  void bootstrap();
}
