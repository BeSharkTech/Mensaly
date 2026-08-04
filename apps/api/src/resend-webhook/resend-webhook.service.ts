import { createHmac, timingSafeEqual } from "node:crypto";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import {
  AuditActorType,
  TransactionalEmailDeliveryStatus,
  WebhookEventStatus,
} from "@mensaly/database";
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import { PrismaService } from "../infrastructure/database/prisma.service";
import { WebhookInboxService } from "../webhook-inbox/webhook-inbox.service";

const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

type ResendEmailEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
  };
};

type SvixHeaders = {
  id?: string;
  timestamp?: string;
  signature?: string;
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function secretBytes(secret: string): Buffer {
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return Buffer.from(encoded, "base64");
}

function expectedSignature(secret: string, signedContent: string): Buffer {
  return createHmac("sha256", secretBytes(secret)).update(signedContent).digest();
}

export function verifyResendWebhookSignature(input: {
  secret: string;
  rawBody: string;
  headers: SvixHeaders;
  now?: Date;
}): void {
  const id = input.headers.id;
  const timestamp = input.headers.timestamp;
  const signatureHeader = input.headers.signature;
  if (!id || !timestamp || !signatureHeader) {
    throw new UnauthorizedException({
      code: "RESEND_WEBHOOK_SIGNATURE_INVALID",
      message: "Webhook signature is required",
    });
  }

  const timestampMs = Number(timestamp) * 1000;
  const now = input.now ?? new Date();
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(now.getTime() - timestampMs) > MAX_WEBHOOK_AGE_MS
  ) {
    throw new UnauthorizedException({
      code: "RESEND_WEBHOOK_TIMESTAMP_INVALID",
      message: "Webhook timestamp is outside the accepted window",
    });
  }

  const expected = expectedSignature(
    input.secret,
    `${id}.${timestamp}.${input.rawBody}`,
  );
  const signatures = signatureHeader
    .split(" ")
    .map((part) => part.trim().split(","))
    .filter(([version, value]) => version === "v1" && Boolean(value))
    .map(([, value]) => Buffer.from(value, "base64"));
  const valid = signatures.some(
    (signature) =>
      signature.length === expected.length && timingSafeEqual(signature, expected),
  );
  if (!valid) {
    throw new UnauthorizedException({
      code: "RESEND_WEBHOOK_SIGNATURE_INVALID",
      message: "Webhook signature is invalid",
    });
  }
}

function deliveryDetails(event: ResendEmailEvent): {
  status?: TransactionalEmailDeliveryStatus;
  error?: string;
} {
  switch (event.type) {
    case "email.delivered":
      return { status: TransactionalEmailDeliveryStatus.DELIVERED };
    case "email.delivery_delayed":
      return { status: TransactionalEmailDeliveryStatus.DELIVERY_DELAYED };
    case "email.bounced":
      return {
        status: TransactionalEmailDeliveryStatus.BOUNCED,
        error: "The recipient mail server rejected this email",
      };
    case "email.complained":
      return {
        status: TransactionalEmailDeliveryStatus.COMPLAINED,
        error: "The recipient reported this email as unwanted",
      };
    case "email.failed":
      return {
        status: TransactionalEmailDeliveryStatus.FAILED,
        error: "Resend could not send this email",
      };
    case "email.suppressed":
      return {
        status: TransactionalEmailDeliveryStatus.SUPPRESSED,
        error: "Resend suppressed delivery to this recipient",
      };
    default:
      return {};
  }
}

function eventTime(event: ResendEmailEvent): Date {
  const parsed = event.created_at ? new Date(event.created_at) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

@Injectable()
export class ResendWebhookService {
  private readonly environment = parseEnvironment(apiEnvironmentSchema, process.env);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WebhookInboxService)
    private readonly webhookInbox: WebhookInboxService,
  ) {}

  async receive(input: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    correlationId: string;
  }): Promise<{ duplicate: boolean }> {
    const secret = this.environment.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException({
        code: "RESEND_WEBHOOK_NOT_CONFIGURED",
        message: "Resend webhook is not configured",
      });
    }
    verifyResendWebhookSignature({
      secret,
      rawBody: input.rawBody,
      headers: {
        id: headerValue(input.headers["svix-id"]),
        timestamp: headerValue(input.headers["svix-timestamp"]),
        signature: headerValue(input.headers["svix-signature"]),
      },
    });

    let event: ResendEmailEvent;
    try {
      event = JSON.parse(input.rawBody) as ResendEmailEvent;
    } catch {
      throw new BadRequestException({
        code: "RESEND_WEBHOOK_PAYLOAD_INVALID",
        message: "Webhook payload must be valid JSON",
      });
    }
    if (!event.type || typeof event.type !== "string") {
      throw new BadRequestException({
        code: "RESEND_WEBHOOK_PAYLOAD_INVALID",
        message: "Webhook event type is required",
      });
    }

    const externalEventId = headerValue(input.headers["svix-id"])!;
    const received = await this.webhookInbox.receive({
      provider: "resend",
      externalEventId,
      eventType: event.type,
      payload: event,
    });
    if (received.duplicate) return { duplicate: true };

    const processed = await this.webhookInbox.process(received.event.id, async () => {
      await this.applyDeliveryEvent(event, input.correlationId);
    });
    if (processed.status === WebhookEventStatus.FAILED_RETRYABLE) {
      throw new ServiceUnavailableException({
        code: "RESEND_WEBHOOK_PROCESSING_RETRY",
        message: "Webhook processing will be retried",
      });
    }
    return { duplicate: false };
  }

  private async applyDeliveryEvent(
    event: ResendEmailEvent,
    correlationId: string,
  ): Promise<void> {
    const providerMessageId = event.data?.email_id;
    const details = deliveryDetails(event);
    if (!providerMessageId || !details.status) return;

    const occurredAt = eventTime(event);
    await this.prisma.client.$transaction(async (tx) => {
      const email = await tx.transactionalEmail.findFirst({
        where: { providerMessageId },
      });
      if (!email || (email.providerEventAt && email.providerEventAt > occurredAt)) {
        return;
      }
      await tx.transactionalEmail.update({
        where: { id: email.id },
        data: {
          deliveryStatus: details.status,
          providerEventAt: occurredAt,
          deliveryError: details.error ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.SYSTEM,
          action: "transactional_email.delivery_event_received",
          entityType: "TransactionalEmail",
          entityId: email.id,
          after: {
            provider: "resend",
            providerMessageId,
            eventType: event.type,
            deliveryStatus: details.status,
          },
          correlationId,
        },
      });
    });
  }
}
