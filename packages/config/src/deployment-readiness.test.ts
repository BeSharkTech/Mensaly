import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateDeploymentReadiness } from "./deployment-readiness";

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
    STRIPE_CONNECT_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_real-looking-secret",
    STRIPE_PUBLISHABLE_KEY: "pk_test_real-looking-public-key",
    STRIPE_WEBHOOK_SECRET: "whsec_stripe-real-secret",
    PAYMENT_LINK_SECRET: Buffer.alloc(32, 2).toString("base64"),
    MESSAGE_AUTOMATION_ENABLED: "false",
    MENSALY_IMAGE: `ghcr.io/besharktech/mensaly:sha-${"a".repeat(40)}`,
    ...overrides,
  };
}

describe("deployment readiness", () => {
  it("accepts a hardened staging configuration with Stripe test mode", () => {
    const report = validateDeploymentReadiness(environment(), "staging");
    assert.deepEqual(report, { target: "staging", ok: true, errors: [] });
  });

  it("requires live Stripe credentials only for the final production gate", () => {
    const stagingCredentials = validateDeploymentReadiness(environment(), "production");
    assert.equal(stagingCredentials.ok, false);
    assert.match(stagingCredentials.errors.join("\n"), /STRIPE_CONNECT_MODE: must be live/);

    const live = validateDeploymentReadiness(
      environment({
        STRIPE_CONNECT_MODE: "live",
        STRIPE_SECRET_KEY: "sk_live_real-looking-secret",
        STRIPE_PUBLISHABLE_KEY: "pk_live_real-looking-public-key",
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
    assert.match(errors, /RESEND_API_KEY/);
    assert.match(errors, /must be different from EMAIL_ENCRYPTION_KEY/);
  });
});
