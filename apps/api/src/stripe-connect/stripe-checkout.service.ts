import { createHash, createHmac, randomUUID } from "node:crypto";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import {
  AuditActorType,
  Prisma,
  StripeCheckoutStatus,
  StripeConnectionStatus,
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
import { STRIPE_GATEWAY, type StripeGateway } from "./stripe-connect.gateway";
import {
  PIX_MAXIMUM_CENTS,
  PIX_MINIMUM_CENTS,
  type StripePaymentMethodType,
} from "./stripe-connect.gateway";
import { StripeWebhookService } from "./stripe-webhook.service";

const LINK_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const PROVIDER_SESSION_LIFETIME_MS = 23 * 60 * 60 * 1000;
const SESSION_LEASE_MS = 2 * 60 * 1000;

type RequestMetadata = {
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
};

function organizationId(auth: AuthenticatedContext): string {
  if (!auth.organizationId) {
    throw new NotFoundException({
      code: "ORGANIZATION_NOT_FOUND",
      message: "Organization context is required",
    });
  }
  return auth.organizationId;
}

function tokenFor(checkoutId: string, secret: string): string {
  return createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`mensaly-checkout:${checkoutId}`)
    .digest("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function auditMetadata(metadata: RequestMetadata) {
  return {
    ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
    ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress.slice(0, 64) } : {}),
    ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 1_024) } : {}),
  };
}

function referenceMonth(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function providerError(error: unknown): { code: string; message: string } {
  const source = error as { code?: unknown; type?: unknown; message?: unknown };
  return {
    code: (typeof source.code === "string"
      ? source.code
      : typeof source.type === "string"
        ? source.type
        : "STRIPE_PROVIDER_ERROR").slice(0, 120),
    message: (typeof source.message === "string"
      ? source.message
      : "Stripe request failed").slice(0, 1_000),
  };
}

function pixCanBeOffered(
  amountCents: number,
  capabilities: Record<string, unknown>,
): boolean {
  return (
    amountCents >= PIX_MINIMUM_CENTS &&
    amountCents <= PIX_MAXIMUM_CENTS &&
    capabilities.pix_payments === "active"
  );
}

function capabilityRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class StripeCheckoutService {
  private readonly environment = parseEnvironment(apiEnvironmentSchema, process.env);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
    @Inject(StripeWebhookService) private readonly stripeWebhook: StripeWebhookService,
  ) {}

  async createPaymentLink(
    auth: AuthenticatedContext,
    chargeId: string,
    metadata: RequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const secret = this.environment.PAYMENT_LINK_SECRET;
    if (!secret) {
      throw new ConflictException({
        code: "PAYMENT_LINKS_NOT_CONFIGURED",
        message: "Payment links are not configured",
      });
    }
    const checkout = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stripe-checkout-link:${chargeId}`}))`,
      );
      const charge = await tx.charge.findFirst({
        where: { id: chargeId, organizationId: orgId },
        include: { organization: { include: { stripeConnection: true } } },
      });
      if (!charge) {
        throw new NotFoundException({
          code: "RESOURCE_NOT_FOUND",
          message: "Charge was not found",
        });
      }
      if (charge.status !== "PENDING") {
        throw new ConflictException({
          code: "CHARGE_STATE_CONFLICT",
          message: "Only pending charges can receive a checkout link",
        });
      }
      const connection = charge.organization.stripeConnection;
      const allowSandboxCheckout = this.environment.STRIPE_CONNECT_MODE === "test";
      if (
        !connection?.stripeAccountId ||
        (!allowSandboxCheckout && connection.status !== StripeConnectionStatus.ENABLED)
      ) {
        throw new ConflictException({
          code: "STRIPE_ACCOUNT_NOT_ENABLED",
          message: "Finish Stripe onboarding before creating payment links",
        });
      }
      const existing = await tx.stripeCheckout.findFirst({
        where: {
          organizationId: orgId,
          chargeId,
          expiresAt: { gt: new Date() },
          status: {
            notIn: [
              StripeCheckoutStatus.PAID,
              StripeCheckoutStatus.REFUNDED,
              StripeCheckoutStatus.DISPUTED,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return existing;

      const checkoutId = randomUUID();
      const token = tokenFor(checkoutId, secret);
      const created = await tx.stripeCheckout.create({
        data: {
          id: checkoutId,
          organizationId: orgId,
          chargeId,
          stripeAccountId: connection.stripeAccountId,
          publicTokenHash: tokenHash(token),
          amountCents: charge.finalAmountCents,
          expiresAt: new Date(Date.now() + LINK_LIFETIME_MS),
          status: StripeCheckoutStatus.OPEN,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "stripe.checkout_link.created",
          entityType: "StripeCheckout",
          entityId: created.id,
          after: {
            chargeId,
            amountCents: created.amountCents,
            expiresAt: created.expiresAt.toISOString(),
          },
          ...auditMetadata(metadata),
        },
      });
      return created;
    });
    const token = tokenFor(checkout.id, secret);
    return {
      id: checkout.id,
      chargeId: checkout.chargeId,
      status: checkout.status,
      expiresAt: checkout.expiresAt,
      url: new URL(`/pagar/${token}`, this.environment.WEB_APP_URL).toString(),
    };
  }

  async publicDetails(token: string) {
    const checkout = await this.findPublicCheckout(token);
    return {
      checkoutId: checkout.id,
      status: checkout.status,
      amountCents: checkout.amountCents,
      currency: checkout.currency,
      expiresAt: checkout.expiresAt,
      charge: {
        dueDate: checkout.charge.dueDate,
        referenceMonth: referenceMonth(checkout.charge.referenceMonth),
        status: checkout.charge.status,
      },
      student: { name: checkout.charge.enrollment.student.name },
      organization: {
        name: checkout.organization.name,
        brand: checkout.organization.brand,
      },
    };
  }

  async createOrReuseSession(token: string) {
    const checkout = await this.findPublicCheckout(token);
    if (checkout.charge.status !== "PENDING") {
      throw new ConflictException({
        code: "CHARGE_STATE_CONFLICT",
        message: "This charge is no longer pending",
      });
    }
    const allowSandboxCheckout = this.environment.STRIPE_CONNECT_MODE === "test";
    if (
      (!allowSandboxCheckout && checkout.connection.status !== StripeConnectionStatus.ENABLED) ||
      !checkout.connection.stripeAccountId
    ) {
      throw new ConflictException({
        code: "STRIPE_ACCOUNT_NOT_ENABLED",
        message: "Payments are temporarily unavailable for this business",
      });
    }
    const customer = await this.ensureCustomer(checkout);
    const now = new Date();
    if (
      checkout.stripeCheckoutSessionId &&
      checkout.providerExpiresAt &&
      checkout.providerExpiresAt > new Date(now.getTime() + 60_000) &&
      (checkout.status === StripeCheckoutStatus.OPEN ||
        checkout.status === StripeCheckoutStatus.PROCESSING)
    ) {
      const session = await this.stripe.retrieveCheckout(
        checkout.stripeAccountId,
        checkout.stripeCheckoutSessionId,
      );
      return this.clientConfiguration(checkout.stripeAccountId, session.clientSecret);
    }

    const claim = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stripe-checkout-session:${checkout.id}`}))`,
      );
      const current = await tx.stripeCheckout.findUniqueOrThrow({
        where: { id: checkout.id },
      });
      if (current.providerSessionLeaseUntil && current.providerSessionLeaseUntil > now) {
        return { kind: "processing" as const };
      }
      if (
        current.stripeCheckoutSessionId &&
        current.providerExpiresAt &&
        current.providerExpiresAt > new Date(now.getTime() + 60_000) &&
        (current.status === StripeCheckoutStatus.OPEN ||
          current.status === StripeCheckoutStatus.PROCESSING)
      ) {
        return { kind: "existing" as const, checkout: current };
      }
      const claimed = await tx.stripeCheckout.update({
        where: { id: current.id },
        data: {
          providerSessionVersion: { increment: 1 },
          providerSessionLeaseUntil: new Date(now.getTime() + SESSION_LEASE_MS),
          status: StripeCheckoutStatus.CREATING,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return { kind: "claimed" as const, checkout: claimed };
    });
    if (claim.kind === "processing") {
      throw new ConflictException({
        code: "STRIPE_CHECKOUT_CREATION_IN_PROGRESS",
        message: "Checkout creation is in progress. Try again shortly.",
      });
    }
    if (claim.kind === "existing") {
      const session = await this.stripe.retrieveCheckout(
        claim.checkout.stripeAccountId,
        claim.checkout.stripeCheckoutSessionId!,
      );
      return this.clientConfiguration(claim.checkout.stripeAccountId, session.clientSecret);
    }

    const providerExpiresAt = new Date(Date.now() + PROVIDER_SESSION_LIFETIME_MS);
    try {
      let capabilities = capabilityRecord(checkout.connection.capabilities);
      if (capabilities.pix_payments !== "active") {
        try {
          const account = await this.stripe.requestPixPaymentsCapability(
            checkout.stripeAccountId,
          );
          capabilities = account.capabilities;
          await this.prisma.client.stripeConnection.update({
            where: { organizationId: checkout.organizationId },
            data: {
              capabilities: account.capabilities as Prisma.InputJsonValue,
              chargesEnabled: account.chargesEnabled,
              payoutsEnabled: account.payoutsEnabled,
              detailsSubmitted: account.detailsSubmitted,
              lastSyncedAt: new Date(),
            },
          });
        } catch {
          // Card remains available while Stripe processes or rejects the Pix capability.
          // A later checkout safely retries capability activation.
        }
      }
      const paymentMethodTypes: StripePaymentMethodType[] = pixCanBeOffered(
        checkout.amountCents,
        capabilities,
      )
        ? ["card", "pix"]
        : ["card"];
      const session = await this.stripe.createEmbeddedCheckout({
        accountId: checkout.stripeAccountId,
        customerId: customer.stripeCustomerId,
        chargeId: checkout.chargeId,
        checkoutId: checkout.id,
        studentName: checkout.charge.enrollment.student.name,
        referenceMonth: referenceMonth(checkout.charge.referenceMonth),
        amountCents: checkout.amountCents,
        paymentMethodTypes,
        expiresAt: providerExpiresAt,
        returnUrl: new URL(
          `/pagar/${token}?retorno=stripe`,
          this.environment.WEB_APP_URL,
        ).toString(),
        idempotencyKey: `mensaly-checkout:${checkout.id}:v${claim.checkout.providerSessionVersion}`,
      });
      await this.prisma.client.stripeCheckout.update({
        where: { id: checkout.id },
        data: {
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: session.paymentIntentId,
          providerExpiresAt: session.expiresAt,
          providerSessionLeaseUntil: null,
          status: session.paymentStatus === "paid"
            ? StripeCheckoutStatus.PAID
            : StripeCheckoutStatus.OPEN,
        },
      });
      return this.clientConfiguration(checkout.stripeAccountId, session.clientSecret);
    } catch (error) {
      const details = providerError(error);
      await this.prisma.client.stripeCheckout.update({
        where: { id: checkout.id },
        data: {
          providerSessionLeaseUntil: null,
          status: StripeCheckoutStatus.FAILED,
          lastErrorCode: details.code,
          lastErrorMessage: details.message,
        },
      });
      throw new BadGatewayException({
        code: "STRIPE_CHECKOUT_CREATION_FAILED",
        message: "Checkout could not be created. Try again safely.",
      });
    }
  }

  private clientConfiguration(stripeAccountId: string, clientSecret?: string) {
    if (!clientSecret) {
      throw new BadGatewayException({
        code: "STRIPE_CHECKOUT_CLIENT_SECRET_MISSING",
        message: "Checkout session cannot be resumed. Refresh the payment status safely.",
      });
    }
    return {
      clientSecret,
      stripeAccountId,
      publishableKey: this.stripe.publishableKey,
    };
  }

  async reconcilePublicCheckout(token: string) {
    const checkout = await this.findPublicCheckout(token);
    if (!checkout.stripeCheckoutSessionId) return this.publicDetails(token);
    const session = await this.stripe.retrieveCheckout(
      checkout.stripeAccountId,
      checkout.stripeCheckoutSessionId,
    );
    if (session.paymentStatus === "paid" && session.paymentIntentId) {
      await this.stripeWebhook.reconcilePaidCheckout({
        accountId: checkout.stripeAccountId,
        checkoutId: checkout.id,
        sessionId: session.id,
        paymentIntentId: session.paymentIntentId,
        paymentStatus: session.paymentStatus,
        paymentMethod: session.paymentMethod,
      });
    }
    return this.publicDetails(token);
  }

  private async findPublicCheckout(token: string) {
    const checkout = await this.prisma.client.stripeCheckout.findUnique({
      where: { publicTokenHash: tokenHash(token) },
      include: {
        connection: true,
        organization: true,
        customer: true,
        charge: {
          include: {
            enrollment: { include: { student: true, guardian: true } },
          },
        },
      },
    });
    if (!checkout) {
      throw new NotFoundException({
        code: "PAYMENT_LINK_NOT_FOUND",
        message: "Payment link was not found",
      });
    }
    if (checkout.expiresAt <= new Date()) {
      throw new GoneException({
        code: "PAYMENT_LINK_EXPIRED",
        message: "Payment link has expired",
      });
    }
    return checkout;
  }

  private async ensureCustomer(
    checkout: Awaited<ReturnType<StripeCheckoutService["findPublicCheckout"]>>,
  ) {
    const guardian = checkout.charge.enrollment.guardian;
    const existing = await this.prisma.client.stripeCustomer.findUnique({
      where: {
        organizationId_guardianId: {
          organizationId: checkout.organizationId,
          guardianId: guardian.id,
        },
      },
    });
    if (existing) return existing;

    const providerCustomer = await this.stripe.createCustomer({
      accountId: checkout.stripeAccountId,
      guardianId: guardian.id,
      name: guardian.name,
      email: guardian.email ?? undefined,
      phone: guardian.phone,
      idempotencyKey: `mensaly-customer:${checkout.organizationId}:${guardian.id}`,
    });
    const customer = await this.prisma.client.stripeCustomer.upsert({
      where: {
        organizationId_guardianId: {
          organizationId: checkout.organizationId,
          guardianId: guardian.id,
        },
      },
      create: {
        organizationId: checkout.organizationId,
        guardianId: guardian.id,
        stripeCustomerId: providerCustomer.id,
      },
      update: {},
    });
    await this.prisma.client.auditLog.create({
      data: {
        organizationId: checkout.organizationId,
        actorType: AuditActorType.SYSTEM,
        action: "stripe.customer.created",
        entityType: "StripeCustomer",
        entityId: customer.id,
        after: { guardianId: guardian.id, stripeCustomerId: customer.stripeCustomerId },
      },
    });
    return customer;
  }
}
