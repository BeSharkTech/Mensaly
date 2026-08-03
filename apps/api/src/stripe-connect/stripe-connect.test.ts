import * as assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  disconnectPrismaClient,
  getPrismaClient,
  StripeConnectionStatus,
  UserRole,
  UserStatus,
} from "@mensaly/database";
import type Stripe from "stripe";

import type { AuthenticatedContext } from "../authorization/authorization-context";
import { PrismaService } from "../infrastructure/database/prisma.service";
import { WebhookInboxService } from "../webhook-inbox/webhook-inbox.service";
import { StripeCheckoutService } from "./stripe-checkout.service";
import {
  type CheckoutSnapshot,
  type ConnectedAccountSnapshot,
  type StripeGateway,
} from "./stripe-connect.gateway";
import { StripeConnectService, stripeConnectionStatus } from "./stripe-connect.service";
import { StripeWebhookService } from "./stripe-webhook.service";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== "mensaly_test") {
  throw new Error("Stripe Connect tests require the isolated mensaly_test database.");
}

class FakeStripeGateway implements StripeGateway {
  readonly enabled = true;
  readonly publishableKey = "pk_test_fake";
  createAccountCalls = 0;
  createCustomerCalls = 0;
  createCheckoutCalls = 0;
  createOnboardingSessionCalls = 0;
  retrieveCheckoutCalls = 0;
  checkoutPaid = false;
  checkoutPaymentMethod: "card" | "pix" = "pix";
  lastReturnUrl?: string;
  lastPaymentMethodTypes?: Array<"card" | "pix">;
  nextEvent?: Stripe.Event;
  failAccountCreationOnce = false;
  failOnboardingSessionOnce = false;
  readonly createAccountIdempotencyKeys: string[] = [];
  readonly onboardingSessionInputs: Array<{
    accountId: string;
    businessName: string;
    productDescription: string;
    supportPhone?: string;
  }> = [];

  private readonly account: ConnectedAccountSnapshot = {
    id: "acct_test_mensaly",
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    capabilities: { card_payments: "active", pix_payments: "active" },
    requirements: { currently_due: [], pending_verification: [] },
  };

  async createConnectedAccount(input: {
    idempotencyKey: string;
  }): Promise<ConnectedAccountSnapshot> {
    this.createAccountCalls += 1;
    this.createAccountIdempotencyKeys.push(input.idempotencyKey);
    if (this.failAccountCreationOnce) {
      this.failAccountCreationOnce = false;
      throw new Error("Stripe Connect was not configured yet");
    }
    return this.account;
  }
  async retrieveConnectedAccount(): Promise<ConnectedAccountSnapshot> {
    return this.account;
  }
  async requestPixPaymentsCapability(): Promise<ConnectedAccountSnapshot> {
    return this.account;
  }
  async createOnboardingLink() {
    return {
      url: "https://connect.stripe.test/onboarding",
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
  async createEmbeddedOnboardingSession(input: {
    accountId: string;
    businessName: string;
    productDescription: string;
    supportPhone?: string;
  }) {
    this.createOnboardingSessionCalls += 1;
    this.onboardingSessionInputs.push(input);
    if (this.failOnboardingSessionOnce) {
      this.failOnboardingSessionOnce = false;
      throw new Error("Temporary Account Session outage");
    }
    return {
      clientSecret: `as_test_secret_${this.createOnboardingSessionCalls}`,
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
  async createCustomer() {
    this.createCustomerCalls += 1;
    return { id: "cus_test_guardian" };
  }
  async createEmbeddedCheckout(input: {
    returnUrl: string;
    paymentMethodTypes: Array<"card" | "pix">;
  }): Promise<CheckoutSnapshot> {
    this.createCheckoutCalls += 1;
    this.lastReturnUrl = input.returnUrl;
    this.lastPaymentMethodTypes = input.paymentMethodTypes;
    return {
      id: "cs_test_checkout",
      clientSecret: "cs_test_secret",
      paymentIntentId: "pi_test_payment",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      paymentStatus: "unpaid",
      status: "open",
    };
  }
  async retrieveCheckout(): Promise<CheckoutSnapshot> {
    this.retrieveCheckoutCalls += 1;
    return {
      id: "cs_test_checkout",
      clientSecret: "cs_test_secret",
      paymentIntentId: "pi_test_payment",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      paymentStatus: this.checkoutPaid ? "paid" : "unpaid",
      status: this.checkoutPaid ? "complete" : "open",
      ...(this.checkoutPaid ? { paymentMethod: this.checkoutPaymentMethod } : {}),
    };
  }
  constructWebhookEvent(): Stripe.Event {
    if (!this.nextEvent) throw new Error("Missing fake event");
    return this.nextEvent;
  }
}

describe("Stripe Connect foundation", () => {
  it("maps account requirements to explicit safe states", () => {
    assert.equal(
      stripeConnectionStatus({
        id: "acct_enabled",
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        capabilities: {},
        requirements: {},
      }),
      StripeConnectionStatus.ENABLED,
    );
    assert.equal(
      stripeConnectionStatus({
        id: "acct_due",
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        capabilities: {},
        requirements: { currently_due: ["individual.verification.document"] },
      }),
      StripeConnectionStatus.REQUIREMENTS_DUE,
    );
  });

  it("creates one checkout and confirms provider returns idempotently with webhook fallback", async () => {
    const previousSecret = process.env.PAYMENT_LINK_SECRET;
    process.env.PAYMENT_LINK_SECRET = Buffer.alloc(32, 7).toString("base64");
    const prisma = getPrismaClient();
    const prismaService = new PrismaService();
    const gateway = new FakeStripeGateway();
    const connect = new StripeConnectService(prismaService, gateway);
    const inbox = new WebhookInboxService(prismaService);
    const webhook = new StripeWebhookService(prismaService, inbox, connect, gateway);
    const checkoutService = new StripeCheckoutService(prismaService, gateway, webhook);
    const suffix = randomUUID();
    const digits = createHash("sha256")
      .update(suffix)
      .digest("hex")
      .split("")
      .map((character) => Number.parseInt(character, 16) % 10)
      .join("");
    const email = `stripe-${suffix}@api.example.test`;
    const user = await prisma.user.create({
      data: {
        name: "Stripe Owner",
        email,
        emailVerified: true,
        role: UserRole.COMPANY_ACCOUNT,
        status: UserStatus.ACTIVE,
      },
    });
    const organization = await prisma.organization.create({
      data: {
        ownerUserId: user.id,
        name: `Stripe School ${suffix}`,
        legalName: `Stripe School ${suffix} LTDA`,
        taxId: digits.slice(0, 14),
      },
    });
    const auth: AuthenticatedContext = {
      userId: user.id,
      email,
      role: "COMPANY_ACCOUNT",
      organizationId: organization.id,
    };

    try {
      gateway.failAccountCreationOnce = true;
      await assert.rejects(connect.ensureAccount(auth));
      const firstConnection = await connect.ensureAccount(auth);
      const replayedConnection = await connect.ensureAccount(auth);
      assert.equal(firstConnection.stripeAccountId, "acct_test_mensaly");
      assert.equal(replayedConnection.id, firstConnection.id);
      assert.equal(gateway.createAccountCalls, 2);
      assert.equal(gateway.createAccountIdempotencyKeys.length, 2);
      assert.notEqual(
        gateway.createAccountIdempotencyKeys[0],
        gateway.createAccountIdempotencyKeys[1],
      );

      const onboardingSession = await connect.createEmbeddedOnboardingSession(auth);
      gateway.failOnboardingSessionOnce = true;
      await assert.rejects(connect.createEmbeddedOnboardingSession(auth));
      const refreshedOnboardingSession = await connect.createEmbeddedOnboardingSession(auth);
      assert.equal(onboardingSession.publishableKey, "pk_test_fake");
      assert.equal(onboardingSession.clientSecret, "as_test_secret_1");
      assert.equal(refreshedOnboardingSession.clientSecret, "as_test_secret_3");
      assert.equal(gateway.createOnboardingSessionCalls, 3);
      assert.deepEqual(gateway.onboardingSessionInputs[0], {
        accountId: "acct_test_mensaly",
        businessName: organization.legalName,
        productDescription:
          "Prestação de serviços recorrentes, com cobrança de mensalidades de alunos ou clientes.",
        supportPhone: undefined,
      });
      const onboardingAudits = await prisma.auditLog.findMany({
        where: {
          organizationId: organization.id,
          action: {
            in: [
              "stripe.embedded_onboarding_session.created",
              "stripe.embedded_onboarding_session.failed",
            ],
          },
        },
      });
      assert.equal(onboardingAudits.length, 3);
      assert.equal(
        onboardingAudits.filter(
          (entry) => entry.action === "stripe.embedded_onboarding_session.failed",
        ).length,
        1,
      );
      assert.equal(JSON.stringify(onboardingAudits).includes("as_test_secret"), false);

      const plan = await prisma.plan.create({
        data: {
          organizationId: organization.id,
          name: "Mensal",
          amountCents: 12_000,
          dueDay: 5,
        },
      });
      const student = await prisma.student.create({
        data: {
          organizationId: organization.id,
          name: "Aluno Stripe",
          cpf: digits.slice(14, 25),
        },
      });
      const guardian = await prisma.guardian.create({
        data: {
          organizationId: organization.id,
          name: "Responsável Stripe",
          taxId: digits.slice(25, 36),
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

      const link = await checkoutService.createPaymentLink(auth, charge.id);
      const replayedLink = await checkoutService.createPaymentLink(auth, charge.id);
      assert.equal(link.url, replayedLink.url);
      const token = new URL(link.url).pathname.split("/").at(-1)!;
      const details = await checkoutService.publicDetails(token);
      assert.equal(details.student.name, student.name);
      assert.equal(details.amountCents, 12_000);

      const session = await checkoutService.createOrReuseSession(token);
      const replayedSession = await checkoutService.createOrReuseSession(token);
      assert.equal(session.clientSecret, "cs_test_secret");
      assert.equal(replayedSession.clientSecret, session.clientSecret);
      assert.equal(gateway.createCustomerCalls, 1);
      assert.equal(gateway.createCheckoutCalls, 1);
      assert.deepEqual(gateway.lastPaymentMethodTypes, ["card", "pix"]);
      assert.equal(gateway.retrieveCheckoutCalls, 1);
      assert.equal(
        gateway.lastReturnUrl,
        `${new URL(link.url).origin}/pagar/${token}?retorno=stripe`,
      );

      gateway.checkoutPaid = true;
      const reconciled = await checkoutService.reconcilePublicCheckout(token);
      const replayedReconciliation = await checkoutService.reconcilePublicCheckout(token);
      assert.equal(reconciled.status, "PAID");
      assert.equal(replayedReconciliation.status, "PAID");

      const reconciledPayments = await prisma.payment.findMany({
        where: { chargeId: charge.id },
      });
      assert.equal(reconciledPayments.length, 1);
      assert.match(
        reconciledPayments[0]?.notes ?? "",
        /direct Stripe provider reconciliation/,
      );

      const eventId = `evt_${randomUUID()}`;
      gateway.nextEvent = {
        id: eventId,
        object: "event",
        api_version: null,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: "pi_test_payment",
            object: "payment_intent",
            metadata: { mensalyCheckoutId: details.checkoutId },
            payment_method_types: ["pix"],
          } as unknown as Stripe.PaymentIntent,
        },
        livemode: false,
        pending_webhooks: 1,
        request: null,
        type: "payment_intent.succeeded",
        account: "acct_test_mensaly",
      } as Stripe.Event;

      const accepted = await webhook.receive({
        rawBody: Buffer.from("{}"),
        signature: "fake-signature",
        webhookSecret: "whsec_fake",
      });
      const duplicate = await webhook.receive({
        rawBody: Buffer.from("{}"),
        signature: "fake-signature",
        webhookSecret: "whsec_fake",
      });
      assert.deepEqual(accepted, { duplicate: false });
      assert.deepEqual(duplicate, { duplicate: true });

      const paidCharge = await prisma.charge.findUniqueOrThrow({ where: { id: charge.id } });
      const payments = await prisma.payment.findMany({ where: { chargeId: charge.id } });
      assert.equal(paidCharge.status, "PAID");
      assert.equal(payments.length, 1);
      assert.equal(payments[0]?.status, "CONFIRMED");
      assert.equal(payments[0]?.method, "PIX");
    } finally {
      await prisma.webhookEventAttempt.deleteMany({
        where: { event: { organizationId: organization.id } },
      });
      await prisma.webhookEvent.deleteMany({ where: { organizationId: organization.id } });
      await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
      await prisma.payment.deleteMany({ where: { organizationId: organization.id } });
      await prisma.stripeCheckout.deleteMany({ where: { organizationId: organization.id } });
      await prisma.stripeCustomer.deleteMany({ where: { organizationId: organization.id } });
      await prisma.charge.deleteMany({ where: { organizationId: organization.id } });
      await prisma.enrollment.deleteMany({ where: { organizationId: organization.id } });
      await prisma.student.deleteMany({ where: { organizationId: organization.id } });
      await prisma.guardian.deleteMany({ where: { organizationId: organization.id } });
      await prisma.plan.deleteMany({ where: { organizationId: organization.id } });
      await prisma.stripeConnection.deleteMany({ where: { organizationId: organization.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
      await prisma.user.delete({ where: { id: user.id } });
      if (previousSecret === undefined) delete process.env.PAYMENT_LINK_SECRET;
      else process.env.PAYMENT_LINK_SECRET = previousSecret;
    }
  });
});

after(async () => {
  await disconnectPrismaClient();
});
