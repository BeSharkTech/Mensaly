import {
  Prisma,
  type WebhookEvent,
  WebhookAttemptStatus,
  WebhookEventStatus,
} from "@mensaly/database";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../infrastructure/database/prisma.service";
import type {
  ReceiveWebhookEventInput,
  WebhookEventList,
} from "./webhook-inbox.dto";

const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export class WebhookProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WebhookProcessingError";
  }
}

export type WebhookHandler = (event: {
  id: string;
  provider: string;
  externalEventId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  idempotencyKey: string;
}) => Promise<void>;

function eventView<T extends { payload: Prisma.JsonValue }>(event: T): T {
  return event;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class WebhookInboxService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async receive(
    input: ReceiveWebhookEventInput,
  ): Promise<{ event: WebhookEvent; duplicate: boolean }> {
    if (input.organizationId) {
      const organization = await this.prisma.client.organization.findUnique({
        where: { id: input.organizationId },
        select: { id: true },
      });
      if (!organization) {
        throw new NotFoundException({
          code: "ORGANIZATION_NOT_FOUND",
          message: "Organization was not found",
        });
      }
    }

    const existing = await this.prisma.client.webhookEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: input.provider,
          externalEventId: input.externalEventId,
        },
      },
    });
    if (existing) {
      if (
        existing.eventType !== input.eventType ||
        existing.organizationId !== (input.organizationId ?? null) ||
        canonicalJson(existing.payload) !== canonicalJson(input.payload)
      ) {
        throw new ConflictException({
          code: "WEBHOOK_EVENT_CONFLICT",
          message: "The provider event ID was already used with other data",
        });
      }
      return { event: eventView(existing), duplicate: true };
    }

    try {
      const event = await this.prisma.client.webhookEvent.create({
        data: {
          provider: input.provider,
          externalEventId: input.externalEventId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
          organizationId: input.organizationId,
        },
      });
      return { event: eventView(event), duplicate: false };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return this.receive(input);
      }
      throw error;
    }
  }

  async list(query: WebhookEventList) {
    const where = {
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.webhookEvent.findMany({
        where,
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.webhookEvent.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: string) {
    const event = await this.prisma.client.webhookEvent.findUnique({
      where: { id },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
    });
    if (!event) {
      throw new NotFoundException({
        code: "WEBHOOK_EVENT_NOT_FOUND",
        message: "Webhook event was not found",
      });
    }
    return event;
  }

  async process(
    id: string,
    handler: WebhookHandler = async () => undefined,
    now = new Date(),
  ) {
    const claim = await this.claim(id, now);
    if (claim.kind !== "claimed") {
      return claim.event;
    }

    try {
      await handler({
        id: claim.event.id,
        provider: claim.event.provider,
        externalEventId: claim.event.externalEventId,
        eventType: claim.event.eventType,
        payload: claim.event.payload,
        idempotencyKey: `${claim.event.provider}:${claim.event.externalEventId}`,
      });
      return await this.finishSuccess(
        claim.event.id,
        claim.attemptId,
        claim.attemptNumber,
        now,
      );
    } catch (error) {
      const processingError =
        error instanceof WebhookProcessingError
          ? error
          : new WebhookProcessingError(
              "WEBHOOK_PROCESSING_ERROR",
              error instanceof Error ? error.message : "Webhook processing failed",
              true,
            );
      return this.finishFailure(
        claim.event.id,
        claim.attemptId,
        claim.attemptNumber,
        processingError,
        now,
      );
    }
  }

  private async claim(id: string, now: Date) {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`webhook-event:${id}`}))`,
      );
      const event = await tx.webhookEvent.findUnique({ where: { id } });
      if (!event) {
        throw new NotFoundException({
          code: "WEBHOOK_EVENT_NOT_FOUND",
          message: "Webhook event was not found",
        });
      }
      if (
        event.status === WebhookEventStatus.PROCESSED ||
        event.status === WebhookEventStatus.FAILED_PERMANENT
      ) {
        return { kind: "terminal" as const, event };
      }
      const leaseLimit = new Date(now.getTime() - PROCESSING_LEASE_MS);
      if (
        event.status === WebhookEventStatus.PROCESSING &&
        event.processingStartedAt &&
        event.processingStartedAt > leaseLimit
      ) {
        return { kind: "processing" as const, event };
      }
      if (event.nextAttemptAt && event.nextAttemptAt > now) {
        return { kind: "waiting" as const, event };
      }

      const attemptNumber = event.attemptCount + 1;
      const attempt = await tx.webhookEventAttempt.create({
        data: { eventId: event.id, attemptNumber },
      });
      const claimed = await tx.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: WebhookEventStatus.PROCESSING,
          attemptCount: attemptNumber,
          processingStartedAt: now,
          nextAttemptAt: null,
        },
      });
      return {
        kind: "claimed" as const,
        event: claimed,
        attemptId: attempt.id,
        attemptNumber,
      };
    });
  }

  private async finishSuccess(
    eventId: string,
    attemptId: string,
    attemptNumber: number,
    now: Date,
  ) {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`webhook-event:${eventId}`}))`,
      );
      const current = await tx.webhookEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      if (
        current.status !== WebhookEventStatus.PROCESSING ||
        current.attemptCount !== attemptNumber
      ) {
        await tx.webhookEventAttempt.update({
          where: { id: attemptId },
          data: {
            status: WebhookAttemptStatus.FAILED_PERMANENT,
            errorCode: "PROCESSING_LEASE_LOST",
            errorMessage: "A newer processing attempt owns this event",
            finishedAt: now,
          },
        });
        return current;
      }
      await tx.webhookEventAttempt.update({
        where: { id: attemptId },
        data: {
          status: WebhookAttemptStatus.SUCCEEDED,
          finishedAt: now,
        },
      });
      return tx.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: WebhookEventStatus.PROCESSED,
          processedAt: now,
          processingStartedAt: null,
          failedAt: null,
          nextAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
    });
  }

  private async finishFailure(
    eventId: string,
    attemptId: string,
    attemptNumber: number,
    error: WebhookProcessingError,
    now: Date,
  ) {
    const errorCode = error.code.slice(0, 120);
    const errorMessage = error.message.slice(0, 1_000);
    const retryable = error.retryable && attemptNumber < MAX_ATTEMPTS;
    const status = retryable
      ? WebhookEventStatus.FAILED_RETRYABLE
      : WebhookEventStatus.FAILED_PERMANENT;
    const attemptStatus = retryable
      ? WebhookAttemptStatus.FAILED_RETRYABLE
      : WebhookAttemptStatus.FAILED_PERMANENT;
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`webhook-event:${eventId}`}))`,
      );
      const current = await tx.webhookEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      if (
        current.status !== WebhookEventStatus.PROCESSING ||
        current.attemptCount !== attemptNumber
      ) {
        await tx.webhookEventAttempt.update({
          where: { id: attemptId },
          data: {
            status: WebhookAttemptStatus.FAILED_PERMANENT,
            errorCode: "PROCESSING_LEASE_LOST",
            errorMessage: "A newer processing attempt owns this event",
            finishedAt: now,
          },
        });
        return current;
      }
      await tx.webhookEventAttempt.update({
        where: { id: attemptId },
        data: {
          status: attemptStatus,
          errorCode,
          errorMessage,
          finishedAt: now,
        },
      });
      return tx.webhookEvent.update({
        where: { id: eventId },
        data: {
          status,
          processingStartedAt: null,
          failedAt: now,
          nextAttemptAt: retryable
            ? new Date(now.getTime() + 2 ** (attemptNumber - 1) * 1000)
            : null,
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage,
        },
      });
    });
  }
}
