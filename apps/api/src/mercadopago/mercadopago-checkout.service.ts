import { createHash, createHmac, randomUUID } from "node:crypto";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import {
  AuditActorType,
  MercadoPagoCheckoutStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from "@mensaly/database";
import {
  BadGatewayException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { MercadoPagoConnectService } from "./mercadopago-connect.service";
import type { MercadoPagoBrickSubmission } from "./mercadopago.dto";
import {
  MERCADOPAGO_GATEWAY,
  MercadoPagoGatewayError,
  type MercadoPagoGateway,
  type MercadoPagoOrder,
} from "./mercadopago.gateway";

const LINK_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const PROVIDER_LEASE_MS = 2 * 60 * 1000;

type RequestMetadata = {
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
};

function organizationId(auth: AuthenticatedContext): string {
  if (!auth.organizationId) {
    throw new NotFoundException({ code: "ORGANIZATION_NOT_FOUND", message: "Organization context is required" });
  }
  return auth.organizationId;
}

function tokenFor(checkoutId: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`mensaly-mercadopago-checkout:${checkoutId}`)
    .digest("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function referenceMonth(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function auditMetadata(metadata: RequestMetadata) {
  return {
    ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
    ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress.slice(0, 64) } : {}),
    ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 1_024) } : {}),
  };
}

function orderPayment(order: MercadoPagoOrder) {
  return order.transactions.payments[0];
}

function orderUpdatedAt(order: MercadoPagoOrder): Date {
  const value = order.last_updated_date ?? order.created_date;
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function mercadoPagoAmountCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

export function mercadoPagoCheckoutStatus(order: MercadoPagoOrder): MercadoPagoCheckoutStatus {
  const detail = order.status_detail.toLowerCase();
  const status = order.status.toLowerCase();
  if (status === "processed" && detail === "accredited") return MercadoPagoCheckoutStatus.PAID;
  if (detail.includes("refund") || status.includes("refund")) return MercadoPagoCheckoutStatus.REFUNDED;
  if (detail.includes("chargeback") || detail.includes("dispute")) return MercadoPagoCheckoutStatus.DISPUTED;
  if (status === "expired" || detail.includes("expired")) return MercadoPagoCheckoutStatus.EXPIRED;
  if (["failed", "cancelled", "canceled", "rejected"].includes(status) || detail.includes("rejected")) {
    return MercadoPagoCheckoutStatus.FAILED;
  }
  return MercadoPagoCheckoutStatus.PROCESSING;
}

function methodFromOrder(order: MercadoPagoOrder): PaymentMethod {
  const method = orderPayment(order)?.payment_method;
  if (method?.id === "pix" || method?.type === "bank_transfer") return PaymentMethod.PIX;
  if (["credit_card", "debit_card", "prepaid_card"].includes(method?.type ?? "")) return PaymentMethod.CARD;
  return PaymentMethod.OTHER;
}

@Injectable()
export class MercadoPagoCheckoutService {
  private readonly environment = parseEnvironment(apiEnvironmentSchema, process.env);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MERCADOPAGO_GATEWAY) private readonly mercadoPago: MercadoPagoGateway,
    @Inject(MercadoPagoConnectService) private readonly connections: MercadoPagoConnectService,
  ) {}

  async createPaymentLink(auth: AuthenticatedContext, chargeId: string, metadata: RequestMetadata = {}) {
    const orgId = organizationId(auth);
    const secret = this.environment.PAYMENT_LINK_SECRET;
    if (!secret) {
      throw new ConflictException({ code: "PAYMENT_LINKS_NOT_CONFIGURED", message: "Payment links are not configured" });
    }
    const checkout = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`mercadopago-checkout-link:${chargeId}`}))`,
      );
      const charge = await tx.charge.findFirst({
        where: { id: chargeId, organizationId: orgId },
        include: { organization: { include: { mercadoPagoConnection: true } } },
      });
      if (!charge) throw new NotFoundException({ code: "RESOURCE_NOT_FOUND", message: "Charge was not found" });
      if (charge.status !== "PENDING") {
        throw new ConflictException({ code: "CHARGE_STATE_CONFLICT", message: "Only pending charges can receive a checkout link" });
      }
      const connection = charge.organization.mercadoPagoConnection;
      if (!connection || connection.status !== "CONNECTED") {
        throw new ConflictException({
          code: "MERCADOPAGO_ACCOUNT_NOT_CONNECTED",
          message: "Connect Mercado Pago before creating payment links",
        });
      }
      const existing = await tx.mercadoPagoCheckout.findFirst({
        where: {
          organizationId: orgId,
          chargeId,
          expiresAt: { gt: new Date() },
          status: { in: [MercadoPagoCheckoutStatus.OPEN, MercadoPagoCheckoutStatus.PROCESSING] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return existing;
      const checkoutId = randomUUID();
      const token = tokenFor(checkoutId, secret);
      const created = await tx.mercadoPagoCheckout.create({
        data: {
          id: checkoutId,
          organizationId: orgId,
          chargeId,
          mercadoPagoUserId: connection.mercadoPagoUserId,
          publicTokenHash: tokenHash(token),
          amountCents: charge.finalAmountCents,
          expiresAt: new Date(Date.now() + LINK_LIFETIME_MS),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "mercadopago.checkout_link.created",
          entityType: "MercadoPagoCheckout",
          entityId: created.id,
          after: { chargeId, amountCents: created.amountCents, expiresAt: created.expiresAt.toISOString() },
          ...auditMetadata(metadata),
        },
      });
      return created;
    });
    return {
      id: checkout.id,
      chargeId: checkout.chargeId,
      status: checkout.status,
      expiresAt: checkout.expiresAt,
      url: new URL(`/pagar/${tokenFor(checkout.id, secret)}`, this.environment.WEB_APP_URL).toString(),
    };
  }

  async publicDetails(token: string) {
    const checkout = await this.findPublicCheckout(token);
    return this.safeDetails(checkout);
  }

  async processPayment(token: string, submission: MercadoPagoBrickSubmission) {
    const checkout = await this.findPublicCheckout(token);
    if (
      checkout.status !== MercadoPagoCheckoutStatus.OPEN &&
      checkout.status !== MercadoPagoCheckoutStatus.PROCESSING
    ) {
      throw new GoneException({ code: "PAYMENT_LINK_INACTIVE", message: "This payment link is no longer active" });
    }
    if (checkout.charge.status !== "PENDING") {
      throw new ConflictException({ code: "CHARGE_STATE_CONFLICT", message: "This charge is no longer pending" });
    }
    if (
      submission.formData.transaction_amount !== undefined &&
      Math.round(submission.formData.transaction_amount * 100) !== checkout.amountCents
    ) {
      throw new ConflictException({ code: "PAYMENT_AMOUNT_MISMATCH", message: "Payment amount does not match the charge" });
    }
    const paymentType = submission.formData.payment_type_id ?? submission.paymentType;
    if (submission.formData.payment_method_id !== "pix" && !submission.formData.token) {
      throw new ConflictException({ code: "CARD_TOKEN_REQUIRED", message: "A secure card token is required" });
    }
    const credentials = await this.connections.credentialsForOrganization(checkout.organizationId);
    const now = new Date();
    const claim = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`mercadopago-order:${checkout.id}`}))`,
      );
      const current = await tx.mercadoPagoCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
      if (current.mercadoPagoOrderId) return { kind: "existing" as const, current };
      if (current.providerLeaseUntil && current.providerLeaseUntil > now) return { kind: "processing" as const };
      const retryingUnknownResult = current.lastErrorCode?.startsWith("RETRYABLE_") ?? false;
      const currentVersion = retryingUnknownResult
        ? current.providerAttemptVersion
        : current.providerAttemptVersion + 1;
      const updated = await tx.mercadoPagoCheckout.update({
        where: { id: current.id },
        data: {
          providerAttemptVersion: currentVersion,
          providerLeaseUntil: new Date(now.getTime() + PROVIDER_LEASE_MS),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return { kind: "claimed" as const, current: updated };
    });
    if (claim.kind === "processing") {
      throw new ConflictException({
        code: "MERCADOPAGO_ORDER_CREATION_IN_PROGRESS",
        message: "Payment creation is in progress. Try again shortly.",
      });
    }
    if (claim.kind === "existing") {
      const order = await this.mercadoPago.getOrder(credentials.accessToken, claim.current.mercadoPagoOrderId!);
      await this.applyProviderOrder(order, "provider_reconciliation", `reconcile:${order.id}`);
      return this.paymentResult(order);
    }
    try {
      const order = await this.mercadoPago.createOrder({
        accessToken: credentials.accessToken,
        checkoutId: checkout.id,
        amountCents: checkout.amountCents,
        payment: {
          paymentType,
          paymentMethodId: submission.formData.payment_method_id,
          token: submission.formData.token,
          issuerId: submission.formData.issuer_id,
          installments: submission.formData.installments,
          payer: submission.formData.payer,
        },
        idempotencyKey: `mensaly-mp-order:${checkout.id}:v${claim.current.providerAttemptVersion}`,
      });
      await this.prisma.client.mercadoPagoCheckout.update({
        where: { id: checkout.id },
        data: {
          mercadoPagoOrderId: order.id,
          mercadoPagoPaymentId: orderPayment(order)?.id,
          providerLeaseUntil: null,
        },
      });
      await this.applyProviderOrder(order, "checkout_submission", `submit:${order.id}`);
      return this.paymentResult(order);
    } catch (error) {
      const provider = error instanceof MercadoPagoGatewayError ? error : null;
      await this.prisma.client.mercadoPagoCheckout.update({
        where: { id: checkout.id },
        data: {
          providerLeaseUntil: null,
          status: provider?.retryable ? MercadoPagoCheckoutStatus.OPEN : MercadoPagoCheckoutStatus.FAILED,
          lastErrorCode: `${provider?.retryable ? "RETRYABLE_" : ""}${provider?.code ?? "MERCADOPAGO_PROVIDER_ERROR"}`.slice(0, 120),
          lastErrorMessage: (error instanceof Error ? error.message : "Mercado Pago request failed").slice(0, 1_000),
        },
      });
      throw new BadGatewayException({
        code: provider?.retryable ? "MERCADOPAGO_TEMPORARILY_UNAVAILABLE" : "MERCADOPAGO_PAYMENT_FAILED",
        message: provider?.retryable
          ? "Mercado Pago is temporarily unavailable. Try again safely."
          : "Mercado Pago could not process this payment.",
      });
    }
  }

  async reconcile(token: string) {
    const checkout = await this.findPublicCheckout(token);
    if (!checkout.mercadoPagoOrderId) return this.safeDetails(checkout);
    const credentials = await this.connections.credentialsForOrganization(checkout.organizationId);
    const order = await this.mercadoPago.getOrder(credentials.accessToken, checkout.mercadoPagoOrderId);
    await this.applyProviderOrder(order, "provider_reconciliation", `reconcile:${order.id}:${order.last_updated_date ?? order.status_detail}`);
    return this.publicDetails(token);
  }

  async applyProviderOrder(
    order: MercadoPagoOrder,
    source: "checkout_submission" | "signed_webhook" | "provider_reconciliation",
    eventId: string,
  ) {
    const checkout = await this.prisma.client.mercadoPagoCheckout.findFirst({
      where: {
        OR: [
          { mercadoPagoOrderId: order.id },
          ...(order.external_reference ? [{ id: order.external_reference }] : []),
        ],
      },
      include: { charge: true },
    });
    if (!checkout) return;
    if (checkout.mercadoPagoUserId !== (await this.prisma.client.mercadoPagoConnection.findUniqueOrThrow({
      where: { organizationId: checkout.organizationId },
      select: { mercadoPagoUserId: true },
    })).mercadoPagoUserId) return;
    if (mercadoPagoAmountCents(order.total_amount) !== checkout.amountCents) {
      throw new ConflictException({ code: "MERCADOPAGO_ORDER_AMOUNT_MISMATCH", message: "Provider order amount does not match the charge" });
    }
    const nextStatus = mercadoPagoCheckoutStatus(order);
    const occurredAt = orderUpdatedAt(order);
    const payment = orderPayment(order);
    if (nextStatus === MercadoPagoCheckoutStatus.PAID && payment) {
      await this.confirmPayment(checkout.id, order, source, eventId, occurredAt);
      return;
    }
    await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.mercadoPagoCheckout.findUniqueOrThrow({ where: { id: checkout.id } });
      if (current.lastProviderEventAt && current.lastProviderEventAt > occurredAt) return;
      await tx.mercadoPagoCheckout.update({
        where: { id: checkout.id },
        data: {
          status: nextStatus,
          mercadoPagoOrderId: order.id,
          mercadoPagoPaymentId: payment?.id,
          providerLeaseUntil: null,
          lastProviderEventAt: occurredAt,
        },
      });
      if (payment?.id && nextStatus === MercadoPagoCheckoutStatus.REFUNDED) {
        const reversed = await tx.payment.updateMany({
          where: {
            organizationId: checkout.organizationId,
            idempotencyKey: `mercadopago:${payment.id}`,
            status: { in: [PaymentStatus.CONFIRMED, PaymentStatus.PENDING_RECONCILIATION] },
          },
          data: { status: PaymentStatus.REVERSED, reversedAt: occurredAt },
        });
        if (reversed.count > 0) {
          await tx.charge.updateMany({
            where: {
              id: checkout.chargeId,
              organizationId: checkout.organizationId,
              status: "PAID",
            },
            data: { status: "PENDING", paidAt: null },
          });
        }
      }
      if (payment?.id && nextStatus === MercadoPagoCheckoutStatus.DISPUTED) {
        await tx.payment.updateMany({
          where: {
            organizationId: checkout.organizationId,
            idempotencyKey: `mercadopago:${payment.id}`,
            status: PaymentStatus.CONFIRMED,
          },
          data: { status: PaymentStatus.PENDING_RECONCILIATION },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: checkout.organizationId,
          actorType: AuditActorType.SYSTEM,
          action: "mercadopago.checkout.status_updated",
          entityType: "MercadoPagoCheckout",
          entityId: checkout.id,
          before: { status: current.status },
          after: { status: nextStatus, orderId: order.id, eventId, source },
        },
      });
    });
  }

  private async confirmPayment(
    checkoutId: string,
    order: MercadoPagoOrder,
    source: string,
    eventId: string,
    occurredAt: Date,
  ) {
    const providerPayment = orderPayment(order)!;
    await this.prisma.client.$transaction(async (tx) => {
      const checkout = await tx.mercadoPagoCheckout.findUniqueOrThrow({
        where: { id: checkoutId },
        include: { charge: true },
      });
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`charge:${checkout.chargeId}`}))`,
      );
      const current = await tx.mercadoPagoCheckout.findUniqueOrThrow({ where: { id: checkoutId } });
      if (current.status === MercadoPagoCheckoutStatus.PAID && current.mercadoPagoPaymentId === providerPayment.id) return;
      if (current.lastProviderEventAt && current.lastProviderEventAt > occurredAt) return;
      const idempotencyKey = `mercadopago:${providerPayment.id}`;
      const payment = await tx.payment.upsert({
        where: { organizationId_idempotencyKey: { organizationId: checkout.organizationId, idempotencyKey } },
        create: {
          organizationId: checkout.organizationId,
          chargeId: checkout.chargeId,
          idempotencyKey,
          amountCents: checkout.amountCents,
          method: methodFromOrder(order),
          status: checkout.charge.status === "PENDING" ? PaymentStatus.CONFIRMED : PaymentStatus.PENDING_RECONCILIATION,
          paidAt: occurredAt,
          externalReference: providerPayment.id,
          notes: source === "signed_webhook"
            ? "Confirmed by signed Mercado Pago webhook"
            : "Confirmed by Mercado Pago provider reconciliation",
        },
        update: {},
      });
      await tx.mercadoPagoCheckout.update({
        where: { id: checkout.id },
        data: {
          status: MercadoPagoCheckoutStatus.PAID,
          mercadoPagoOrderId: order.id,
          mercadoPagoPaymentId: providerPayment.id,
          providerLeaseUntil: null,
          lastProviderEventAt: occurredAt,
        },
      });
      if (checkout.charge.status === "PENDING") {
        await tx.charge.update({
          where: { id: checkout.chargeId, organizationId: checkout.organizationId },
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
            data: { status: "CANCELLED", cancelledAt: occurredAt, cancellationReason: "CHARGE_PAID" },
          });
          await tx.messageScheduleHistory.createMany({
            data: schedules.map((schedule) => ({
              organizationId: checkout.organizationId,
              scheduleId: schedule.id,
              fromStatus: schedule.status,
              toStatus: "CANCELLED",
              reason: "CHARGE_PAID",
              metadata: { paymentId: payment.id, provider: "mercadopago" },
            })),
          });
        }
      }
      await tx.auditLog.create({
        data: {
          organizationId: checkout.organizationId,
          actorType: AuditActorType.SYSTEM,
          action: "mercadopago.payment.confirmed",
          entityType: "Payment",
          entityId: payment.id,
          after: {
            chargeId: checkout.chargeId,
            checkoutId: checkout.id,
            orderId: order.id,
            paymentId: providerPayment.id,
            amountCents: payment.amountCents,
            paymentStatus: payment.status,
            eventId,
            source,
          },
        },
      });
    });
  }

  private paymentResult(order: MercadoPagoOrder) {
    const payment = orderPayment(order);
    return {
      orderId: order.id,
      paymentId: payment?.id,
      status: mercadoPagoCheckoutStatus(order),
      statusDetail: order.status_detail,
      pix: payment?.payment_method.id === "pix"
        ? {
            qrCode: payment.payment_method.qr_code,
            qrCodeBase64: payment.payment_method.qr_code_base64,
            ticketUrl: payment.payment_method.ticket_url,
          }
        : undefined,
    };
  }

  private safeDetails(checkout: Awaited<ReturnType<MercadoPagoCheckoutService["findPublicCheckout"]>>) {
    return {
      checkoutId: checkout.id,
      status: checkout.status,
      amountCents: checkout.amountCents,
      currency: checkout.currency,
      expiresAt: checkout.expiresAt,
      publicKey: checkout.connection.publicKey,
      charge: {
        dueDate: checkout.charge.dueDate,
        referenceMonth: referenceMonth(checkout.charge.referenceMonth),
        status: checkout.charge.status,
      },
      student: { name: checkout.charge.enrollment.student.name },
      organization: { name: checkout.organization.name, brand: checkout.organization.brand },
    };
  }

  private async findPublicCheckout(token: string) {
    const checkout = await this.prisma.client.mercadoPagoCheckout.findUnique({
      where: { publicTokenHash: tokenHash(token) },
      include: {
        connection: true,
        organization: true,
        charge: { include: { enrollment: { include: { student: true, guardian: true } } } },
      },
    });
    if (!checkout) throw new NotFoundException({ code: "PAYMENT_LINK_NOT_FOUND", message: "Payment link was not found" });
    if (checkout.expiresAt <= new Date()) {
      throw new GoneException({ code: "PAYMENT_LINK_EXPIRED", message: "Payment link has expired" });
    }
    return checkout;
  }
}
