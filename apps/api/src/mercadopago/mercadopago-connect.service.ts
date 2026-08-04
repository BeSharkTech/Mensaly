import { createHash, randomBytes } from "node:crypto";

import { decryptPayload, encryptPayload, type EncryptedPayload } from "@mensaly/auth";
import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import { AuditActorType, MercadoPagoConnectionStatus, Prisma } from "@mensaly/database";
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import {
  MERCADOPAGO_GATEWAY,
  MercadoPagoGatewayError,
  type MercadoPagoGateway,
  type MercadoPagoOAuthCredentials,
} from "./mercadopago.gateway";

const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_WINDOW_MS = 10 * 60 * 1000;

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

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function auditMetadata(metadata: RequestMetadata) {
  return {
    ...(metadata.correlationId ? { correlationId: metadata.correlationId } : {}),
    ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress.slice(0, 64) } : {}),
    ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 1_024) } : {}),
  };
}

function encryptedPayload(value: Prisma.JsonValue): EncryptedPayload {
  return value as unknown as EncryptedPayload;
}

@Injectable()
export class MercadoPagoConnectService {
  private readonly environment = parseEnvironment(apiEnvironmentSchema, process.env);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MERCADOPAGO_GATEWAY) private readonly mercadoPago: MercadoPagoGateway,
  ) {}

  async getStatus(auth: AuthenticatedContext) {
    if (this.directTestMode()) {
      return {
        status: "CONNECTED",
        liveMode: false,
        connectionMode: "direct",
      };
    }
    const connection = await this.prisma.client.mercadoPagoConnection.findUnique({
      where: { organizationId: organizationId(auth) },
      select: {
        id: true,
        mercadoPagoUserId: true,
        status: true,
        liveMode: true,
        scopes: true,
        tokenExpiresAt: true,
        lastRefreshedAt: true,
        disconnectedAt: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        updatedAt: true,
      },
    });
    return connection ?? {
      status: "NOT_CONNECTED",
      liveMode: this.environment.MERCADOPAGO_MODE === "live",
    };
  }

  async createAuthorization(auth: AuthenticatedContext, metadata: RequestMetadata = {}) {
    if (this.directTestMode()) {
      await this.ensurePaymentConnection(auth, metadata);
      return { authorizationUrl: null, status: "CONNECTED", connectionMode: "direct" };
    }
    if (!this.mercadoPago.enabled) {
      throw new ServiceUnavailableException({
        code: "MERCADOPAGO_NOT_CONFIGURED",
        message: "Mercado Pago is not configured",
      });
    }
    const orgId = organizationId(auth);
    const state = randomBytes(32).toString("base64url");
    await this.prisma.client.$transaction(async (tx) => {
      await tx.mercadoPagoOAuthState.deleteMany({
        where: { organizationId: orgId, expiresAt: { lt: new Date() } },
      });
      const created = await tx.mercadoPagoOAuthState.create({
        data: {
          organizationId: orgId,
          userId: auth.userId,
          stateHash: stateHash(state),
          expiresAt: new Date(Date.now() + OAUTH_STATE_LIFETIME_MS),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "mercadopago.oauth.started",
          entityType: "MercadoPagoOAuthState",
          entityId: created.id,
          ...auditMetadata(metadata),
        },
      });
    });
    return { authorizationUrl: this.mercadoPago.authorizationUrl({ state }) };
  }

  async completeAuthorization(
    auth: AuthenticatedContext,
    input: { code: string; state: string },
    metadata: RequestMetadata = {},
  ) {
    const orgId = organizationId(auth);
    const claimed = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`mercadopago-oauth:${stateHash(input.state)}`}))`,
      );
      const state = await tx.mercadoPagoOAuthState.findUnique({
        where: { stateHash: stateHash(input.state) },
      });
      if (
        !state ||
        state.organizationId !== orgId ||
        state.userId !== auth.userId ||
        state.consumedAt ||
        state.expiresAt <= new Date()
      ) {
        throw new ConflictException({
          code: "MERCADOPAGO_OAUTH_STATE_INVALID",
          message: "Mercado Pago authorization expired or is invalid",
        });
      }
      return tx.mercadoPagoOAuthState.update({
        where: { id: state.id },
        data: { consumedAt: new Date() },
      });
    });

    let credentials: MercadoPagoOAuthCredentials;
    try {
      credentials = await this.mercadoPago.exchangeAuthorizationCode(input);
    } catch (error) {
      await this.recordOAuthFailure(orgId, auth.userId, claimed.id, error, metadata);
      throw new BadGatewayException({
        code: "MERCADOPAGO_OAUTH_EXCHANGE_FAILED",
        message: "Mercado Pago authorization could not be completed. Connect again safely.",
      });
    }

    const expectedLiveMode = this.environment.MERCADOPAGO_MODE === "live";
    if (credentials.live_mode !== expectedLiveMode) {
      throw new ConflictException({
        code: "MERCADOPAGO_MODE_MISMATCH",
        message: "The connected Mercado Pago account does not match this environment",
      });
    }
    const encryptionKey = this.encryptionKey();
    try {
      const connection = await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.mercadoPagoConnection.findUnique({
          where: { mercadoPagoUserId: credentials.user_id },
          select: { organizationId: true },
        });
        if (existing && existing.organizationId !== orgId) {
          throw new ConflictException({
            code: "MERCADOPAGO_ACCOUNT_ALREADY_CONNECTED",
            message: "This Mercado Pago account is already connected to another business",
          });
        }
        const previous = await tx.mercadoPagoConnection.findUnique({
          where: { organizationId: orgId },
          select: { mercadoPagoUserId: true },
        });
        if (previous && previous.mercadoPagoUserId !== credentials.user_id) {
          await tx.mercadoPagoCheckout.updateMany({
            where: {
              organizationId: orgId,
              status: { in: ["OPEN", "PROCESSING"] },
            },
            data: {
              status: "FAILED",
              providerLeaseUntil: null,
              lastErrorCode: "MERCADOPAGO_ACCOUNT_RECONNECTED",
              lastErrorMessage: "Payment link invalidated because the receiving account changed",
            },
          });
        }
        const updated = await tx.mercadoPagoConnection.upsert({
          where: { organizationId: orgId },
          create: this.connectionData(orgId, credentials, encryptionKey),
          update: this.connectionData(orgId, credentials, encryptionKey),
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: auth.userId,
            actorType: AuditActorType.USER,
            action: "mercadopago.connection.connected",
            entityType: "MercadoPagoConnection",
            entityId: updated.id,
            after: {
              mercadoPagoUserId: updated.mercadoPagoUserId,
              liveMode: updated.liveMode,
              scopes: updated.scopes,
              tokenExpiresAt: updated.tokenExpiresAt.toISOString(),
            },
            ...auditMetadata(metadata),
          },
        });
        return updated;
      });
      return { status: connection.status, liveMode: connection.liveMode };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new BadGatewayException({
        code: "MERCADOPAGO_CONNECTION_SAVE_FAILED",
        message: "Mercado Pago credentials could not be stored safely",
      });
    }
  }

  async disconnect(auth: AuthenticatedContext, metadata: RequestMetadata = {}) {
    if (this.directTestMode()) {
      throw new ConflictException({
        code: "MERCADOPAGO_DIRECT_TEST_CONFIGURED",
        message: "Direct test credentials are configured by the local environment",
      });
    }
    const orgId = organizationId(auth);
    const encryptionKey = this.encryptionKey();
    const connection = await this.prisma.client.mercadoPagoConnection.findUnique({
      where: { organizationId: orgId },
    });
    if (!connection) return { status: "NOT_CONNECTED" };
    const revokedPayload = encryptPayload({ revoked: true, at: new Date().toISOString() }, encryptionKey);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.mercadoPagoCheckout.updateMany({
        where: {
          organizationId: orgId,
          status: { in: ["OPEN", "PROCESSING"] },
        },
        data: {
          status: "FAILED",
          providerLeaseUntil: null,
          lastErrorCode: "MERCADOPAGO_ACCOUNT_DISCONNECTED",
          lastErrorMessage: "Payment link invalidated because the receiving account was disconnected",
        },
      });
      const result = await tx.mercadoPagoConnection.update({
        where: { organizationId: orgId },
        data: {
          encryptedAccessToken: revokedPayload as unknown as Prisma.InputJsonValue,
          encryptedRefreshToken: revokedPayload as unknown as Prisma.InputJsonValue,
          status: MercadoPagoConnectionStatus.DISCONNECTED,
          disconnectedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "mercadopago.connection.disconnected",
          entityType: "MercadoPagoConnection",
          entityId: result.id,
          ...auditMetadata(metadata),
        },
      });
      return result;
    });
    return { status: updated.status };
  }

  async credentialsForOrganization(organizationId: string) {
    if (this.directTestMode()) {
      const connection = await this.prisma.client.mercadoPagoConnection.findUnique({
        where: { organizationId },
      });
      if (!connection || connection.status !== MercadoPagoConnectionStatus.CONNECTED) {
        throw new ConflictException({
          code: "MERCADOPAGO_TEST_CONNECTION_NOT_INITIALIZED",
          message: "Create a payment link to initialize the local test connection",
        });
      }
      return {
        accessToken: this.environment.MERCADOPAGO_ACCESS_TOKEN!,
        publicKey: this.environment.MERCADOPAGO_PUBLIC_KEY!,
        mercadoPagoUserId: connection.mercadoPagoUserId,
        liveMode: false,
      };
    }
    let connection = await this.prisma.client.mercadoPagoConnection.findUnique({
      where: { organizationId },
    });
    if (!connection || connection.status !== MercadoPagoConnectionStatus.CONNECTED) {
      throw new ConflictException({
        code: "MERCADOPAGO_ACCOUNT_NOT_CONNECTED",
        message: "Payments are unavailable until this business connects Mercado Pago",
      });
    }
    const encryptionKey = this.encryptionKey();
    if (connection.tokenExpiresAt.getTime() <= Date.now() + TOKEN_REFRESH_WINDOW_MS) {
      try {
        const refreshToken = decryptPayload<{ token: string }>(
          encryptedPayload(connection.encryptedRefreshToken),
          encryptionKey,
        ).token;
        const refreshed = await this.mercadoPago.refreshAuthorization(refreshToken);
        connection = await this.prisma.client.mercadoPagoConnection.update({
          where: { organizationId },
          data: this.connectionData(organizationId, refreshed, encryptionKey),
        });
      } catch (error) {
        await this.prisma.client.mercadoPagoConnection.update({
          where: { organizationId },
          data: {
            status: MercadoPagoConnectionStatus.TOKEN_EXPIRED,
            lastErrorCode: error instanceof MercadoPagoGatewayError ? error.code : "TOKEN_REFRESH_FAILED",
            lastErrorMessage: error instanceof Error ? error.message.slice(0, 1_000) : "Token refresh failed",
          },
        });
        throw new ServiceUnavailableException({
          code: "MERCADOPAGO_TOKEN_REFRESH_FAILED",
          message: "The business must reconnect Mercado Pago",
        });
      }
    }
    const accessToken = decryptPayload<{ token: string }>(
      encryptedPayload(connection.encryptedAccessToken),
      encryptionKey,
    ).token;
    return {
      accessToken,
      publicKey: connection.publicKey,
      mercadoPagoUserId: connection.mercadoPagoUserId,
      liveMode: connection.liveMode,
    };
  }

  private connectionData(
    organizationId: string,
    credentials: MercadoPagoOAuthCredentials,
    encryptionKey: string,
  ) {
    return {
      organizationId,
      mercadoPagoUserId: credentials.user_id,
      publicKey: credentials.public_key,
      encryptedAccessToken: encryptPayload({ token: credentials.access_token }, encryptionKey) as unknown as Prisma.InputJsonValue,
      encryptedRefreshToken: encryptPayload({ token: credentials.refresh_token }, encryptionKey) as unknown as Prisma.InputJsonValue,
      status: MercadoPagoConnectionStatus.CONNECTED,
      liveMode: credentials.live_mode,
      scopes: credentials.scope,
      tokenExpiresAt: new Date(Date.now() + credentials.expires_in * 1_000),
      lastRefreshedAt: new Date(),
      disconnectedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
  }

  async ensurePaymentConnection(auth: AuthenticatedContext, metadata: RequestMetadata = {}) {
    if (!this.directTestMode()) return;
    const orgId = organizationId(auth);
    const existing = await this.prisma.client.mercadoPagoConnection.findUnique({
      where: { organizationId: orgId },
    });
    if (existing?.mercadoPagoUserId === `direct-test:${orgId}` && existing.status === MercadoPagoConnectionStatus.CONNECTED) {
      return;
    }
    const encryptionKey = this.encryptionKey();
    const encryptedAccessToken = encryptPayload(
      { token: this.environment.MERCADOPAGO_ACCESS_TOKEN! },
      encryptionKey,
    ) as unknown as Prisma.InputJsonValue;
    const encryptedRefreshToken = encryptPayload(
      { directTest: true },
      encryptionKey,
    ) as unknown as Prisma.InputJsonValue;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`mercadopago-direct-test:${orgId}`}))`,
      );
      const connection = await tx.mercadoPagoConnection.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          mercadoPagoUserId: `direct-test:${orgId}`,
          publicKey: this.environment.MERCADOPAGO_PUBLIC_KEY!,
          encryptedAccessToken,
          encryptedRefreshToken,
          status: MercadoPagoConnectionStatus.CONNECTED,
          liveMode: false,
          scopes: "payments write direct-test",
          tokenExpiresAt: new Date("2100-01-01T00:00:00.000Z"),
          lastRefreshedAt: new Date(),
        },
        update: {
          mercadoPagoUserId: `direct-test:${orgId}`,
          publicKey: this.environment.MERCADOPAGO_PUBLIC_KEY!,
          encryptedAccessToken,
          encryptedRefreshToken,
          status: MercadoPagoConnectionStatus.CONNECTED,
          liveMode: false,
          scopes: "payments write direct-test",
          tokenExpiresAt: new Date("2100-01-01T00:00:00.000Z"),
          lastRefreshedAt: new Date(),
          disconnectedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: auth.userId,
          actorType: AuditActorType.USER,
          action: "mercadopago.connection.direct_test_initialized",
          entityType: "MercadoPagoConnection",
          entityId: connection.id,
          after: { liveMode: false, connectionMode: "direct" },
          ...auditMetadata(metadata),
        },
      });
    });
  }

  private directTestMode(): boolean {
    return this.environment.MERCADOPAGO_MODE === "test" &&
      this.environment.MERCADOPAGO_CONNECTION_MODE === "direct";
  }

  private encryptionKey(): string {
    const key = this.environment.PAYMENT_PROVIDER_ENCRYPTION_KEY;
    if (!key) {
      throw new ServiceUnavailableException({
        code: "PAYMENT_PROVIDER_ENCRYPTION_NOT_CONFIGURED",
        message: "Payment credential encryption is not configured",
      });
    }
    return key;
  }

  private async recordOAuthFailure(
    organizationId: string,
    userId: string,
    stateId: string,
    error: unknown,
    metadata: RequestMetadata,
  ) {
    await this.prisma.client.auditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        actorType: AuditActorType.USER,
        action: "mercadopago.oauth.failed",
        entityType: "MercadoPagoOAuthState",
        entityId: stateId,
        after: {
          errorCode: error instanceof MercadoPagoGatewayError ? error.code : "OAUTH_EXCHANGE_FAILED",
        },
        ...auditMetadata(metadata),
      },
    });
  }
}
