import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
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
  CreateMessageScheduleDto,
  type CreateMessageScheduleInput,
  createMessageScheduleSchema,
  CreateMessageTemplateDto,
  type CreateMessageTemplateInput,
  createMessageTemplateSchema,
  type MessageScheduleListQuery,
  messageScheduleListQuerySchema,
  type MessageTemplateListQuery,
  messageTemplateListQuerySchema,
  UpdateMessageTemplateDto,
  type UpdateMessageTemplateInput,
  updateMessageTemplateSchema,
} from "./messaging.dto";
import {
  type MessagingAuditMetadata,
  MessagingService,
} from "./messaging.service";

function requestMetadata(request: FastifyRequest): MessagingAuditMetadata {
  const userAgent = request.headers["user-agent"];
  return {
    correlationId: getCorrelationId(request),
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

const templateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "body"] as string[],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 120 },
    body: { type: "string", minLength: 1, maxLength: 4000 },
    active: { type: "boolean", default: true },
  },
} as const;

const scheduleBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["chargeId", "templateId", "scheduledFor"] as string[],
  properties: {
    chargeId: { type: "string", format: "uuid" },
    templateId: { type: "string", format: "uuid" },
    scheduledFor: { type: "string", format: "date-time" },
  },
} as const;

@ApiTags("Messaging")
@ApiCookieAuth("sessionCookie")
@Controller({ path: "", version: "1" })
@UseGuards(SessionAuthGuard, CompanyAccountGuard)
export class MessagingController {
  constructor(
    @Inject(MessagingService)
    private readonly messaging: MessagingService,
  ) {}

  @Get("message-templates")
  @ApiOperation({ summary: "Lists internal message templates" })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({ name: "active", required: false, type: Boolean })
  @ApiOkResponse({ description: "Paginated organization templates" })
  async templates(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(messageTemplateListQuerySchema))
    query: Record<string, string | undefined>,
  ) {
    const result = await this.messaging.templates(
      auth,
      query as unknown as MessageTemplateListQuery,
    );
    return {
      data: result.items,
      meta: {
        page: result.page,
        limit: result.pageSize,
        total: result.total,
        pages: Math.ceil(result.total / result.pageSize),
      },
    };
  }

  @Post("message-templates")
  @ApiOperation({ summary: "Creates an internal message template" })
  @ApiBody({ schema: templateBodySchema })
  @ApiCreatedResponse({ description: "Template created" })
  @ApiBadRequestResponse({ description: "Invalid template payload" })
  @ApiConflictResponse({ description: "Template name already exists" })
  @ApiUnauthorizedResponse({ description: "A valid company session is required" })
  async createTemplate(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createMessageTemplateSchema))
    input: CreateMessageTemplateDto,
    @Req() request: FastifyRequest,
  ) {
    return {
      data: await this.messaging.createTemplate(
        auth,
        input as unknown as CreateMessageTemplateInput,
        requestMetadata(request),
      ),
    };
  }

  @Get("message-templates/:id")
  @ApiOperation({ summary: "Gets one organization-scoped message template" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Message template" })
  @ApiNotFoundResponse({ description: "Template not found" })
  async template(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.messaging.template(auth, id) };
  }

  @Patch("message-templates/:id")
  @ApiOperation({ summary: "Updates or deactivates a message template" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiBody({
    schema: {
      ...templateBodySchema,
      required: [],
    },
  })
  @ApiOkResponse({ description: "Template updated" })
  @ApiBadRequestResponse({ description: "Invalid template payload" })
  @ApiConflictResponse({ description: "Template name already exists" })
  @ApiNotFoundResponse({ description: "Template not found" })
  async updateTemplate(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateMessageTemplateSchema))
    input: UpdateMessageTemplateDto,
    @Req() request: FastifyRequest,
  ) {
    return {
      data: await this.messaging.updateTemplate(
        auth,
        id,
        input as unknown as UpdateMessageTemplateInput,
        requestMetadata(request),
      ),
    };
  }

  @Get("message-schedules")
  @ApiOperation({ summary: "Lists persisted message schedules" })
  @ApiQuery({ name: "page", required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiQuery({
    name: "status",
    required: false,
    enum: [
      "SCHEDULED",
      "QUEUED",
      "PROCESSING",
      "SENT",
      "DELIVERED",
      "READ",
      "FAILED_RETRYABLE",
      "FAILED_PERMANENT",
      "CANCELLED",
    ],
  })
  @ApiQuery({ name: "chargeId", required: false, format: "uuid" })
  @ApiOkResponse({ description: "Paginated organization schedules" })
  async schedules(
    @CurrentAuth() auth: AuthenticatedContext,
    @Query(new ZodValidationPipe(messageScheduleListQuerySchema))
    query: Record<string, string | undefined>,
  ) {
    const result = await this.messaging.schedules(
      auth,
      query as unknown as MessageScheduleListQuery,
    );
    return {
      data: result.items,
      meta: {
        page: result.page,
        limit: result.pageSize,
        total: result.total,
        pages: Math.ceil(result.total / result.pageSize),
      },
    };
  }

  @Post("message-schedules")
  @ApiOperation({ summary: "Persists an idempotent message schedule" })
  @ApiBody({ schema: scheduleBodySchema })
  @ApiCreatedResponse({ description: "Schedule created or reused" })
  @ApiBadRequestResponse({ description: "Invalid schedule payload" })
  @ApiConflictResponse({ description: "Charge state does not allow scheduling" })
  @ApiNotFoundResponse({ description: "Charge or active template not found" })
  async createSchedule(
    @CurrentAuth() auth: AuthenticatedContext,
    @Body(new ZodValidationPipe(createMessageScheduleSchema))
    input: CreateMessageScheduleDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await this.messaging.createSchedule(
      auth,
      input as unknown as CreateMessageScheduleInput,
      requestMetadata(request),
    );
    return {
      data: result.schedule,
      meta: { idempotentReplay: result.replayed },
    };
  }

  @Get("message-schedules/:id")
  @ApiOperation({ summary: "Gets one organization-scoped message schedule" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Message schedule" })
  @ApiNotFoundResponse({ description: "Schedule not found" })
  async schedule(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return { data: await this.messaging.schedule(auth, id) };
  }

  @Post("message-schedules/:id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancels a scheduled message" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Schedule cancelled" })
  @ApiConflictResponse({ description: "Schedule state does not allow cancellation" })
  @ApiNotFoundResponse({ description: "Schedule not found" })
  async cancelSchedule(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ) {
    return {
      data: await this.messaging.cancelSchedule(
        auth,
        id,
        requestMetadata(request),
      ),
    };
  }

  @Get("message-schedules/:id/history")
  @ApiOperation({ summary: "Lists the persisted schedule status history" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Chronological status history" })
  @ApiNotFoundResponse({ description: "Schedule not found" })
  async history(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown[] }> {
    return { data: await this.messaging.scheduleHistory(auth, id) };
  }

  @Get("message-schedules/:id/attempts")
  @ApiOperation({ summary: "Lists persisted message delivery attempts" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Chronological delivery attempts" })
  @ApiNotFoundResponse({ description: "Schedule not found" })
  async attempts(
    @CurrentAuth() auth: AuthenticatedContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown[] }> {
    return { data: await this.messaging.scheduleAttempts(auth, id) };
  }
}
