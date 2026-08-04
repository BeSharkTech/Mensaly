import { createHash } from "node:crypto";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import { Prisma, WebhookEventStatus } from "@mensaly/database";
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { WebhookSignatureValidator } from "mercadopago";
import { z } from "zod";

import { PrismaService } from "../infrastructure/database/prisma.service";
import { WebhookInboxService } from "../webhook-inbox/webhook-inbox.service";
import { MercadoPagoCheckoutService } from "./mercadopago-checkout.service";
import { MercadoPagoConnectService } from "./mercadopago-connect.service";
import { MERCADOPAGO_GATEWAY, type MercadoPagoGateway } from "./mercadopago.gateway";

const eventSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  live_mode: z.boolean().optional(),
  type: z.string().trim().min(1).max(160),
  action: z.string().trim().max(160).optional(),
  date_created: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).transform(String).optional(),
  data: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
  }),
}).passthrough();

function sanitizedPayload(event: z.infer<typeof eventSchema>): Prisma.InputJsonObject {
  return {
    id: event.id ?? null,
    type: event.type,
    action: event.action ?? null,
    liveMode: event.live_mode ?? null,
    dateCreated: event.date_created ?? null,
    userId: event.user_id ?? null,
    data: { id: event.data.id },
  };
}

function deterministicEventId(event: z.infer<typeof eventSchema>, requestId: string): string {
  if (event.id) return event.id;
  return createHash("sha256")
    .update(`${requestId}:${event.type}:${event.action ?? ""}:${event.data.id}:${event.date_created ?? ""}`)
    .digest("hex");
}

@Injectable()
export class MercadoPagoWebhookService {
  private readonly environment = parseEnvironment(apiEnvironmentSchema, process.env);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WebhookInboxService) private readonly webhookInbox: WebhookInboxService,
    @Inject(MercadoPagoConnectService) private readonly connections: MercadoPagoConnectService,
    @Inject(MercadoPagoCheckoutService) private readonly checkout: MercadoPagoCheckoutService,
    @Inject(MERCADOPAGO_GATEWAY) private readonly mercadoPago: MercadoPagoGateway,
  ) {}

  async receive(input: {
    body: unknown;
    signature?: string;
    requestId?: string;
    dataId?: string;
  }) {
    const secret = this.environment.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException({
        code: "MERCADOPAGO_WEBHOOK_NOT_CONFIGURED",
        message: "Mercado Pago webhook is not configured",
      });
    }
    if (!input.signature || !input.requestId || !input.dataId) {
      throw new BadRequestException({
        code: "MERCADOPAGO_WEBHOOK_SIGNATURE_INVALID",
        message: "Signed Mercado Pago webhook headers and data.id are required",
      });
    }
    try {
      WebhookSignatureValidator.validate({
        xSignature: input.signature,
        xRequestId: input.requestId,
        dataId: input.dataId,
        secret,
        toleranceSeconds: 300,
      });
    } catch {
      throw new BadRequestException({
        code: "MERCADOPAGO_WEBHOOK_SIGNATURE_INVALID",
        message: "Mercado Pago webhook signature is invalid",
      });
    }
    const parsed = eventSchema.safeParse(input.body);
    if (!parsed.success || parsed.data.data.id !== input.dataId) {
      throw new BadRequestException({
        code: "MERCADOPAGO_WEBHOOK_PAYLOAD_INVALID",
        message: "Mercado Pago webhook payload is invalid",
      });
    }
    const event = parsed.data;
    const checkout = await this.prisma.client.mercadoPagoCheckout.findFirst({
      where: { mercadoPagoOrderId: event.data.id },
      select: { organizationId: true },
    });
    const connection = checkout
      ? { organizationId: checkout.organizationId }
      : event.user_id
        ? await this.prisma.client.mercadoPagoConnection.findUnique({
            where: { mercadoPagoUserId: event.user_id },
            select: { organizationId: true },
          })
        : null;
    const received = await this.webhookInbox.receive({
      provider: "mercadopago",
      externalEventId: deterministicEventId(event, input.requestId),
      eventType: event.action ?? event.type,
      payload: sanitizedPayload(event),
      organizationId: connection?.organizationId,
    });
    const result = await this.webhookInbox.process(received.event.id, async () => {
      if (!["order", "orders"].includes(event.type)) return;
      if (!connection?.organizationId) return;
      const credentials = await this.connections.credentialsForOrganization(connection.organizationId);
      const order = await this.mercadoPago.getOrder(credentials.accessToken, event.data.id);
      await this.checkout.applyProviderOrder(order, "signed_webhook", received.event.externalEventId);
    });
    if (result.status === WebhookEventStatus.FAILED_RETRYABLE) {
      throw new ServiceUnavailableException({
        code: "MERCADOPAGO_WEBHOOK_PROCESSING_RETRY",
        message: "Mercado Pago webhook processing must be retried",
      });
    }
    return { duplicate: received.duplicate, status: result.status };
  }
}
