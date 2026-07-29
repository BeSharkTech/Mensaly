import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";

import {
  PlatformAdminGuard,
  SessionAuthGuard,
} from "../authorization/authorization.guards";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  ReceiveWebhookEventDto,
  type ReceiveWebhookEventInput,
  receiveWebhookEventSchema,
  type WebhookEventList,
  webhookEventListSchema,
} from "./webhook-inbox.dto";
import { WebhookInboxService } from "./webhook-inbox.service";

const receiveSchema = {
  type: "object",
  additionalProperties: false,
  required: ["provider", "externalEventId", "eventType", "payload"] as string[],
  properties: {
    provider: { type: "string", example: "internal" },
    externalEventId: { type: "string", example: "event-123" },
    eventType: { type: "string", example: "resource.updated" },
    payload: { type: "object", additionalProperties: true },
    organizationId: { type: "string", format: "uuid" },
  },
} as const;

@ApiTags("Webhook inbox")
@Controller({ path: "admin/webhook-events", version: "1" })
@UseGuards(SessionAuthGuard, PlatformAdminGuard)
export class WebhookInboxController {
  constructor(
    @Inject(WebhookInboxService)
    private readonly inbox: WebhookInboxService,
  ) {}

  @Post()
  @ApiOperation({ summary: "Receives a provider-neutral webhook event" })
  @ApiBody({ schema: receiveSchema })
  @ApiCreatedResponse({ description: "Event persisted idempotently" })
  async receive(
    @Body(new ZodValidationPipe(receiveWebhookEventSchema))
    input: ReceiveWebhookEventDto,
  ): Promise<{ data: unknown; meta: { duplicate: boolean } }> {
    const result = await this.inbox.receive(
      input as unknown as ReceiveWebhookEventInput,
    );
    return { data: result.event, meta: { duplicate: result.duplicate } };
  }

  @Get()
  @ApiOperation({ summary: "Lists webhook inbox events" })
  @ApiOkResponse({ description: "Paginated webhook events" })
  async list(
    @Query(new ZodValidationPipe(webhookEventListSchema))
    query: WebhookEventList,
  ): Promise<{ data: unknown[]; meta: Record<string, number> }> {
    const result = await this.inbox.list(query);
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

  @Get(":id")
  @ApiOperation({ summary: "Gets a webhook event and its attempts" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Webhook event details" })
  async get(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown }> {
    return { data: await this.inbox.get(id) };
  }

  @Post(":id/process")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Processes or resumes one webhook event" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ description: "Current processing state" })
  async process(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ data: unknown }> {
    return { data: await this.inbox.process(id) };
  }
}
