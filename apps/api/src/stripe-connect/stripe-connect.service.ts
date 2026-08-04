import { randomUUID } from "node:crypto";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import {
  AuditActorType,
  Prisma,
  StripeConnectAccountType,
  StripeConnectionStatus,
} from "@mensaly/database";
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import {
  STRIPE_GATEWAY,
  type ConnectedAccountSnapshot,
  type StripeGateway,
} from "./stripe-connect.gateway";

const CREATION_LEASE_MS = 2 * 60 * 1000;

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

function auditMetadata(metadata: RequestMetadata) {
  return {
    ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
    ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress.slice(0, 64) } : {}),
    ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 1_024) } : {}),
  };
}

function errorDetails(error: unknown): { code: string; message: string } {
  const source = error as { code?: unknown; type?: unknown; message?: unknown };
  const code =
    typeof source.code === "string"
      ? source.code
      : typeof source.type === "string"
        ? source.type
        : "STRIPE_PROVIDER_ERROR";
  const message =
    typeof source.message === "string"
      ? source.message
      : "Stripe request failed";
  return { code: code.slice(0, 120), message: message.slice(0, 1_000) };
}

export function stripeProductDescription(brand: Prisma.JsonValue): string {
  const segment =
    brand && typeof brand === "object" && !Array.isArray(brand)
      ? (brand as Record<string, unknown>).segment
      : undefined;
  const service =
    typeof segment === "string" && segment.trim()
      ? `serviços de ${segment.trim()}`
      : "serviços recorrentes";
  return `Prestação de ${service}, com cobrança de mensalidades de alunos ou clientes.`.slice(
    0,
    240,
  );
}

export function stripeSupportPhone(phone: string | null): string | undefined {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  ) {
    return `+${digits}`;
  }
  return undefined;
}

export function stripeConnectionStatus(
  account: ConnectedAccountSnapshot,
): StripeConnectionStatus {
  const requirements = account.requirements as {
    currently_due?: unknown[];
    pending_verification?: unknown[];
    disabled_reason?: string | null;
  };
  if (account.chargesEnabled && account.payoutsEnabled) {
    return StripeConnectionStatus.ENABLED;
  }
  if (requirements.disabled_reason) {
    return StripeConnectionStatus.RESTRICTED;
  }
  if ((requirements.currently_due?.length ?? 0) > 0) {
    return StripeConnectionStatus.REQUIREMENTS_DUE;
  }
  if (account.detailsSubmitted || (requirements.pending_verification?.length ?? 0) > 0) {
    return StripeConnectionStatus.UNDER_REVIEW;
  }
  return StripeConnectionStatus.ONBOARDING;
}

@Injectable()
export class StripeConnectService {
  private readonly environment = parseEnvironment(apiEnvironmentSchema, process.env);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  async getStatus(auth: AuthenticatedContext) {
    const connection = await this.prisma.client.stripeConnection.findUnique({
      where: { organizationId: organizationId(auth) },
    });
    return connection ?? {
      status: "NOT_CONNECTED",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    };
  }

  async ensureAccount(
    auth: AuthenticatedContext,
    metadata: RequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const now = new Date();
    const claim = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stripe-account:${orgId}`}))`,
      );
      const organization = await tx.organization.findUnique({
        where: { id: orgId },
        include: { owner: { select: { email: true } } },
      });
      if (!organization) {
        throw new NotFoundException({
          code: "ORGANIZATION_NOT_FOUND",
          message: "Organization was not found",
        });
      }
      const current = await tx.stripeConnection.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId },
        update: {},
      });
      if (current.stripeAccountId) {
        if (current.accountType !== StripeConnectAccountType.EXPRESS) {
          return { kind: "legacy" as const, connection: current, organization };
        }
        return { kind: "existing" as const, connection: current, organization };
      }
      if (current.creationLeaseUntil && current.creationLeaseUntil > now) {
        return { kind: "processing" as const, connection: current, organization };
      }
      const claimed = await tx.stripeConnection.update({
        where: { organizationId: orgId },
        data: {
          creationLeaseUntil: new Date(now.getTime() + CREATION_LEASE_MS),
          creationAttemptCount: { increment: 1 },
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return { kind: "claimed" as const, connection: claimed, organization };
    });

    if (claim.kind === "legacy") {
      throw new ConflictException({
        code: "STRIPE_EXPRESS_RECONNECT_REQUIRED",
        message: "Reconnect your Stripe account to migrate to Stripe Express.",
      });
    }
    if (claim.kind !== "claimed") return claim.connection;

    try {
      const account = await this.stripe.createConnectedAccount({
        organizationId: orgId,
        email: claim.organization.owner.email,
        businessName: claim.organization.legalName ?? claim.organization.name,
        supportPhone: stripeSupportPhone(claim.organization.phone),
        // Stripe retains an idempotency response, including a provider-side
        // validation error. Each persisted creation attempt therefore gets its
        // own key, while concurrent requests share the same claimed attempt.
        idempotencyKey: `mensaly-connect-account:${orgId}:${claim.connection.creationAttemptCount}`,
      });
      return await this.prisma.client.$transaction(async (tx) => {
        const updated = await tx.stripeConnection.update({
          where: { organizationId: orgId },
          data: {
            stripeAccountId: account.id,
            accountType: StripeConnectAccountType.EXPRESS,
            status: stripeConnectionStatus(account),
            chargesEnabled: account.chargesEnabled,
            payoutsEnabled: account.payoutsEnabled,
            detailsSubmitted: account.detailsSubmitted,
            capabilities: account.capabilities as Prisma.InputJsonValue,
            requirements: account.requirements as Prisma.InputJsonValue,
            creationLeaseUntil: null,
            lastSyncedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "stripe.connection.created",
            entityType: "StripeConnection",
            entityId: updated.id,
            after: {
              stripeAccountId: account.id,
              status: updated.status,
              chargesEnabled: updated.chargesEnabled,
            },
            ...auditMetadata(metadata),
          },
        });
        return updated;
      });
    } catch (error) {
      const details = errorDetails(error);
      await this.prisma.client.stripeConnection.update({
        where: { organizationId: orgId },
        data: {
          creationLeaseUntil: null,
          lastErrorCode: details.code,
          lastErrorMessage: details.message,
        },
      });
      throw new BadGatewayException({
        code: "STRIPE_ACCOUNT_CREATION_FAILED",
        message: "Stripe account could not be created. Try again safely.",
      });
    }
  }

  async createOnboardingLink(
    auth: AuthenticatedContext,
    metadata: RequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const connection = await this.ensureAccount(auth, metadata);
    if (!connection.stripeAccountId) {
      throw new ConflictException({
        code: "STRIPE_ACCOUNT_CREATION_IN_PROGRESS",
        message: "Stripe account creation is already in progress",
      });
    }
    if (connection.status === StripeConnectionStatus.DISCONNECTED) {
      throw new ConflictException({
        code: "STRIPE_ACCOUNT_DISCONNECTED",
        message: "The Stripe account is disconnected",
      });
    }
    const link = await this.stripe.createOnboardingLink({
      accountId: connection.stripeAccountId,
      refreshUrl: new URL("/onboarding?stripe=refresh", this.environment.WEB_APP_URL).toString(),
      returnUrl: new URL("/onboarding?stripe=return", this.environment.WEB_APP_URL).toString(),
    });
    await this.prisma.client.auditLog.create({
      data: {
        organizationId: orgId,
        actorUserId: auth.userId,
        actorType: AuditActorType.USER,
        action: "stripe.onboarding_link.created",
        entityType: "StripeConnection",
        entityId: connection.id,
        after: { expiresAt: link.expiresAt.toISOString(), requestId: randomUUID() },
        ...auditMetadata(metadata),
      },
    });
    return link;
  }

  async createEmbeddedOnboardingSession(
    auth: AuthenticatedContext,
    metadata: RequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const connection = await this.ensureAccount(auth, metadata);
    if (!connection.stripeAccountId) {
      throw new ConflictException({
        code: "STRIPE_ACCOUNT_CREATION_IN_PROGRESS",
        message: "Stripe account creation is already in progress",
      });
    }
    if (connection.status === StripeConnectionStatus.DISCONNECTED) {
      throw new ConflictException({
        code: "STRIPE_ACCOUNT_DISCONNECTED",
        message: "The Stripe account is disconnected",
      });
    }

    try {
      const publishableKey = this.stripe.publishableKey;
      if (!publishableKey) {
        throw new Error("Stripe publishable key is not configured");
      }
      const organization = await this.prisma.client.organization.findUnique({
        where: { id: orgId },
        select: { name: true, legalName: true, brand: true, phone: true },
      });
      if (!organization) {
        throw new Error("Organization was not found while preparing Stripe onboarding");
      }
      const session = await this.stripe.createEmbeddedOnboardingSession({
        accountId: connection.stripeAccountId,
        businessName: organization.legalName ?? organization.name,
        productDescription: stripeProductDescription(organization.brand),
        supportPhone: stripeSupportPhone(organization.phone),
      });
      await this.prisma.client.$transaction(async (tx) => {
        await tx.stripeConnection.update({
          where: { id: connection.id },
          data: { lastErrorCode: null, lastErrorMessage: null },
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "stripe.embedded_onboarding_session.created",
            entityType: "StripeConnection",
            entityId: connection.id,
            after: {
              expiresAt: session.expiresAt.toISOString(),
              requestId: randomUUID(),
            },
            ...auditMetadata(metadata),
          },
        });
      });
      return {
        clientSecret: session.clientSecret,
        publishableKey,
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      const details = errorDetails(error);
      await this.prisma.client.$transaction(async (tx) => {
        await tx.stripeConnection.update({
          where: { id: connection.id },
          data: {
            lastErrorCode: details.code,
            lastErrorMessage: details.message,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "stripe.embedded_onboarding_session.failed",
            entityType: "StripeConnection",
            entityId: connection.id,
            after: { errorCode: details.code, requestId: randomUUID() },
            ...auditMetadata(metadata),
          },
        });
      });
      throw new BadGatewayException({
        code: "STRIPE_ONBOARDING_SESSION_FAILED",
        message: "Stripe onboarding could not be loaded. Try again safely.",
      });
    }
  }

  async refreshAuthenticatedAccount(auth: AuthenticatedContext) {
    const connection = await this.prisma.client.stripeConnection.findUnique({
      where: { organizationId: organizationId(auth) },
    });
    if (!connection?.stripeAccountId) return this.getStatus(auth);
    const account = await this.stripe.retrieveConnectedAccount(connection.stripeAccountId);
    return this.synchronizeAccount(account);
  }

  async reconnectAsExpress(
    auth: AuthenticatedContext,
    metadata: RequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stripe-account:${orgId}`}))`,
      );
      const connection = await tx.stripeConnection.findUnique({
        where: { organizationId: orgId },
      });
      if (!connection?.stripeAccountId || connection.accountType === StripeConnectAccountType.EXPRESS) {
        return;
      }
      const [customerCount, checkoutCount] = await Promise.all([
        tx.stripeCustomer.count({ where: { organizationId: orgId } }),
        tx.stripeCheckout.count({ where: { organizationId: orgId } }),
      ]);
      if (customerCount || checkoutCount) {
        throw new ConflictException({
          code: "STRIPE_EXPRESS_RECONNECT_BLOCKED_BY_HISTORY",
          message: "Existing Stripe payment history must be reconciled before reconnecting.",
        });
      }
      const oldAccountId = connection.stripeAccountId;
      await tx.stripeConnection.update({
        where: { id: connection.id },
        data: {
          stripeAccountId: null,
          accountType: StripeConnectAccountType.EXPRESS,
          status: StripeConnectionStatus.PENDING_CREATION,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          capabilities: Prisma.DbNull,
          requirements: Prisma.DbNull,
          disconnectedAt: new Date(),
          creationLeaseUntil: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "stripe.connection.express_reconnect_started",
          entityType: "StripeConnection",
          entityId: connection.id,
          before: { stripeAccountId: oldAccountId, accountType: connection.accountType },
          after: { accountType: StripeConnectAccountType.EXPRESS },
          ...auditMetadata(metadata),
        },
      });
    });
    return this.ensureAccount(auth, metadata);
  }

  async synchronizeAccount(account: ConnectedAccountSnapshot) {
    const current = await this.prisma.client.stripeConnection.findUnique({
      where: { stripeAccountId: account.id },
    });
    if (!current) return null;
    const status = stripeConnectionStatus(account);
    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.stripeConnection.update({
        where: { id: current.id },
        data: {
          status,
          chargesEnabled: account.chargesEnabled,
          payoutsEnabled: account.payoutsEnabled,
          detailsSubmitted: account.detailsSubmitted,
          capabilities: account.capabilities as Prisma.InputJsonValue,
          requirements: account.requirements as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: current.organizationId,
          actorType: AuditActorType.SYSTEM,
          action: "stripe.connection.synchronized",
          entityType: "StripeConnection",
          entityId: current.id,
          before: {
            status: current.status,
            chargesEnabled: current.chargesEnabled,
            payoutsEnabled: current.payoutsEnabled,
          },
          after: {
            status: updated.status,
            chargesEnabled: updated.chargesEnabled,
            payoutsEnabled: updated.payoutsEnabled,
          },
        },
      });
      return updated;
    });
  }

  async disconnectAccount(accountId: string) {
    const current = await this.prisma.client.stripeConnection.findUnique({
      where: { stripeAccountId: accountId },
    });
    if (!current) return null;
    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.stripeConnection.update({
        where: { id: current.id },
        data: {
          status: StripeConnectionStatus.DISCONNECTED,
          chargesEnabled: false,
          payoutsEnabled: false,
          disconnectedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: current.organizationId,
          actorType: AuditActorType.SYSTEM,
          action: "stripe.connection.disconnected",
          entityType: "StripeConnection",
          entityId: current.id,
          before: { status: current.status },
          after: { status: updated.status },
        },
      });
      return updated;
    });
  }
}
