import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateDeploymentReadiness, validateSingleVpsReadiness } from "./deployment-readiness";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    API_PORT: "3001",
    TRUST_PROXY_HOPS: "1",
    CORS_ORIGINS: "https://app.mensaly.online",
    AUTH_SESSION_TTL_HOURS: "168",
    DATABASE_URL:
      "postgresql://mensaly_app:a-long-random-password@db.internal:5432/mensaly?sslmode=require",
    REDIS_URL: "rediss://default:a-long-random-password@redis.internal:6379",
    FILE_STORAGE_DRIVER: "s3",
    S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    S3_REGION: "auto",
    S3_BUCKET: "mensaly-production-files",
    S3_ACCESS_KEY_ID: "r2-access-key-id-value",
    S3_SECRET_ACCESS_KEY: "r2-secret-access-key-value",
    S3_FORCE_PATH_STYLE: "false",
    SENTRY_DSN: "https://public@sentry.mensaly.online/1",
    EMAIL_DELIVERY_MODE: "resend",
    RESEND_API_KEY: "re_a-real-looking-key-value",
    RESEND_FROM_EMAIL: "contato@mensaly.online",
    RESEND_WEBHOOK_SECRET: "whsec_resend-real-secret",
    EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    WEB_APP_URL: "https://app.mensaly.online",
    PUBLIC_WEB_URL: "https://app.mensaly.online",
    PUBLIC_API_URL: "https://api.mensaly.online",
    STRIPE_CONNECT_MODE: "disabled",
    MERCADOPAGO_MODE: "test",
    MERCADOPAGO_CONNECTION_MODE: "oauth",
    MERCADOPAGO_AUTH_BASE_URL: "https://auth.mercadopago.com",
    MERCADOPAGO_CLIENT_ID: "123456789",
    MERCADOPAGO_CLIENT_SECRET: "mercadopago-client-secret-value",
    MERCADOPAGO_OAUTH_REDIRECT_URI: "https://app.mensaly.online/api/v1/payment-integrations/mercadopago/callback",
    MERCADOPAGO_WEBHOOK_SECRET: "mercadopago-webhook-secret-value",
    PAYMENT_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    PAYMENT_LINK_SECRET: Buffer.alloc(32, 2).toString("base64"),
    PUBLIC_ENROLLMENT_LINK_SECRET: Buffer.alloc(32, 4).toString("base64"),
    MESSAGE_AUTOMATION_ENABLED: "false",
    MENSALY_IMAGE: `ghcr.io/besharktech/mensaly:sha-${"a".repeat(40)}`,
    ...overrides,
  };
}

function singleVpsEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    PUBLIC_WEB_HOST: "app.mensaly.online",
    PUBLIC_WEB_URL: "https://app.mensaly.online",
    PUBLIC_API_HOST: "api.mensaly.online",
    PUBLIC_API_URL: "https://api.mensaly.online",
    CADDY_EMAIL: "operacoes@mensaly.online",
    POSTGRES_PASSWORD: "postgres-password-at-least-24-chars",
    REDIS_PASSWORD: "redis-password-at-least-24-characters",
    S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    S3_BUCKET: "mensaly-production-files",
    S3_ACCESS_KEY_ID: "r2-access-key-id-value",
    S3_SECRET_ACCESS_KEY: "r2-secret-access-key-value",
    SENTRY_DSN: "https://public@sentry.mensaly.online/1",
    RESEND_API_KEY: "re_a-real-looking-key-value",
    RESEND_FROM_EMAIL: "contato@mensaly.online",
    RESEND_WEBHOOK_SECRET: "whsec_resend-real-secret",
    EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    STRIPE_CONNECT_MODE: "disabled",
    MERCADOPAGO_MODE: "live",
    MERCADOPAGO_CONNECTION_MODE: "oauth",
    MERCADOPAGO_API_BASE_URL: "https://api.mercadopago.com",
    MERCADOPAGO_AUTH_BASE_URL: "https://auth.mercadopago.com",
    MERCADOPAGO_CLIENT_ID: "1234567890123456",
    MERCADOPAGO_CLIENT_SECRET: "mercadopago-client-secret-value",
    MERCADOPAGO_OAUTH_REDIRECT_URI: "https://app.mensaly.online/api/v1/payment-integrations/mercadopago/callback",
    MERCADOPAGO_WEBHOOK_SECRET: "mercadopago-webhook-secret-value",
    PAYMENT_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    PAYMENT_LINK_SECRET: Buffer.alloc(32, 2).toString("base64"),
    PUBLIC_ENROLLMENT_LINK_SECRET: Buffer.alloc(32, 4).toString("base64"),
    BACKUP_RETENTION_DAYS: "30",
    MENSALY_IMAGE: `ghcr.io/besharktech/mensaly:sha-${"b".repeat(40)}`,
    ...overrides,
  };
}

describe("deployment readiness", () => {
  it("accepts the hardened single-VPS first-customer profile", () => {
    const report = validateSingleVpsReadiness(singleVpsEnvironment());
    assert.deepEqual(report, { target: "production", ok: true, errors: [] });
  });

  it("rejects unsafe single-VPS secrets, routing and backup retention", () => {
    const report = validateSingleVpsReadiness(singleVpsEnvironment({
      PUBLIC_API_HOST: "wrong.mensaly.online",
      POSTGRES_PASSWORD: "REPLACE_WITH_PASSWORD",
      REDIS_PASSWORD: "short",
      S3_ENDPOINT: "https://REPLACE_WITH_ACCOUNT.r2.cloudflarestorage.com",
      S3_BUCKET: "REPLACE_WITH_BUCKET",
      RESEND_FROM_EMAIL: "REPLACE_WITH_SENDER",
      MERCADOPAGO_OAUTH_REDIRECT_URI: "https://api.mensaly.online/callback?organizationId=unsafe",
      MERCADOPAGO_MODE: "test",
      STRIPE_CONNECT_MODE: "live",
      BACKUP_RETENTION_DAYS: "1",
      PAYMENT_LINK_SECRET: Buffer.alloc(32, 1).toString("base64"),
    }));
    assert.equal(report.ok, false);
    const errors = report.errors.join("\n");
    assert.match(errors, /PUBLIC_API_HOST/);
    assert.match(errors, /POSTGRES_PASSWORD/);
    assert.match(errors, /REDIS_PASSWORD/);
    assert.match(errors, /S3_ENDPOINT/);
    assert.match(errors, /S3_BUCKET/);
    assert.match(errors, /RESEND_FROM_EMAIL/);
    assert.match(errors, /MERCADOPAGO_OAUTH_REDIRECT_URI/);
    assert.match(errors, /MERCADOPAGO_MODE/);
    assert.match(errors, /STRIPE_CONNECT_MODE/);
    assert.match(errors, /BACKUP_RETENTION_DAYS/);
    assert.match(errors, /ENCRYPTION_KEYS/);
  });

  it("accepts a hardened staging configuration with Mercado Pago test mode", () => {
    const report = validateDeploymentReadiness(environment(), "staging");
    assert.deepEqual(report, { target: "staging", ok: true, errors: [] });
  });

  it("requires live Mercado Pago credentials only for the final production gate", () => {
    const stagingCredentials = validateDeploymentReadiness(environment(), "production");
    assert.equal(stagingCredentials.ok, false);
    assert.match(stagingCredentials.errors.join("\n"), /MERCADOPAGO_MODE: must be live/);

    const live = validateDeploymentReadiness(
      environment({
        MERCADOPAGO_MODE: "live",
      }),
      "production",
    );
    assert.equal(live.ok, true, live.errors.join("\n"));
  });

  it("rejects local, plaintext, mismatched and placeholder deployment values", () => {
    const report = validateDeploymentReadiness(
      environment({
        TRUST_PROXY_HOPS: "0",
        CORS_ORIGINS: "http://localhost:5173",
        DATABASE_URL: "postgresql://mensaly:mensaly_local@localhost:5432/mensaly",
        REDIS_URL: "redis://localhost:6379",
        S3_ENDPOINT: "http://localhost:9000",
        SENTRY_DSN: "",
        WEB_APP_URL: "https://wrong.mensaly.online",
        MERCADOPAGO_AUTH_BASE_URL: "https://auth.mercadopago.com.br",
        MERCADOPAGO_OAUTH_REDIRECT_URI: "https://api.mensaly.online/wrong/callback?organizationId=unsafe",
        STRIPE_CONNECT_MODE: "test",
        STRIPE_SECRET_KEY: "sk_test_real-looking-secret",
        STRIPE_PUBLISHABLE_KEY: "pk_test_real-looking-public-key",
        STRIPE_WEBHOOK_SECRET: "whsec_stripe-real-secret",
        RESEND_API_KEY: "replace-me",
        PAYMENT_LINK_SECRET: Buffer.alloc(32, 1).toString("base64"),
      }),
      "staging",
    );

    assert.equal(report.ok, false);
    const errors = report.errors.join("\n");
    assert.match(errors, /TRUST_PROXY_HOPS/);
    assert.match(errors, /CORS_ORIGINS/);
    assert.match(errors, /DATABASE_URL/);
    assert.match(errors, /REDIS_URL/);
    assert.match(errors, /S3_ENDPOINT/);
    assert.match(errors, /SENTRY_DSN/);
    assert.match(errors, /WEB_APP_URL/);
    assert.match(errors, /MERCADOPAGO_AUTH_BASE_URL/);
    assert.match(errors, /MERCADOPAGO_OAUTH_REDIRECT_URI/);
    assert.match(errors, /STRIPE_CONNECT_MODE/);
    assert.match(errors, /RESEND_API_KEY/);
    assert.match(errors, /must be different from EMAIL_ENCRYPTION_KEY/);
  });
});
