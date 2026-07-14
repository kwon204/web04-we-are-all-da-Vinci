import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger, LoggerErrorInterceptor } from "nestjs-pino";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { ZodExceptionFilter } from "./common/zod-exception.filter";

export async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ZodExceptionFilter(), new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  const options = new DocumentBuilder()
    .setTitle("DaVinci Toss Server API")
    .setDescription("DaVinci Toss Server API description")
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup("/docs", app, document);

  await app.listen(process.env.PORT ?? 3001);
}
if (require.main === module) {
  void bootstrap();
}
