import { apiEnvironmentSchema, workerEnvironmentSchema } from "./index";

export type DeploymentTarget = "staging" | "production";

export type DeploymentReadinessReport = {
  target: DeploymentTarget;
  ok: boolean;
  errors: string[];
};

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
const placeholderPattern = /(?:change[-_ ]?me|replace(?:[-_ ]?(?:me|with))?|example|placeholder|your[-_ ])/i;

function issue(errors: string[], field: string, message: string): void {
  errors.push(`${field}: ${message}`);
}

function parseUrl(
  errors: string[],
  field: string,
  value: string | undefined,
  protocols: string[],
): URL | undefined {
  if (!value) {
    issue(errors, field, "is required");
    return undefined;
  }

  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) {
      issue(errors, field, `must use ${protocols.join(" or ")}`);
      return undefined;
    }
    return url;
  } catch {
    issue(errors, field, "must be a valid URL");
    return undefined;
  }
}

function appendSchemaIssues(
  errors: string[],
  prefix: string,
  result: ReturnType<typeof apiEnvironmentSchema.safeParse> | ReturnType<typeof workerEnvironmentSchema.safeParse>,
): void {
  if (result.success) return;
  for (const item of result.error.issues) {
    issue(errors, `${prefix}.${item.path.join(".") || "environment"}`, item.message);
  }
}

function requireSecret(errors: string[], field: string, value: string | undefined): void {
  if (!value) return;
  if (value.length < 16 || placeholderPattern.test(value)) {
    issue(errors, field, "must be a real non-placeholder secret");
  }
}

export function validateDeploymentReadiness(
  environment: Record<string, string | undefined>,
  target: DeploymentTarget,
): DeploymentReadinessReport {
  const errors: string[] = [];
  appendSchemaIssues(errors, "api", apiEnvironmentSchema.safeParse(environment));
  appendSchemaIssues(errors, "worker", workerEnvironmentSchema.safeParse(environment));

  if (environment.NODE_ENV !== "production") {
    issue(errors, "NODE_ENV", "must be production for staging and production containers");
  }

  const publicWeb = parseUrl(errors, "PUBLIC_WEB_URL", environment.PUBLIC_WEB_URL, ["https:"]);
  const publicApi = parseUrl(errors, "PUBLIC_API_URL", environment.PUBLIC_API_URL, ["https:"]);
  const webApp = parseUrl(errors, "WEB_APP_URL", environment.WEB_APP_URL, ["https:"]);
  const database = parseUrl(errors, "DATABASE_URL", environment.DATABASE_URL, ["postgres:", "postgresql:"]);
  const redis = parseUrl(errors, "REDIS_URL", environment.REDIS_URL, ["rediss:"]);
  const storage = parseUrl(errors, "S3_ENDPOINT", environment.S3_ENDPOINT, ["https:"]);

  for (const [field, url] of [
    ["PUBLIC_WEB_URL", publicWeb],
    ["PUBLIC_API_URL", publicApi],
    ["WEB_APP_URL", webApp],
    ["DATABASE_URL", database],
    ["REDIS_URL", redis],
    ["S3_ENDPOINT", storage],
  ] as const) {
    if (url && localHosts.has(url.hostname.toLowerCase())) {
      issue(errors, field, "must not point to a local host");
    }
  }

  if (publicWeb && webApp && publicWeb.origin !== webApp.origin) {
    issue(errors, "WEB_APP_URL", "must match PUBLIC_WEB_URL");
  }
  if (publicWeb && publicApi && publicWeb.origin === publicApi.origin) {
    issue(errors, "PUBLIC_API_URL", "must use a separate API origin");
  }

  const mercadoPagoRedirect = parseUrl(
    errors,
    "MERCADOPAGO_OAUTH_REDIRECT_URI",
    environment.MERCADOPAGO_OAUTH_REDIRECT_URI,
    ["https:"],
  );
  if (publicWeb && mercadoPagoRedirect) {
    if (mercadoPagoRedirect.origin !== publicWeb.origin) {
      issue(errors, "MERCADOPAGO_OAUTH_REDIRECT_URI", "must use the PUBLIC_WEB_URL origin so the authenticated session is preserved");
    }
    if (mercadoPagoRedirect.pathname !== "/api/v1/payment-integrations/mercadopago/callback") {
      issue(errors, "MERCADOPAGO_OAUTH_REDIRECT_URI", "must use the Mercado Pago OAuth callback path");
    }
    if (mercadoPagoRedirect.search || mercadoPagoRedirect.hash) {
      issue(errors, "MERCADOPAGO_OAUTH_REDIRECT_URI", "must be static and must not contain query parameters or a fragment");
    }
  }
  if (environment.MERCADOPAGO_AUTH_BASE_URL !== "https://auth.mercadopago.com") {
    issue(errors, "MERCADOPAGO_AUTH_BASE_URL", "must use the official Mercado Pago OAuth origin");
  }

  const corsOrigins = (environment.CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (publicWeb && !corsOrigins.includes(publicWeb.origin)) {
    issue(errors, "CORS_ORIGINS", "must include the exact PUBLIC_WEB_URL origin");
  }
  for (const origin of corsOrigins) {
    if (!origin.startsWith("https://")) {
      issue(errors, "CORS_ORIGINS", `must contain only HTTPS origins; received ${origin}`);
    }
  }

  const trustProxyHops = Number(environment.TRUST_PROXY_HOPS ?? "0");
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 1) {
    issue(errors, "TRUST_PROXY_HOPS", "must be at least 1 behind the production proxy");
  }

  if (database) {
    if (!database.username || !database.password) {
      issue(errors, "DATABASE_URL", "must include dedicated credentials");
    }
    const sslMode = database.searchParams.get("sslmode");
    if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode)) {
      issue(errors, "DATABASE_URL", "must enforce TLS with sslmode=require, verify-ca or verify-full");
    }
  }

  if (!environment.SENTRY_DSN) {
    issue(errors, "SENTRY_DSN", "is required outside local development");
  } else if (placeholderPattern.test(environment.SENTRY_DSN)) {
    issue(errors, "SENTRY_DSN", "must not contain a placeholder");
  }

  for (const field of [
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "EMAIL_ENCRYPTION_KEY",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "MERCADOPAGO_CLIENT_SECRET",
    "MERCADOPAGO_WEBHOOK_SECRET",
    "PAYMENT_PROVIDER_ENCRYPTION_KEY",
    "PAYMENT_LINK_SECRET",
  ] as const) {
    requireSecret(errors, field, environment[field]);
  }

  if (
    environment.EMAIL_ENCRYPTION_KEY &&
    environment.PAYMENT_LINK_SECRET &&
    environment.EMAIL_ENCRYPTION_KEY === environment.PAYMENT_LINK_SECRET
  ) {
    issue(errors, "PAYMENT_LINK_SECRET", "must be different from EMAIL_ENCRYPTION_KEY");
  }
  if (
    environment.PAYMENT_PROVIDER_ENCRYPTION_KEY &&
    environment.PAYMENT_LINK_SECRET === environment.PAYMENT_PROVIDER_ENCRYPTION_KEY
  ) {
    issue(errors, "PAYMENT_PROVIDER_ENCRYPTION_KEY", "must be different from PAYMENT_LINK_SECRET");
  }

  if (!environment.MENSALY_IMAGE) {
    issue(errors, "MENSALY_IMAGE", "is required");
  } else if (!/^ghcr\.io\/besharktech\/mensaly:sha-[0-9a-f]{40}$/.test(environment.MENSALY_IMAGE)) {
    issue(errors, "MENSALY_IMAGE", "must use an immutable sha-<40 hex commit> GHCR tag");
  }

  const expectedMercadoPagoMode = target === "production" ? "live" : "test";
  if (environment.MERCADOPAGO_MODE !== expectedMercadoPagoMode) {
    issue(errors, "MERCADOPAGO_MODE", `must be ${expectedMercadoPagoMode} for ${target}`);
  }
  if ((environment.MERCADOPAGO_CONNECTION_MODE ?? "oauth") !== "oauth") {
    issue(errors, "MERCADOPAGO_CONNECTION_MODE", "must be oauth for a deployable environment");
  }
  if (environment.STRIPE_CONNECT_MODE !== "disabled") {
    issue(errors, "STRIPE_CONNECT_MODE", "must be disabled while student payments use Mercado Pago and SaaS billing is not active");
  }

  if (environment.MESSAGE_AUTOMATION_ENABLED !== "false") {
    issue(
      errors,
      "MESSAGE_AUTOMATION_ENABLED",
      "must be false for the V1 semi-automatic WhatsApp flow",
    );
  }

  return { target, ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function validateSingleVpsReadiness(
  environment: Record<string, string | undefined>,
): DeploymentReadinessReport {
  const errors: string[] = [];
  if (environment.NODE_ENV !== "production") {
    issue(errors, "NODE_ENV", "must be production");
  }

  const publicWeb = parseUrl(errors, "PUBLIC_WEB_URL", environment.PUBLIC_WEB_URL, ["https:"]);
  const publicApi = parseUrl(errors, "PUBLIC_API_URL", environment.PUBLIC_API_URL, ["https:"]);
  const storage = parseUrl(errors, "S3_ENDPOINT", environment.S3_ENDPOINT, ["https:"]);
  const redirect = parseUrl(
    errors,
    "MERCADOPAGO_OAUTH_REDIRECT_URI",
    environment.MERCADOPAGO_OAUTH_REDIRECT_URI,
    ["https:"],
  );

  if (publicWeb && environment.PUBLIC_WEB_HOST !== publicWeb.hostname) {
    issue(errors, "PUBLIC_WEB_HOST", "must match the PUBLIC_WEB_URL hostname");
  }
  if (publicApi && environment.PUBLIC_API_HOST !== publicApi.hostname) {
    issue(errors, "PUBLIC_API_HOST", "must match the PUBLIC_API_URL hostname");
  }
  if (publicWeb && publicApi && publicWeb.origin === publicApi.origin) {
    issue(errors, "PUBLIC_API_URL", "must use a separate API origin");
  }
  if (publicWeb && redirect) {
    if (redirect.origin !== publicWeb.origin) {
      issue(errors, "MERCADOPAGO_OAUTH_REDIRECT_URI", "must use the PUBLIC_WEB_URL origin");
    }
    if (redirect.pathname !== "/api/v1/payment-integrations/mercadopago/callback") {
      issue(errors, "MERCADOPAGO_OAUTH_REDIRECT_URI", "must use the Mercado Pago OAuth callback path");
    }
    if (redirect.search || redirect.hash) {
      issue(errors, "MERCADOPAGO_OAUTH_REDIRECT_URI", "must be static");
    }
  }
  if (storage && localHosts.has(storage.hostname.toLowerCase())) {
    issue(errors, "S3_ENDPOINT", "must not point to a local host");
  }
  if (environment.S3_ENDPOINT && placeholderPattern.test(environment.S3_ENDPOINT)) {
    issue(errors, "S3_ENDPOINT", "must use the real R2 account endpoint");
  }
  if (!environment.S3_BUCKET || placeholderPattern.test(environment.S3_BUCKET)) {
    issue(errors, "S3_BUCKET", "must be a real non-placeholder bucket");
  }
  if (!environment.RESEND_FROM_EMAIL || placeholderPattern.test(environment.RESEND_FROM_EMAIL)) {
    issue(errors, "RESEND_FROM_EMAIL", "must be a real verified sender");
  }

  for (const field of [
    "POSTGRES_PASSWORD",
    "REDIS_PASSWORD",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SENTRY_DSN",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "EMAIL_ENCRYPTION_KEY",
    "MERCADOPAGO_CLIENT_SECRET",
    "MERCADOPAGO_WEBHOOK_SECRET",
    "PAYMENT_PROVIDER_ENCRYPTION_KEY",
    "PAYMENT_LINK_SECRET",
  ] as const) {
    if (!environment[field]) issue(errors, field, "is required");
    else requireSecret(errors, field, environment[field]);
  }
  if (!environment.MERCADOPAGO_CLIENT_ID) {
    issue(errors, "MERCADOPAGO_CLIENT_ID", "is required");
  } else if (placeholderPattern.test(environment.MERCADOPAGO_CLIENT_ID)) {
    issue(errors, "MERCADOPAGO_CLIENT_ID", "must be a real non-placeholder identifier");
  }

  if ((environment.POSTGRES_PASSWORD?.length ?? 0) < 24) {
    issue(errors, "POSTGRES_PASSWORD", "must contain at least 24 characters");
  }
  if ((environment.REDIS_PASSWORD?.length ?? 0) < 24) {
    issue(errors, "REDIS_PASSWORD", "must contain at least 24 characters");
  }
  const encryptionValues = [
    environment.EMAIL_ENCRYPTION_KEY,
    environment.PAYMENT_PROVIDER_ENCRYPTION_KEY,
    environment.PAYMENT_LINK_SECRET,
  ].filter((value): value is string => Boolean(value));
  if (new Set(encryptionValues).size !== encryptionValues.length) {
    issue(errors, "ENCRYPTION_KEYS", "EMAIL_ENCRYPTION_KEY, PAYMENT_PROVIDER_ENCRYPTION_KEY and PAYMENT_LINK_SECRET must be different");
  }

  if (environment.MERCADOPAGO_MODE !== "live") {
    issue(errors, "MERCADOPAGO_MODE", "must be live");
  }
  if ((environment.MERCADOPAGO_CONNECTION_MODE ?? "oauth") !== "oauth") {
    issue(errors, "MERCADOPAGO_CONNECTION_MODE", "must be oauth");
  }
  if (environment.MERCADOPAGO_API_BASE_URL !== "https://api.mercadopago.com") {
    issue(errors, "MERCADOPAGO_API_BASE_URL", "must use the official Mercado Pago API origin");
  }
  if (environment.MERCADOPAGO_AUTH_BASE_URL !== "https://auth.mercadopago.com") {
    issue(errors, "MERCADOPAGO_AUTH_BASE_URL", "must use the official Mercado Pago OAuth origin");
  }
  if (environment.STRIPE_CONNECT_MODE !== "disabled") {
    issue(errors, "STRIPE_CONNECT_MODE", "must be disabled for the first-customer Mercado Pago release");
  }

  const retention = Number(environment.BACKUP_RETENTION_DAYS ?? "30");
  if (!Number.isInteger(retention) || retention < 7) {
    issue(errors, "BACKUP_RETENTION_DAYS", "must be an integer of at least 7 days");
  }
  if (!environment.MENSALY_IMAGE) {
    issue(errors, "MENSALY_IMAGE", "is required");
  } else if (!/^ghcr\.io\/besharktech\/mensaly:sha-[0-9a-f]{40}$/.test(environment.MENSALY_IMAGE)) {
    issue(errors, "MENSALY_IMAGE", "must use an immutable sha-<40 hex commit> GHCR tag");
  }
  if (!environment.CADDY_EMAIL || placeholderPattern.test(environment.CADDY_EMAIL)) {
    issue(errors, "CADDY_EMAIL", "must be a real operations email");
  }

  return { target: "production", ok: errors.length === 0, errors: [...new Set(errors)] };
}
