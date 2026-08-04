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

export type MercadoPagoOAuthCredentials = z.infer<typeof oauthCredentialsSchema>;
export type MercadoPagoOrder = z.infer<typeof orderSchema>;

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

function amount(cents: number): string {
  return (cents / 100).toFixed(2);
}

class HttpMercadoPagoGateway implements MercadoPagoGateway {
  readonly enabled = true;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly authBaseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
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
    return this.oauthToken({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: this.redirectUri,
      state: input.state,
    });
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
    const methodType = paymentType(input.payment.paymentType, input.payment.paymentMethodId);
    const body = {
      type: "online",
      processing_mode: "automatic",
      external_reference: input.checkoutId,
      total_amount: amount(input.amountCents),
      payer: {
        email: input.payment.payer.email,
        ...(input.payment.payer.identification
          ? { identification: input.payment.payer.identification }
          : {}),
      },
      transactions: {
        payments: [
          {
            amount: amount(input.amountCents),
            payment_method: {
              id: input.payment.paymentMethodId,
              type: methodType,
              ...(input.payment.token ? { token: input.payment.token } : {}),
              ...(input.payment.issuerId ? { issuer_id: input.payment.issuerId } : {}),
              ...(input.payment.installments ? { installments: input.payment.installments } : {}),
            },
          },
        ],
      },
    };
    return this.requestOrder("/v1/orders", input.accessToken, {
      method: "POST",
      headers: { "x-idempotency-key": input.idempotencyKey },
      body: JSON.stringify(body),
    });
  }

  getOrder(accessToken: string, orderId: string): Promise<MercadoPagoOrder> {
    return this.requestOrder(`/v1/orders/${encodeURIComponent(orderId)}`, accessToken, {
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

  private async requestOrder(
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
    const parsed = orderSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MercadoPagoGatewayError(
        "MERCADOPAGO_RESPONSE_INVALID",
        "Mercado Pago returned an invalid order",
        true,
      );
    }
    return parsed.data;
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
  );
}
