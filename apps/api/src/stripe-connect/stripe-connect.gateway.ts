import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import { ServiceUnavailableException } from "@nestjs/common";
import Stripe from "stripe";

export const STRIPE_GATEWAY = Symbol("STRIPE_GATEWAY");

export type StripePaymentMethodType = "card" | "pix";
export const PIX_MINIMUM_CENTS = 50;
export const PIX_MAXIMUM_CENTS = 300_000;

export type ConnectedAccountSnapshot = {
  id: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  capabilities: Record<string, unknown>;
  requirements: Record<string, unknown>;
};

export type CheckoutSnapshot = {
  id: string;
  clientSecret?: string;
  paymentIntentId?: string;
  paymentMethod?: StripePaymentMethodType;
  expiresAt: Date;
  paymentStatus: string;
  status: string;
};

export type AccountSessionSnapshot = {
  clientSecret: string;
  expiresAt: Date;
};

export interface StripeGateway {
  readonly enabled: boolean;
  readonly publishableKey?: string;
  createConnectedAccount(input: {
    organizationId: string;
    email: string;
    businessName: string;
    supportPhone?: string;
    idempotencyKey: string;
  }): Promise<ConnectedAccountSnapshot>;
  retrieveConnectedAccount(accountId: string): Promise<ConnectedAccountSnapshot>;
  requestPixPaymentsCapability(accountId: string): Promise<ConnectedAccountSnapshot>;
  createOnboardingLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: Date }>;
  createEmbeddedOnboardingSession(input: {
    accountId: string;
    businessName: string;
    productDescription: string;
    supportPhone?: string;
  }): Promise<AccountSessionSnapshot>;
  createCustomer(input: {
    accountId: string;
    guardianId: string;
    name: string;
    email?: string;
    phone: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  createEmbeddedCheckout(input: {
    accountId: string;
    customerId: string;
    chargeId: string;
    checkoutId: string;
    studentName: string;
    referenceMonth: string;
    amountCents: number;
    paymentMethodTypes: StripePaymentMethodType[];
    expiresAt: Date;
    returnUrl: string;
    idempotencyKey: string;
  }): Promise<CheckoutSnapshot>;
  retrieveCheckout(accountId: string, checkoutSessionId: string): Promise<CheckoutSnapshot>;
  constructWebhookEvent(rawBody: Buffer, signature: string, secret: string): Stripe.Event;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function accountSnapshot(account: Stripe.Account): ConnectedAccountSnapshot {
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    capabilities: jsonRecord(account.capabilities),
    requirements: jsonRecord(account.requirements),
  };
}

function paymentMethodFromIntent(
  intent: Stripe.Checkout.Session["payment_intent"],
): StripePaymentMethodType | undefined {
  if (!intent || typeof intent === "string") return undefined;
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string") return undefined;
  const type = charge.payment_method_details?.type;
  return type === "card" || type === "pix" ? type : undefined;
}

function checkoutSnapshot(session: Stripe.Checkout.Session): CheckoutSnapshot {
  return {
    id: session.id,
    ...(session.client_secret ? { clientSecret: session.client_secret } : {}),
    ...(typeof session.payment_intent === "string"
      ? { paymentIntentId: session.payment_intent }
      : session.payment_intent?.id
        ? { paymentIntentId: session.payment_intent.id }
        : {}),
    ...(paymentMethodFromIntent(session.payment_intent)
      ? { paymentMethod: paymentMethodFromIntent(session.payment_intent) }
      : {}),
    expiresAt: new Date(session.expires_at * 1000),
    paymentStatus: session.payment_status,
    status: session.status ?? "open",
  };
}

export class StripeSdkGateway implements StripeGateway {
  readonly enabled = true;
  readonly publishableKey: string;
  private readonly client: Stripe;

  constructor(
    secretKey: string,
    publishableKey: string,
    private readonly testMode: boolean,
  ) {
    this.client = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      timeout: 15_000,
      typescript: true,
    });
    this.publishableKey = publishableKey;
  }

  async createConnectedAccount(input: {
    organizationId: string;
    email: string;
    businessName: string;
    supportPhone?: string;
    idempotencyKey: string;
  }): Promise<ConnectedAccountSnapshot> {
    const account = await this.client.accounts.create(
      {
        // Custom is sandbox-only, allowing end-to-end tests without real KYC.
        // Live connected accounts are always Stripe Express.
        type: this.testMode ? "custom" : "express",
        country: "BR",
        email: input.email,
        capabilities: {
          card_payments: { requested: true },
          pix_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: input.businessName,
          product_description: "Gestão de alunos e mensalidades",
          ...(input.supportPhone ? { support_phone: input.supportPhone } : {}),
        },
        metadata: { mensalyOrganizationId: input.organizationId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return accountSnapshot(account);
  }

  async retrieveConnectedAccount(accountId: string): Promise<ConnectedAccountSnapshot> {
    return accountSnapshot(await this.client.accounts.retrieve(accountId));
  }

  async requestPixPaymentsCapability(accountId: string): Promise<ConnectedAccountSnapshot> {
    return accountSnapshot(
      await this.client.accounts.update(accountId, {
        capabilities: { pix_payments: { requested: true } },
      }),
    );
  }

  async createOnboardingLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: Date }> {
    const link = await this.client.accountLinks.create({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async createEmbeddedOnboardingSession(input: {
    accountId: string;
    businessName: string;
    productDescription: string;
    supportPhone?: string;
  }): Promise<AccountSessionSnapshot> {
    // This information already belongs to the authenticated organization.
    // Prefilling it keeps Stripe's required field out of the customer journey.
    await this.client.accounts.update(input.accountId, {
      business_profile: {
        name: input.businessName,
        product_description: input.productDescription,
        ...(input.supportPhone ? { support_phone: input.supportPhone } : {}),
      },
    });
    const session = await this.client.accountSessions.create({
      account: input.accountId,
      components: {
        account_onboarding: { enabled: true },
      },
    });
    return {
      clientSecret: session.client_secret,
      expiresAt: new Date(session.expires_at * 1000),
    };
  }

  async createCustomer(input: {
    accountId: string;
    guardianId: string;
    name: string;
    email?: string;
    phone: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    const customer = await this.client.customers.create(
      {
        name: input.name,
        email: input.email,
        phone: input.phone,
        metadata: {
          mensalyGuardianId: input.guardianId,
        },
      },
      { stripeAccount: input.accountId, idempotencyKey: input.idempotencyKey },
    );
    return { id: customer.id };
  }

  async createEmbeddedCheckout(input: {
    accountId: string;
    customerId: string;
    chargeId: string;
    checkoutId: string;
    studentName: string;
    referenceMonth: string;
    amountCents: number;
    paymentMethodTypes: StripePaymentMethodType[];
    expiresAt: Date;
    returnUrl: string;
    idempotencyKey: string;
  }): Promise<CheckoutSnapshot> {
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        // Stripe's current Checkout API uses `embedded_page` for the
        // client-secret based embedded surface. Keep the cast localized until
        // the SDK's union catches up with this API value.
        ui_mode: "embedded_page" as never,
        customer: input.customerId,
        locale: "pt-BR",
        currency: "brl",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "brl",
              unit_amount: input.amountCents,
              product_data: {
                name: `Mensalidade — ${input.studentName}`,
                description: `Referência ${input.referenceMonth}`,
              },
            },
          },
        ],
        payment_method_types: input.paymentMethodTypes,
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        return_url: input.returnUrl,
        metadata: {
          mensalyChargeId: input.chargeId,
          mensalyCheckoutId: input.checkoutId,
        },
        payment_intent_data: {
          metadata: {
            mensalyChargeId: input.chargeId,
            mensalyCheckoutId: input.checkoutId,
          },
        },
      },
      { stripeAccount: input.accountId, idempotencyKey: input.idempotencyKey },
    );
    return checkoutSnapshot(session);
  }

  async retrieveCheckout(
    accountId: string,
    checkoutSessionId: string,
  ): Promise<CheckoutSnapshot> {
    return checkoutSnapshot(
      await this.client.checkout.sessions.retrieve(
        checkoutSessionId,
        { expand: ["payment_intent.latest_charge"] },
        { stripeAccount: accountId },
      ),
    );
  }

  constructWebhookEvent(rawBody: Buffer, signature: string, secret: string): Stripe.Event {
    return this.client.webhooks.constructEvent(rawBody, signature, secret);
  }
}

export class DisabledStripeGateway implements StripeGateway {
  readonly enabled = false;
  readonly publishableKey = undefined;

  private unavailable(): never {
    throw new ServiceUnavailableException({
      code: "STRIPE_CONNECT_NOT_CONFIGURED",
      message: "Stripe Connect is not configured",
    });
  }

  createConnectedAccount(): Promise<ConnectedAccountSnapshot> { return this.unavailable(); }
  retrieveConnectedAccount(): Promise<ConnectedAccountSnapshot> { return this.unavailable(); }
  requestPixPaymentsCapability(): Promise<ConnectedAccountSnapshot> { return this.unavailable(); }
  createOnboardingLink(): Promise<{ url: string; expiresAt: Date }> { return this.unavailable(); }
  createEmbeddedOnboardingSession(): Promise<AccountSessionSnapshot> { return this.unavailable(); }
  createCustomer(): Promise<{ id: string }> { return this.unavailable(); }
  createEmbeddedCheckout(): Promise<CheckoutSnapshot> { return this.unavailable(); }
  retrieveCheckout(): Promise<CheckoutSnapshot> { return this.unavailable(); }
  constructWebhookEvent(): Stripe.Event { return this.unavailable(); }
}

export function createStripeGateway(): StripeGateway {
  const environment = parseEnvironment(apiEnvironmentSchema, process.env);
  if (environment.STRIPE_CONNECT_MODE === "disabled") {
    return new DisabledStripeGateway();
  }
  return new StripeSdkGateway(
    environment.STRIPE_SECRET_KEY!,
    environment.STRIPE_PUBLISHABLE_KEY!,
    environment.STRIPE_CONNECT_MODE === "test",
  );
}
