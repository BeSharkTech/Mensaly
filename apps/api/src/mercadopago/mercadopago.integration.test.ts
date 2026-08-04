import * as assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  disconnectPrismaClient,
  getPrismaClient,
  UserRole,
  UserStatus,
} from "@mensaly/database";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { WebhookInboxService } from "../webhook-inbox/webhook-inbox.service";
import { MercadoPagoCheckoutService } from "./mercadopago-checkout.service";
import { MercadoPagoConnectService } from "./mercadopago-connect.service";
import {
  MercadoPagoGatewayError,
  type MercadoPagoGateway,
  type MercadoPagoOAuthCredentials,
  type MercadoPagoOrder,
  type MercadoPagoPaymentInput,
} from "./mercadopago.gateway";
import { MercadoPagoWebhookService } from "./mercadopago-webhook.service";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== "mensaly_test") {
  throw new Error("Mercado Pago integration tests require the isolated mensaly_test database.");
}

class FakeMercadoPagoGateway implements MercadoPagoGateway {
  readonly enabled = true;
  readonly mercadoPagoUserId = "mp-seller-integration-1";
  createPaymentCalls = 0;
  refreshCalls = 0;
  approved = false;
  failCreateOnce = false;
  lastCheckoutId = "";
  readonly idempotencyKeys: string[] = [];
  readonly payments = new Map<string, { checkoutId: string; amountCents: number }>();

  authorizationUrl(input: { state: string }): string {
    const url = new URL("https://auth.mercadopago.com/authorization");
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  async exchangeAuthorizationCode(): Promise<MercadoPagoOAuthCredentials> {
    return this.credentials("oauth-access-token", "oauth-refresh-token");
  }

  async refreshAuthorization(): Promise<MercadoPagoOAuthCredentials> {
    this.refreshCalls += 1;
    return this.credentials("refreshed-access-token", "refreshed-refresh-token");
  }

  async createOrder(input: {
    checkoutId: string;
    amountCents: number;
    payment: MercadoPagoPaymentInput;
    idempotencyKey: string;
  }): Promise<MercadoPagoOrder> {
    this.createPaymentCalls += 1;
    this.idempotencyKeys.push(input.idempotencyKey);
    this.lastCheckoutId = input.checkoutId;
    assert.equal(input.payment.paymentMethodId, "pix");
    if (this.failCreateOnce) {
      this.failCreateOnce = false;
      throw new MercadoPagoGatewayError(
        "MERCADOPAGO_NETWORK_ERROR",
        "Simulated provider timeout",
        true,
      );
    }
    const paymentId = `mp-payment-${input.checkoutId}`;
    this.payments.set(paymentId, { checkoutId: input.checkoutId, amountCents: input.amountCents });
    return this.payment(paymentId, input.checkoutId, input.amountCents, false);
  }

  async getOrder(_accessToken: string, paymentId: string): Promise<MercadoPagoOrder> {
    const payment = this.payments.get(paymentId) ?? { checkoutId: this.lastCheckoutId, amountCents: 12_000 };
    return this.payment(paymentId, payment.checkoutId, payment.amountCents, this.approved);
  }

  private credentials(accessToken: string, refreshToken: string): MercadoPagoOAuthCredentials {
    return {
      access_token: accessToken,
      public_key: "TEST-public-key-integration",
      refresh_token: refreshToken,
      live_mode: false,
      user_id: this.mercadoPagoUserId,
      token_type: "Bearer",
      expires_in: 3_600,
      scope: "offline_access read write",
    };
  }

  private payment(paymentId: string, checkoutId: string, amountCents: number, approved: boolean): MercadoPagoOrder {
    const amount = (amountCents / 100).toFixed(2);
    return {
      id: paymentId,
      external_reference: checkoutId,
      status: approved ? "approved" : "pending",
      status_detail: approved ? "accredited" : "pending_waiting_transfer",
      total_amount: amount,
      created_date: "2026-08-04T12:00:00.000Z",
      last_updated_date: approved
        ? "2026-08-04T12:01:00.000Z"
        : "2026-08-04T12:00:00.000Z",
      transactions: {
        payments: [{
          id: paymentId,
          amount,
          status: approved ? "approved" : "pending",
          status_detail: approved ? "accredited" : "pending_waiting_transfer",
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: "pix-copy-and-paste",
            qr_code_base64: "cGl4",
          },
        }],
      },
    };
  }
}

function digitsFor(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex")
    .split("")
    .map((character) => Number.parseInt(character, 16) % 10)
    .join("");
}

describe("Mercado Pago OAuth student payment journey", () => {
  it("isolates seller accounts and confirms one payment from a signed idempotent webhook", async () => {
    const previousEnvironment = {
      MERCADOPAGO_MODE: process.env.MERCADOPAGO_MODE,
      MERCADOPAGO_CONNECTION_MODE: process.env.MERCADOPAGO_CONNECTION_MODE,
      MERCADOPAGO_CLIENT_ID: process.env.MERCADOPAGO_CLIENT_ID,
      MERCADOPAGO_CLIENT_SECRET: process.env.MERCADOPAGO_CLIENT_SECRET,
      MERCADOPAGO_OAUTH_REDIRECT_URI: process.env.MERCADOPAGO_OAUTH_REDIRECT_URI,
      MERCADOPAGO_WEBHOOK_SECRET: process.env.MERCADOPAGO_WEBHOOK_SECRET,
      PAYMENT_PROVIDER_ENCRYPTION_KEY: process.env.PAYMENT_PROVIDER_ENCRYPTION_KEY,
      PAYMENT_LINK_SECRET: process.env.PAYMENT_LINK_SECRET,
      WEB_APP_URL: process.env.WEB_APP_URL,
    };
    const webhookSecret = "mercadopago-integration-webhook-secret";
    Object.assign(process.env, {
      MERCADOPAGO_MODE: "test",
      MERCADOPAGO_CONNECTION_MODE: "oauth",
      MERCADOPAGO_CLIENT_ID: "123456789",
      MERCADOPAGO_CLIENT_SECRET: "integration-client-secret",
      MERCADOPAGO_OAUTH_REDIRECT_URI: "https://app.example.test/api/v1/payment-integrations/mercadopago/callback",
      MERCADOPAGO_WEBHOOK_SECRET: webhookSecret,
      PAYMENT_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      PAYMENT_LINK_SECRET: Buffer.alloc(32, 8).toString("base64"),
      WEB_APP_URL: "https://app.example.test",
    });

    const prisma = getPrismaClient();
    const prismaService = new PrismaService();
    const gateway = new FakeMercadoPagoGateway();
    const connections = new MercadoPagoConnectService(prismaService, gateway);
    const checkout = new MercadoPagoCheckoutService(prismaService, gateway, connections);
    const inbox = new WebhookInboxService(prismaService);
    const webhook = new MercadoPagoWebhookService(prismaService, inbox, connections, checkout, gateway);
    const suffix = randomUUID();
    const digits = digitsFor(suffix);
    const user = await prisma.user.create({
      data: {
        name: "Mercado Pago Owner",
        email: `mp-${suffix}@api.example.test`,
        emailVerified: true,
        role: UserRole.COMPANY_ACCOUNT,
        status: UserStatus.ACTIVE,
      },
    });
    const organization = await prisma.organization.create({
      data: {
        ownerUserId: user.id,
        name: `MP School ${suffix}`,
        legalName: `MP School ${suffix} LTDA`,
        taxId: digits.slice(0, 14),
      },
    });
    const secondUser = await prisma.user.create({
      data: {
        name: "Second Mercado Pago Owner",
        email: `mp-second-${suffix}@api.example.test`,
        emailVerified: true,
        role: UserRole.COMPANY_ACCOUNT,
        status: UserStatus.ACTIVE,
      },
    });
    const secondOrganization = await prisma.organization.create({
      data: {
        ownerUserId: secondUser.id,
        name: `Second MP School ${suffix}`,
        legalName: `Second MP School ${suffix} LTDA`,
        taxId: digits.slice(14, 28),
      },
    });
    const auth: AuthenticatedContext = {
      userId: user.id,
      email: user.email,
      role: "COMPANY_ACCOUNT",
      organizationId: organization.id,
    };
    const secondAuth: AuthenticatedContext = {
      userId: secondUser.id,
      email: secondUser.email,
      role: "COMPANY_ACCOUNT",
      organizationId: secondOrganization.id,
    };

    try {
      const authorization = await connections.createAuthorization(auth);
      const state = new URL(authorization.authorizationUrl!).searchParams.get("state")!;
      const connected = await connections.completeAuthorization(auth, { code: "grant-1", state });
      assert.deepEqual(connected, { status: "CONNECTED", liveMode: false });
      await assert.rejects(
        connections.completeAuthorization(auth, { code: "grant-replay", state }),
        (error: unknown) => JSON.stringify(error).includes("MERCADOPAGO_OAUTH_STATE_INVALID"),
      );

      const secondAuthorization = await connections.createAuthorization(secondAuth);
      const secondState = new URL(secondAuthorization.authorizationUrl!).searchParams.get("state")!;
      await assert.rejects(
        connections.completeAuthorization(secondAuth, { code: "grant-2", state: secondState }),
        (error: unknown) => JSON.stringify(error).includes("MERCADOPAGO_ACCOUNT_ALREADY_CONNECTED"),
      );

      const storedConnection = await prisma.mercadoPagoConnection.findUniqueOrThrow({
        where: { organizationId: organization.id },
      });
      const serializedConnection = JSON.stringify(storedConnection);
      assert.equal(serializedConnection.includes("oauth-access-token"), false);
      assert.equal(serializedConnection.includes("oauth-refresh-token"), false);

      await prisma.mercadoPagoConnection.update({
        where: { organizationId: organization.id },
        data: { tokenExpiresAt: new Date() },
      });
      const refreshed = await connections.credentialsForOrganization(organization.id);
      assert.equal(refreshed.accessToken, "refreshed-access-token");
      assert.equal(gateway.refreshCalls, 1);

      const unknownPaymentId = "payment-arrived-before-provider-response";
      const earlyRequestId = `request-${randomUUID()}`;
      const earlyTimestamp = Date.now();
      const earlyDigest = createHmac("sha256", webhookSecret)
        .update(`id:${unknownPaymentId};request-id:${earlyRequestId};ts:${earlyTimestamp};`)
        .digest("hex");
      await assert.rejects(
        webhook.receive({
          body: { type: "payment", data: { id: unknownPaymentId } },
          signature: `ts=${earlyTimestamp},v1=${earlyDigest}`,
          requestId: earlyRequestId,
          dataId: unknownPaymentId,
        }),
        (error: unknown) => JSON.stringify(error).includes("MERCADOPAGO_WEBHOOK_CONNECTION_PENDING"),
      );
      assert.equal(
        await prisma.webhookEvent.count({
          where: { provider: "mercadopago", payload: { path: ["data", "id"], equals: unknownPaymentId } },
        }),
        0,
      );

      const plan = await prisma.plan.create({
        data: { organizationId: organization.id, name: "Mensal", amountCents: 12_000, dueDay: 5 },
      });
      const student = await prisma.student.create({
        data: { organizationId: organization.id, name: "Aluno Mercado Pago", cpf: digits.slice(28, 39) },
      });
      const guardian = await prisma.guardian.create({
        data: {
          organizationId: organization.id,
          name: "Responsável Mercado Pago",
          taxId: digits.slice(39, 50),
          phone: "5511999999999",
          email: `guardian-${suffix}@example.test`,
        },
      });
      const enrollment = await prisma.enrollment.create({
        data: {
          organizationId: organization.id,
          studentId: student.id,
          guardianId: guardian.id,
          planId: plan.id,
          amountCents: 12_000,
          dueDay: 5,
          startDate: new Date("2026-08-01T00:00:00.000Z"),
          planNameSnapshot: plan.name,
        },
      });
      const charge = await prisma.charge.create({
        data: {
          organizationId: organization.id,
          enrollmentId: enrollment.id,
          referenceMonth: new Date("2026-08-01T00:00:00.000Z"),
          dueDate: new Date("2026-08-05T00:00:00.000Z"),
          amountCents: 12_000,
          finalAmountCents: 12_000,
        },
      });

      const link = await checkout.createPaymentLink(auth, charge.id);
      const replayedLink = await checkout.createPaymentLink(auth, charge.id);
      assert.equal(link.url, replayedLink.url);
      const token = new URL(link.url).pathname.split("/").at(-1)!;
      const result = await checkout.processPayment(token, {
        paymentType: "bank_transfer",
        selectedPaymentMethod: "bank_transfer",
        formData: {
          payment_method_id: "pix",
          payment_type_id: "bank_transfer",
          transaction_amount: 120,
          payer: { email: guardian.email! },
        },
      });
      assert.equal(result.status, "PROCESSING");
      assert.equal(result.pix?.qrCode, "pix-copy-and-paste");
      const primaryPaymentId = result.paymentId!;
      assert.equal(gateway.createPaymentCalls, 1);
      assert.equal(new Set(gateway.idempotencyKeys).size, 1);

      const replayedSubmission = await checkout.processPayment(token, {
        paymentType: "bank_transfer",
        selectedPaymentMethod: "bank_transfer",
        formData: {
          payment_method_id: "pix",
          payment_type_id: "bank_transfer",
          transaction_amount: 120,
          payer: { email: guardian.email! },
        },
      });
      assert.equal(replayedSubmission.paymentId, primaryPaymentId);
      assert.equal(gateway.createPaymentCalls, 1);

      gateway.approved = true;
      const requestId = `request-${randomUUID()}`;
      const timestamp = Date.now();
      const manifest = `id:${primaryPaymentId};request-id:${requestId};ts:${timestamp};`;
      const digest = createHmac("sha256", webhookSecret).update(manifest).digest("hex");
      const webhookInput = {
        body: {
          id: `event-${randomUUID()}`,
          live_mode: false,
          type: "payment",
          action: "payment.updated",
          user_id: gateway.mercadoPagoUserId,
          data: { id: primaryPaymentId },
        },
        signature: `ts=${timestamp},v1=${digest}`,
        requestId,
        dataId: primaryPaymentId,
      };
      const accepted = await webhook.receive(webhookInput);
      const duplicate = await webhook.receive(webhookInput);
      assert.equal(accepted.duplicate, false);
      assert.equal(duplicate.duplicate, true);

      const paidCharge = await prisma.charge.findUniqueOrThrow({ where: { id: charge.id } });
      const payments = await prisma.payment.findMany({ where: { chargeId: charge.id } });
      assert.equal(paidCharge.status, "PAID");
      assert.equal(payments.length, 1);
      assert.equal(payments[0]?.status, "CONFIRMED");
      assert.equal(payments[0]?.method, "PIX");
      assert.equal(
        await prisma.auditLog.count({
          where: { organizationId: organization.id, action: "mercadopago.payment.confirmed" },
        }),
        1,
      );

      const retryCharge = await prisma.charge.create({
        data: {
          organizationId: organization.id,
          enrollmentId: enrollment.id,
          referenceMonth: new Date("2026-09-01T00:00:00.000Z"),
          dueDate: new Date("2026-09-05T00:00:00.000Z"),
          amountCents: 13_000,
          finalAmountCents: 13_000,
        },
      });
      const retryLink = await checkout.createPaymentLink(auth, retryCharge.id);
      const retryToken = new URL(retryLink.url).pathname.split("/").at(-1)!;
      const retrySubmission = {
        paymentType: "bank_transfer",
        selectedPaymentMethod: "bank_transfer",
        formData: {
          payment_method_id: "pix",
          payment_type_id: "bank_transfer",
          transaction_amount: 130,
          payer: { email: guardian.email! },
        },
      };
      gateway.approved = false;
      gateway.failCreateOnce = true;
      await assert.rejects(
        checkout.processPayment(retryToken, retrySubmission),
        (error: unknown) => JSON.stringify(error).includes("MERCADOPAGO_TEMPORARILY_UNAVAILABLE"),
      );
      const retried = await checkout.processPayment(retryToken, retrySubmission);
      assert.equal(retried.status, "PROCESSING");
      assert.equal(gateway.createPaymentCalls, 3);
      assert.equal(gateway.idempotencyKeys.at(-2), gateway.idempotencyKeys.at(-1));
    } finally {
      await prisma.webhookEventAttempt.deleteMany({
        where: { event: { organizationId: { in: [organization.id, secondOrganization.id] } } },
      });
      await prisma.webhookEvent.deleteMany({
        where: { organizationId: { in: [organization.id, secondOrganization.id] } },
      });
      await prisma.auditLog.deleteMany({
        where: { organizationId: { in: [organization.id, secondOrganization.id] } },
      });
      await prisma.payment.deleteMany({ where: { organizationId: organization.id } });
      await prisma.mercadoPagoCheckout.deleteMany({ where: { organizationId: organization.id } });
      await prisma.charge.deleteMany({ where: { organizationId: organization.id } });
      await prisma.enrollment.deleteMany({ where: { organizationId: organization.id } });
      await prisma.student.deleteMany({ where: { organizationId: organization.id } });
      await prisma.guardian.deleteMany({ where: { organizationId: organization.id } });
      await prisma.plan.deleteMany({ where: { organizationId: organization.id } });
      await prisma.mercadoPagoOAuthState.deleteMany({
        where: { organizationId: { in: [organization.id, secondOrganization.id] } },
      });
      await prisma.mercadoPagoConnection.deleteMany({
        where: { organizationId: { in: [organization.id, secondOrganization.id] } },
      });
      await prisma.organization.deleteMany({ where: { id: { in: [organization.id, secondOrganization.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [user.id, secondUser.id] } } });
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

after(async () => {
  await disconnectPrismaClient();
});
