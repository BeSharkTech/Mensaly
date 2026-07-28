import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from "@nestjs/common";
import { ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiTags } from "@nestjs/swagger";

import { AuthService } from "./auth.service";
import { RegisterDto } from "./register.dto";

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
}
