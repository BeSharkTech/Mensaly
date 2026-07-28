import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import { AuthService } from "./auth.service";
import { LoginDto } from "./login.dto";
import { RegisterDto } from "./register.dto";
import {
  expiredSessionCookie,
  readSessionToken,
  sessionCookie,
} from "./session-cookie";

function requestMetadata(request: FastifyRequest): {
  ipAddress?: string;
  userAgent?: string;
} {
  const userAgent = request.headers["user-agent"];
  return {
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

function sessionTtlHours(): number {
  return Number(process.env.AUTH_SESSION_TTL_HOURS ?? 168);
}

function cookieEnvironment(): {
  NODE_ENV: "development" | "test" | "production";
  AUTH_SESSION_TTL_HOURS: number;
} {
  const nodeEnvironment = process.env.NODE_ENV;
  return {
    NODE_ENV:
      nodeEnvironment === "production" || nodeEnvironment === "test"
        ? nodeEnvironment
        : "development",
    AUTH_SESSION_TTL_HOURS: sessionTtlHours(),
  };
}

@ApiTags("Authentication")
@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({
    schema: {
      type: "object",
      required: ["name", "email", "password"],
      properties: {
        name: { type: "string", minLength: 2, maxLength: 120 },
        email: { type: "string", format: "email", maxLength: 255 },
        password: { type: "string", format: "password", minLength: 12, maxLength: 128 },
      },
    },
  })
  @ApiCreatedResponse({ description: "Account registered and awaiting email verification" })
  @ApiConflictResponse({ description: "An account already uses this email" })
  async register(@Body() input: RegisterDto): Promise<{ data: unknown }> {
    return { data: await this.authService.register(input) };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string", format: "email", maxLength: 255 },
        password: { type: "string", format: "password", maxLength: 128 },
      },
    },
  })
  @ApiOkResponse({ description: "Authenticated and session cookie issued" })
  @ApiUnauthorizedResponse({ description: "Invalid credentials" })
  async login(
    @Body() input: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ data: unknown }> {
    const environment = cookieEnvironment();
    const result = await this.authService.login(
      input,
      requestMetadata(request),
      environment.AUTH_SESSION_TTL_HOURS,
    );
    reply.header("set-cookie", sessionCookie(result.token, environment));
    return { data: result.user };
  }

  @Get("session")
  @ApiOkResponse({ description: "Current authenticated session" })
  @ApiUnauthorizedResponse({ description: "Session is missing, expired, or revoked" })
  async session(@Req() request: FastifyRequest): Promise<{ data: unknown }> {
    return {
      data: await this.authService.currentSession(
        readSessionToken(request.headers.cookie),
      ),
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOkResponse({ description: "Session revoked" })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.authService.logout(
      readSessionToken(request.headers.cookie),
      requestMetadata(request),
    );
    reply.header("set-cookie", expiredSessionCookie(cookieEnvironment()));
  }
}
