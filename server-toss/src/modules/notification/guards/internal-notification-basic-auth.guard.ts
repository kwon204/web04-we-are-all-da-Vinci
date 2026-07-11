import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { Request } from "express";

@Injectable()
export class InternalNotificationBasicAuthGuard implements CanActivate {
  private readonly authUsername: string;
  private readonly authPassword: string;

  constructor(private readonly configService: ConfigService) {
    this.authUsername = this.configService.getOrThrow<string>(
      "INTERNAL_JOB_BASIC_AUTH_USERNAME",
    );
    this.authPassword = this.configService.getOrThrow<string>(
      "INTERNAL_JOB_BASIC_AUTH_PASSWORD",
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.headers.authorization;

    if (!auth?.startsWith("Basic ")) {
      throw new UnauthorizedException("Basic 인증이 필요해요.");
    }

    const expected = Buffer.from(`${this.authUsername}:${this.authPassword}`);
    const received = Buffer.from(
      Buffer.from(auth.slice(6), "base64").toString("utf-8"),
    );

    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException("인증 헤더가 일치하지 않아요.");
    }

    return true;
  }
}
