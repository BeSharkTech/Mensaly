import {
  AuditActorType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  StripeCheckoutStatus,
  WebhookEventStatus,
} from "@mensaly/database";
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type Stripe from "stripe";

import { PrismaService } from "../infrastructure/database/prisma.service";
import { WebhookInboxService } from "../webhook-inbox/webhook-inbox.service";
import { stripeEventMetadataSchema } from "./stripe-connect.dto";
import { StripeConnectService } from "./stripe-connect.service";
import { STRIPE_GATEWAY, type StripeGateway } from "./stripe-connect.gateway";

function sanitizedPayload(event: Stripe.Event): Record<string, unknown> {
  const object = event.data.object as unknown as Record<string, unknown>;
  return {
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
    account: event.account ?? null,
    data: {
      object: {
        id: typeof object.id === "string" ? object.id : null,
        object: typeof object.object === "string" ? object.object : null,
        status: typeof object.status === "string" ? object.status : null,
        payment_status:
          typeof object.payment_status === "string" ? object.payment_status : null,
        metadata:
          object.metadata && typeof object.metadata === "object"
            ? (object.metadata as Prisma.InputJsonValue)
            : {},
        charges_enabled:
          typeof object.charges_enabled === "boolean" ? object.charges_enabled : null,
        payouts_enabled:
          typeof object.payouts_enabled === "boolean" ? object.payouts_enabled : null,
        details_submitted:
          typeof object.details_submitted === "boolean" ? object.details_submitted : null,
        capabilities:
          object.capabilities && typeof object.capabilities === "object"
            ? (object.capabilities as Prisma.InputJsonValue)
            : {},
        requirements:
          object.requirements && typeof object.requirements === "object"
            ? (object.requirements as Prisma.InputJsonValue)
            : {},
      },
    },
  };
}

function checkoutMetadata(object: Record<string, unknown>) {
  const parsed = stripeEventMetadataSchema.safeParse(object.metadata ?? {});
  return parsed.success ? parsed.data : {};
}

function eventAccount(event: Stripe.Event): string | undefined {
  return typeof event.account === "string" ? event.account : undefined;
}

function eventDate(event: Stripe.Event): Date {
  return new Date(event.created * 1000);
}

function paymentMethod(object: Record<string, unknown>): PaymentMethod {
  const methods = Array.isArray(object.payment_method_types)
    ? object.payment_method_types
    : [];
  if (methods.length === 1 && methods[0] === "pix") return PaymentMethod.PIX;
  if (methods.length === 1 && methods[0] === "card") return PaymentMethod.CARD;
  return PaymentMethod.OTHER;
}

function paymentMethodFromStripe(value: "card" | "pix" | undefined): PaymentMethod {
  if (value === "pix") return PaymentMethod.PIX;
  if (value === "card") return PaymentMethod.CARD;
  return PaymentMethod.OTHER;
}

@Injectable()
export class StripeWebhookService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WebhookInboxService)
    private readonly webhookInbox: WebhookInboxService,
    @Inject(StripeConnectService)
    private readonly stripeConnect: StripeConnectService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async receive(input: {
    rawBody: Buffer;
    signature?: string;
    webhookSecret?: string;
  }) {
    if (!input.webhookSecret) {
      throw new ServiceUnavailableException({
        code: "STRIPE_WEBHOOK_NOT_CONFIGURED",
        message: "Stripe webhook is not configured",
      });
    }
    if (!input.signature) {
      throw new BadRequestException({
        code: "STRIPE_WEBHOOK_SIGNATURE_INVALID",
        message: "Stripe-Signature header is required",
      });
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.constructWebhookEvent(
        input.rawBody,
        input.signature,
        input.webhookSecret,
      );
    } catch {
      throw new BadRequestException({
        code: "STRIPE_WEBHOOK_SIGNATURE_INVALID",
        message: "Stripe webhook signature is invalid",
      });
    }

    const accountId = eventAccount(event);
    const connection = accountId
      ? await this.prisma.client.stripeConnection.findUnique({
          where: { stripeAccountId: accountId },
          select: { organizationId: true },
        })
      : null;
    const received = await this.webhookInbox.receive({
      provider: "stripe-connect",
      externalEventId: event.id,
      eventType: event.type,
      payload: sanitizedPayload(event),
      organizationId: connection?.organizationId,
    });
    if (received.duplicate) return { duplicate: true };

    const result = await this.webhookInbox.process(received.event.id, async () => {
      await this.processEvent(event);
    });
    if (result.status === WebhookEventStatus.FAILED_RETRYABLE) {
      throw new ServiceUnavailableException({
        code: "STRIPE_WEBHOOK_PROCESSING_RETRY",
        message: "Stripe webhook processing will be retried",
      });
    }
    return { duplicate: false };
  }

  private async processEvent(event: Stripe.Event): Promise<void> {
    const accountId = eventAccount(event);
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      await this.stripeConnect.synchronizeAccount({
        id: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        capabilities: JSON.parse(JSON.stringify(account.capabilities ?? {})) as Record<string, unknown>,
        requirements: JSON.parse(JSON.stringify(account.requirements ?? {})) as Record<string, unknown>,
      });
      return;
    }
    if (event.type === "account.application.deauthorized" && accountId) {
      await this.stripeConnect.disconnectAccount(accountId);
      return;
    }

    const object = event.data.object as unknown as Record<string, unknown>;
    const metadata = checkoutMetadata(object);
    const checkout = await this.findCheckout(event, metadata.mensalyCheckoutId);
    if (!checkout) return;

    switch (event.type) {
      case "checkout.session.completed":
        if (object.payment_status === "paid") {
          await this.confirmPayment(event, checkout.id, object, "signed_webhook");
        } else {
          await this.updateCheckout(event, checkout.id, StripeCheckoutStatus.PROCESSING, object);
        }
        return;
      case "checkout.session.async_payment_succeeded":
      case "payment_intent.succeeded":
        await this.confirmPayment(event, checkout.id, object, "signed_webhook");
        return;
      case "checkout.session.async_payment_failed":
      case "payment_intent.payment_failed":
        await this.updateCheckout(event, checkout.id, StripeCheckoutStatus.FAILED, object);
        return;
      case "checkout.session.expired":
        await this.updateCheckout(event, checkout.id, StripeCheckoutStatus.EXPIRED, object);
        return;
      case "charge.refunded":
        await this.updateCheckout(event, checkout.id, StripeCheckoutStatus.REFUNDED, object);
        return;
      case "charge.dispute.created":
        await this.updateCheckout(event, checkout.id, StripeCheckoutStatus.DISPUTED, object);
        return;
      default:
        return;
    }
  }

  async reconcilePaidCheckout(input: {
    accountId: string;
    checkoutId: string;
    sessionId: string;
    paymentIntentId: string;
    paymentStatus: string;
    paymentMethod?: "card" | "pix";
  }): Promise<void> {
    if (input.paymentStatus !== "paid") return;
    const occurredAt = new Date();
    await this.confirmPayment(
      {
        id: `reconcile_${input.sessionId}`,
        type: "checkout.session.completed",
        account: input.accountId,
        created: Math.floor(occurredAt.getTime() / 1000),
      } as Stripe.Event,
      input.checkoutId,
      {
        id: input.sessionId,
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: input.paymentIntentId,
        payment_method_types: input.paymentMethod ? [input.paymentMethod] : [],
        metadata: { mensalyCheckoutId: input.checkoutId },
      },
      "provider_reconciliation",
    );
  }

  private async findCheckout(event: Stripe.Event, checkoutId?: string) {
    const object = event.data.object as unknown as Record<string, unknown>;
    const objectId = typeof object.id === "string" ? object.id : undefined;
    const paymentIntent =
      typeof object.payment_intent === "string"
        ? object.payment_intent
        : object.object === "payment_intent" && objectId
          ? objectId
          : undefined;
    return this.prisma.client.stripeCheckout.findFirst({
      where: {
        ...(event.account ? { stripeAccountId: event.account } : {}),
        OR: [
          ...(checkoutId ? [{ id: checkoutId }] : []),
          ...(object.object === "checkout.session" && objectId
            ? [{ stripeCheckoutSessionId: objectId }]
            : []),
          ...(paymentIntent ? [{ stripePaymentIntentId: paymentIntent }] : []),
        ],
      },
    });
  }

  private async updateCheckout(
    event: Stripe.Event,
    checkoutId: string,
    status: StripeCheckoutStatus,
    object: Record<string, unknown>,
  ) {
    const occurredAt = eventDate(event);
    await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.stripeCheckout.findUniqueOrThrow({
        where: { id: checkoutId },
      });
      if (current.lastProviderEventAt && current.lastProviderEventAt > occurredAt) return;
      const paymentIntentId =
        typeof object.payment_intent === "string"
          ? object.payment_intent
          : object.object === "payment_intent" && typeof object.id === "string"
            ? object.id
            : undefined;
      const updated = await tx.stripeCheckout.update({
        where: { id: checkoutId },
        data: {
          status,
          lastProviderEventAt: occurredAt,
          ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: updated.organizationId,
          actorType: AuditActorType.SYSTEM,
          action: "stripe.checkout.status_updated",
          entityType: "StripeCheckout",
          entityId: updated.id,
          before: { status: current.status },
          after: { status: updated.status, eventType: event.type, eventId: event.id },
        },
      });
    });
  }

  private async confirmPayment(
    event: Stripe.Event,
    checkoutId: string,
    object: Record<string, unknown>,
    source: "signed_webhook" | "provider_reconciliation",
  ) {
    const occurredAt = eventDate(event);
    const paymentIntentId =
      typeof object.payment_intent === "string"
        ? object.payment_intent
        : object.object === "payment_intent" && typeof object.id === "string"
          ? object.id
          : undefined;
    if (!paymentIntentId) {
      await this.updateCheckout(event, checkoutId, StripeCheckoutStatus.PROCESSING, object);
      return;
    }

    let confirmedMethod = paymentMethod(object);
    if (
      confirmedMethod === PaymentMethod.OTHER &&
      object.object === "checkout.session" &&
      typeof object.id === "string" &&
      eventAccount(event)
    ) {
      try {
        const session = await this.stripe.retrieveCheckout(
          eventAccount(event)!,
          object.id,
        );
        confirmedMethod = paymentMethodFromStripe(session.paymentMethod);
      } catch {
        // Preserve the confirmed payment even if the optional Stripe lookup is
        // temporarily unavailable; its method remains OTHER for reconciliation.
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      const checkout = await tx.stripeCheckout.findUniqueOrThrow({
        where: { id: checkoutId },
        include: { charge: true },
      });
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${checkout.chargeId}`}))`,
      );
      const current = await tx.stripeCheckout.findUniqueOrThrow({
        where: { id: checkoutId },
      });
      if (
        current.status === StripeCheckoutStatus.PAID &&
        current.stripePaymentIntentId === paymentIntentId
      ) {
        return;
      }
      if (current.lastProviderEventAt && current.lastProviderEventAt > occurredAt) return;

      const idempotencyKey = `stripe:${paymentIntentId}`;
      const payment = await tx.payment.upsert({
        where: {
          organizationId_idempotencyKey: {
            organizationId: checkout.organizationId,
            idempotencyKey,
          },
        },
        create: {
          organizationId: checkout.organizationId,
          chargeId: checkout.chargeId,
          idempotencyKey,
          amountCents: checkout.amountCents,
          method: confirmedMethod,
          status:
            checkout.charge.status === "PENDING"
              ? PaymentStatus.CONFIRMED
              : PaymentStatus.PENDING_RECONCILIATION,
          paidAt: occurredAt,
          externalReference: paymentIntentId,
          notes:
            source === "signed_webhook"
              ? "Confirmed by signed Stripe webhook"
              : "Confirmed by direct Stripe provider reconciliation",
        },
        update: {},
      });
      await tx.stripeCheckout.update({
        where: { id: checkout.id },
        data: {
          status: StripeCheckoutStatus.PAID,
          stripePaymentIntentId: paymentIntentId,
          lastProviderEventAt: occurredAt,
        },
      });
      if (checkout.charge.status === "PENDING") {
        await tx.charge.update({
          where: {
            id: checkout.chargeId,
            organizationId: checkout.organizationId,
          },
          data: { status: "PAID", paidAt: occurredAt },
        });
        const schedules = await tx.messageSchedule.findMany({
          where: {
            organizationId: checkout.organizationId,
            chargeId: checkout.chargeId,
            status: { in: ["SCHEDULED", "QUEUED"] },
          },
          select: { id: true, status: true },
        });
        if (schedules.length) {
          await tx.messageSchedule.updateMany({
            where: { id: { in: schedules.map((item) => item.id) } },
            data: {
              status: "CANCELLED",
              cancelledAt: occurredAt,
              cancellationReason: "CHARGE_PAID",
            },
          });
          await tx.messageScheduleHistory.createMany({
            data: schedules.map((schedule) => ({
              organizationId: checkout.organizationId,
              scheduleId: schedule.id,
              fromStatus: schedule.status,
              toStatus: "CANCELLED",
              reason: "CHARGE_PAID",
              metadata: { paymentId: payment.id, provider: "stripe" },
            })),
          });
        }
      }
      await tx.auditLog.create({
        data: {
          organizationId: checkout.organizationId,
          actorType: AuditActorType.SYSTEM,
          action: "stripe.payment.confirmed",
          entityType: "Payment",
          entityId: payment.id,
          after: {
            chargeId: checkout.chargeId,
            checkoutId: checkout.id,
            paymentIntentId,
            amountCents: payment.amountCents,
            paymentStatus: payment.status,
            eventId: event.id,
            source,
          },
        },
      });
    });
  }
}
