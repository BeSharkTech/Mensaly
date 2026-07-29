import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import {
  CurrentAuth,
  type AuthenticatedContext,
} from "../authorization/authorization-context";
import {
  CompanyAccountGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
import { getCorrelationId } from "../common/correlation";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  UpdateReminderConfigurationDto,
  type UpdateReminderConfigurationInput,
  updateReminderConfigurationSchema,
} from "./reminder-configuration.dto";
import {
  type ReminderAuditMetadata,
  ReminderConfigurationService,
} from "./reminder-configuration.service";

function requestMetadata(request: FastifyRequest): ReminderAuditMetadata {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

const configurationBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled", "allowedHours", "dailyLimit", "rules"] as string[],
  properties: {
    enabled: { type: "boolean" },
    allowedHours: {
      type: "object",
      additionalProperties: false,
      required: ["start", "end"] as string[],
      properties: {
        start: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        end: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
      },
    },
    dailyLimit: { type: "integer", minimum: 1, maximum: 1000 },
    rules: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timing", "dayOffset"] as string[],
        properties: {
          timing: {
            type: "string",
            enum: ["BEFORE_DUE", "ON_DUE", "AFTER_DUE"] as string[],
          },
          dayOffset: { type: "integer", minimum: 0, maximum: 60 },
          templateId: {
            type: "string",
            format: "uuid",
            nullable: true,
          },
          enabled: { type: "boolean", default: true },
        },
      },
    },
  },
} as const;

@ApiTags("Reminder configuration")
@Controller({ path: "reminder-configuration", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class ReminderConfigurationController {
  constructor(
    @Inject(ReminderConfigurationService)
    private readonly reminders: ReminderConfigurationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Gets the authenticated organization reminder configuration",
  })
  @ApiOkResponse({
    description: "Configuration with the organization timezone",
  })
  @ApiNotFoundResponse({ description: "Configuration does not exist yet" })
  @ApiUnauthorizedResponse({ description: "A valid company session is required" })
  async get(
    @CurrentAuth() auth: AuthenticatedContext,
  ): Promise<{ data: unknown }> {
    return { data: await this.reminders.get(auth) };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Creates or replaces the organization reminder configuration",
  })
  @ApiBody({ schema: configurationBodySchema })
  @ApiOkResponse({ description: "Configuration created or replaced" })
  @ApiBadRequestResponse({
    description: "Invalid window, limit, duplicate rule, or rule conflict",
  })
  @ApiUnauthorizedResponse({ description: "A valid company session is required" })
  async upsert(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(updateReminderConfigurationSchema))
    input: UpdateReminderConfigurationDto,
    @Req() request: FastifyRequest,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.reminders.upsert(
        auth,
        input as unknown as UpdateReminderConfigurationInput,
        requestMetadata(request),
      ),
    };
  }
}
