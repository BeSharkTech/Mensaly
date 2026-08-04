import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import { ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";

export const MERCADOPAGO_GATEWAY = Symbol("MERCADOPAGO_GATEWAY");

const oauthCredentialsSchema = z.object({
  access_token: z.string().min(1),
  public_key: z.string().min(1),
  refresh_token: z.string().min(1),
  live_mode: z.boolean(),
  user_id: z.union([z.string(), z.number()]).transform(String),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().default(""),
});

const paymentMethodSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  ticket_url: z.string().optional(),
  qr_code: z.string().optional(),
  qr_code_base64: z.string().optional(),
}).passthrough();

const orderPaymentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  amount: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  status_detail: z.string(),
  payment_method: paymentMethodSchema,
}).passthrough();

const orderSchema = z.object({
  id: z.string().min(1),
  external_reference: z.string().nullable().optional(),
  status: z.string(),
  status_detail: z.string(),
  total_amount: z.union([z.string(), z.number()]).transform(String),
  last_updated_date: z.string().optional(),
  created_date: z.string().optional(),
  transactions: z.object({ payments: z.array(orderPaymentSchema).default([]) }).default({ payments: [] }),
}).passthrough();

const paymentApiSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  external_reference: z.string().nullable().optional(),
  status: z.string(),
  status_detail: z.string(),
  transaction_amount: z.union([z.string(), z.number()]).transform(String),
  date_last_updated: z.string().optional(),
  date_created: z.string().optional(),
  payment_method_id: z.string().optional(),
  payment_type_id: z.string().optional(),
  transaction_details: z.object({
    external_resource_url: z.string().nullable().optional(),
  }).passthrough().optional(),
  point_of_interaction: z.object({
    transaction_data: z.object({
      qr_code: z.string().optional(),
      qr_code_base64: z.string().optional(),
      ticket_url: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

export type MercadoPagoOAuthCredentials = z.infer<typeof oauthCredentialsSchema>;
export type MercadoPagoOrder = z.infer<typeof orderSchema>;

export function mercadoPagoAuthorizationCodeBody(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  testToken: boolean;
}): Record<string, string> {
  return {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    test_token: String(input.testToken),
  };
}

export type MercadoPagoPaymentInput = {
  paymentType: string;
  paymentMethodId: string;
  token?: string;
  issuerId?: string;
  installments?: number;
  payer: {
    email: string;
    identification?: { type: string; number: string };
  };
};

export class MercadoPagoGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MercadoPagoGatewayError";
  }
}

export interface MercadoPagoGateway {
  readonly enabled: boolean;
  authorizationUrl(input: { state: string }): string;
  exchangeAuthorizationCode(input: { code: string; state: string }): Promise<MercadoPagoOAuthCredentials>;
  refreshAuthorization(refreshToken: string): Promise<MercadoPagoOAuthCredentials>;
  createOrder(input: {
    accessToken: string;
    checkoutId: string;
    amountCents: number;
    payment: MercadoPagoPaymentInput;
    idempotencyKey: string;
  }): Promise<MercadoPagoOrder>;
  getOrder(accessToken: string, orderId: string): Promise<MercadoPagoOrder>;
}

function paymentType(value: string, paymentMethodId: string): string {
  if (paymentMethodId === "pix") return "bank_transfer";
  if (["credit_card", "debit_card", "prepaid_card"].includes(value)) return value;
  throw new MercadoPagoGatewayError(
    "MERCADOPAGO_PAYMENT_METHOD_UNSUPPORTED",
    "Only Pix and card payments are supported",
    false,
    400,
  );
}

export function mercadoPagoPaymentToOrder(payload: unknown): MercadoPagoOrder | null {
  const parsed = paymentApiSchema.safeParse(payload);
  if (!parsed.success) return null;
  const payment = parsed.data;
  const transactionData = payment.point_of_interaction?.transaction_data;
  return orderSchema.parse({
    id: payment.id,
    external_reference: payment.external_reference,
    status: payment.status,
    status_detail: payment.status_detail,
    total_amount: payment.transaction_amount,
    last_updated_date: payment.date_last_updated,
    created_date: payment.date_created,
    transactions: {
      payments: [{
        id: payment.id,
        amount: payment.transaction_amount,
        status: payment.status,
        status_detail: payment.status_detail,
        payment_method: {
          id: payment.payment_method_id,
          type: payment.payment_type_id,
          qr_code: transactionData?.qr_code,
          qr_code_base64: transactionData?.qr_code_base64,
            ticket_url: transactionData?.ticket_url ?? payment.transaction_details?.external_resource_url ?? undefined,
        },
      }],
    },
  });
}

class HttpMercadoPagoGateway implements MercadoPagoGateway {
  readonly enabled = true;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly authBaseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly testToken: boolean,
  ) {}

  authorizationUrl(input: { state: string }): string {
    const url = new URL("/authorization", this.authBaseUrl);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  exchangeAuthorizationCode(input: { code: string; state: string }) {
    return this.oauthToken(mercadoPagoAuthorizationCodeBody({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      code: input.code,
      redirectUri: this.redirectUri,
      testToken: this.testToken,
    }));
  }

  refreshAuthorization(refreshToken: string) {
    return this.oauthToken({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  async createOrder(input: {
    accessToken: string;
    checkoutId: string;
    amountCents: number;
    payment: MercadoPagoPaymentInput;
    idempotencyKey: string;
  }): Promise<MercadoPagoOrder> {
    paymentType(input.payment.paymentType, input.payment.paymentMethodId);
    const body = {
      transaction_amount: input.amountCents / 100,
      description: `Mensaly mensalidade ${input.checkoutId}`,
      external_reference: input.checkoutId,
      payment_method_id: input.payment.paymentMethodId,
      ...(input.payment.token ? { token: input.payment.token } : {}),
      ...(input.payment.issuerId ? { issuer_id: input.payment.issuerId } : {}),
      ...(input.payment.installments ? { installments: input.payment.installments } : {}),
      payer: {
        email: input.payment.payer.email,
        ...(input.payment.payer.identification
          ? { identification: input.payment.payer.identification }
          : {}),
      },
    };
    return this.requestPayment("/v1/payments", input.accessToken, {
      method: "POST",
      headers: { "x-idempotency-key": input.idempotencyKey },
      body: JSON.stringify(body),
    });
  }

  getOrder(accessToken: string, orderId: string): Promise<MercadoPagoOrder> {
    return this.requestPayment(`/v1/payments/${encodeURIComponent(orderId)}`, accessToken, {
      method: "GET",
    });
  }

  private async oauthToken(body: Record<string, string>): Promise<MercadoPagoOAuthCredentials> {
    const response = await fetch(new URL("/oauth/token", this.apiBaseUrl), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => {
      throw new MercadoPagoGatewayError(
        "MERCADOPAGO_NETWORK_ERROR",
        error instanceof Error ? error.message : "Mercado Pago request failed",
        true,
      );
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw providerError(response.status, payload);
    const parsed = oauthCredentialsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MercadoPagoGatewayError(
        "MERCADOPAGO_RESPONSE_INVALID",
        "Mercado Pago returned invalid OAuth credentials",
        true,
      );
    }
    return parsed.data;
  }

  private async requestPayment(
    path: string,
    accessToken: string,
    init: RequestInit,
  ): Promise<MercadoPagoOrder> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("content-type", "application/json");
    const response = await fetch(new URL(path, this.apiBaseUrl), {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      throw new MercadoPagoGatewayError(
        "MERCADOPAGO_NETWORK_ERROR",
        error instanceof Error ? error.message : "Mercado Pago request failed",
        true,
      );
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw providerError(response.status, payload);
    const parsed = paymentApiSchema.safeParse(payload);
    if (!parsed.success) {
      const invalidFields = parsed.error.issues
        .map((issue) => issue.path.join(".") || "response")
        .filter((field, index, fields) => fields.indexOf(field) === index)
        .slice(0, 8)
        .join(", ");
      throw new MercadoPagoGatewayError(
        "MERCADOPAGO_RESPONSE_INVALID",
        `Mercado Pago returned an invalid payment response (${invalidFields || "unknown fields"})`,
        true,
      );
    }
    return mercadoPagoPaymentToOrder(parsed.data)!;
  }
}

function providerError(status: number, payload: unknown): MercadoPagoGatewayError {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const code = typeof record.code === "string"
    ? record.code
    : typeof record.error === "string"
      ? record.error
      : `HTTP_${status}`;
  const message = typeof record.message === "string"
    ? record.message
    : "Mercado Pago rejected the request";
  return new MercadoPagoGatewayError(
    code.slice(0, 120),
    message.slice(0, 1_000),
    status === 429 || status >= 500,
    status,
  );
}

class DisabledMercadoPagoGateway implements MercadoPagoGateway {
  readonly enabled = false;
  private unavailable(): never {
    throw new ServiceUnavailableException({
      code: "MERCADOPAGO_NOT_CONFIGURED",
      message: "Mercado Pago is not configured",
    });
  }
  authorizationUrl(): string { return this.unavailable(); }
  exchangeAuthorizationCode(): Promise<MercadoPagoOAuthCredentials> { return this.unavailable(); }
  refreshAuthorization(): Promise<MercadoPagoOAuthCredentials> { return this.unavailable(); }
  createOrder(): Promise<MercadoPagoOrder> { return this.unavailable(); }
  getOrder(): Promise<MercadoPagoOrder> { return this.unavailable(); }
}

export function createMercadoPagoGateway(): MercadoPagoGateway {
  const environment = parseEnvironment(apiEnvironmentSchema, process.env);
  if (environment.MERCADOPAGO_MODE === "disabled") return new DisabledMercadoPagoGateway();
  return new HttpMercadoPagoGateway(
    environment.MERCADOPAGO_API_BASE_URL,
    environment.MERCADOPAGO_AUTH_BASE_URL,
    environment.MERCADOPAGO_CLIENT_ID!,
    environment.MERCADOPAGO_CLIENT_SECRET!,
    environment.MERCADOPAGO_OAUTH_REDIRECT_URI!,
    environment.MERCADOPAGO_MODE === "test",
  );
}
