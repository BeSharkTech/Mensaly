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
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
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
import {
  EmailRequestDto,
  PasswordResetDto,
  TokenDto,
} from "./verification.dto";

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
  @ApiOperation({ summary: "Registers a company owner account" })
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

  @Post("verify-email/request")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Requests an email verification token" })
  @ApiBody({ schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } })
  @ApiAcceptedResponse({ description: "Verification request accepted without revealing account existence" })
  async requestEmailVerification(@Body() input: EmailRequestDto): Promise<{ data: { accepted: true } }> {
    await this.authService.requestEmailVerification(input);
    return { data: { accepted: true } };
  }

  @Post("verify-email/confirm")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Confirms an email verification token" })
  @ApiBody({ schema: { type: "object", required: ["token"], properties: { token: { type: "string" } } } })
  async verifyEmail(@Body() input: TokenDto): Promise<void> {
    await this.authService.verifyEmail(input);
  }

  @Post("password-reset/request")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Requests a password reset token" })
  @ApiBody({ schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } })
  @ApiAcceptedResponse({ description: "Reset request accepted without revealing account existence" })
  async requestPasswordReset(@Body() input: EmailRequestDto): Promise<{ data: { accepted: true } }> {
    await this.authService.requestPasswordReset(input);
    return { data: { accepted: true } };
  }

  @Post("password-reset/confirm")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Resets a password with a valid token" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["token", "password"],
      properties: {
        token: { type: "string" },
        password: { type: "string", format: "password", minLength: 12, maxLength: 128 },
      },
    },
  })
  async resetPassword(@Body() input: PasswordResetDto): Promise<void> {
    await this.authService.resetPassword(input);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Creates an authenticated session" })
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
  @ApiOperation({ summary: "Gets the current authenticated session" })
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
  @ApiOperation({ summary: "Revokes the current session" })
  @ApiNoContentResponse({ description: "Session revoked" })
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
