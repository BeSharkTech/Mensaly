import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
  workerEnvironmentSchema,
} from "./index";

const validConnections = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/mensaly",
  REDIS_URL: "redis://localhost:6379",
};

describe("environment configuration", () => {
  it("parses valid API values and applies defaults", () => {
    const environment = parseEnvironment(
      apiEnvironmentSchema,
      validConnections,
    );

    assert.equal(environment.NODE_ENV, "development");
    assert.equal(environment.API_PORT, 3001);
    assert.equal(environment.TRUST_PROXY_HOPS, 0);
    assert.equal(environment.AUTH_SESSION_TTL_HOURS, 168);
    assert.equal(environment.LOCAL_STORAGE_PATH, ".local-storage");
    assert.equal(environment.FILE_MAX_SIZE_BYTES, 5 * 1024 * 1024);
    assert.equal(environment.FILE_STORAGE_DRIVER, "local");
    assert.equal(environment.DATABASE_URL, validConnections.DATABASE_URL);
    assert.equal(environment.REDIS_URL, validConnections.REDIS_URL);
    assert.deepEqual(environment.CORS_ORIGINS, ["http://localhost:3000"]);
  });

  it("parses an explicit CORS allowlist", () => {
    const environment = parseEnvironment(apiEnvironmentSchema, {
      ...validConnections,
      CORS_ORIGINS: "https://app.mensaly.com, https://admin.mensaly.com",
    });

    assert.deepEqual(environment.CORS_ORIGINS, [
      "https://app.mensaly.com",
      "https://admin.mensaly.com",
    ]);
  });

  it("refuses wildcard or empty CORS origins in production", () => {
    for (const CORS_ORIGINS of ["*", "", undefined]) {
      assert.throws(
        () =>
          parseEnvironment(apiEnvironmentSchema, {
            ...validConnections,
            NODE_ENV: "production",
            CORS_ORIGINS,
          }),
        /production requires at least one explicit origin/,
      );
    }
  });

  it("treats blank optional Sentry values from Docker Compose as unset", () => {
    const environment = parseEnvironment(apiEnvironmentSchema, {
      ...validConnections,
      SENTRY_DSN: "",
      SENTRY_API_TOKEN: "   ",
      SENTRY_ORG_SLUG: "",
      SENTRY_PROJECT_ID: "",
    });

    assert.equal(environment.SENTRY_DSN, undefined);
    assert.equal(environment.SENTRY_API_TOKEN, undefined);
    assert.equal(environment.SENTRY_ORG_SLUG, undefined);
    assert.equal(environment.SENTRY_PROJECT_ID, undefined);
  });

  it("requires remote object storage in production", () => {
    assert.throws(
      () =>
        parseEnvironment(apiEnvironmentSchema, {
          ...validConnections,
          NODE_ENV: "production",
          CORS_ORIGINS: "https://app.example.test",
        }),
      /FILE_STORAGE_DRIVER/,
    );

    const environment = parseEnvironment(apiEnvironmentSchema, {
      ...validConnections,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://app.example.test",
      FILE_STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      S3_BUCKET: "mensaly-files",
      S3_ACCESS_KEY_ID: "test-key",
      S3_SECRET_ACCESS_KEY: "test-secret",
      EMAIL_DELIVERY_MODE: "resend",
      RESEND_API_KEY: "re_test_key",
      RESEND_FROM_EMAIL: "noreply@example.test",
      RESEND_WEBHOOK_SECRET: "whsec_test_webhook_secret",
      EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    });
    assert.equal(environment.FILE_STORAGE_DRIVER, "s3");
    assert.equal(environment.S3_FORCE_PATH_STYLE, false);
  });

  it("requires Resend credentials when email delivery uses Resend", () => {
    assert.throws(
      () => parseEnvironment(apiEnvironmentSchema, {
        ...validConnections,
        EMAIL_DELIVERY_MODE: "resend",
      }),
      /RESEND_API_KEY/,
    );
  });

  it("requires matching Stripe Connect credentials when enabled", () => {
    assert.throws(
      () =>
        parseEnvironment(apiEnvironmentSchema, {
          ...validConnections,
          STRIPE_CONNECT_MODE: "test",
        }),
      /STRIPE_SECRET_KEY/,
    );

    const environment = parseEnvironment(apiEnvironmentSchema, {
      ...validConnections,
      STRIPE_CONNECT_MODE: "test",
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_PUBLISHABLE_KEY: "pk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      PAYMENT_LINK_SECRET: Buffer.alloc(32, 2).toString("base64"),
    });
    assert.equal(environment.STRIPE_CONNECT_MODE, "test");
    assert.throws(
      () =>
        parseEnvironment(apiEnvironmentSchema, {
          ...validConnections,
          STRIPE_CONNECT_MODE: "test",
          STRIPE_SECRET_KEY: "sk_live_wrong_mode",
          STRIPE_PUBLISHABLE_KEY: "pk_test_example",
          STRIPE_WEBHOOK_SECRET: "whsec_example",
          PAYMENT_LINK_SECRET: Buffer.alloc(32, 2).toString("base64"),
        }),
      /sk_test_/,
    );
  });

  it("requires Mercado Pago OAuth, webhook and isolated encryption settings when enabled", () => {
    assert.throws(
      () => parseEnvironment(apiEnvironmentSchema, {
        ...validConnections,
        MERCADOPAGO_MODE: "test",
      }),
      /MERCADOPAGO_CLIENT_ID/,
    );

    const environment = parseEnvironment(apiEnvironmentSchema, {
      ...validConnections,
      MERCADOPAGO_MODE: "test",
      MERCADOPAGO_CLIENT_ID: "123456",
      MERCADOPAGO_CLIENT_SECRET: "client-secret",
      MERCADOPAGO_OAUTH_REDIRECT_URI: "https://app.example.test/api/v1/payment-integrations/mercadopago/callback",
      MERCADOPAGO_WEBHOOK_SECRET: "webhook-secret",
      PAYMENT_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
      PAYMENT_LINK_SECRET: Buffer.alloc(32, 3).toString("base64"),
    });
    assert.equal(environment.MERCADOPAGO_MODE, "test");

    assert.throws(
      () => parseEnvironment(apiEnvironmentSchema, {
        ...validConnections,
        EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
        MERCADOPAGO_MODE: "test",
        MERCADOPAGO_CLIENT_ID: "123456",
        MERCADOPAGO_CLIENT_SECRET: "client-secret",
        MERCADOPAGO_OAUTH_REDIRECT_URI: "https://app.example.test/api/v1/payment-integrations/mercadopago/callback",
        MERCADOPAGO_WEBHOOK_SECRET: "webhook-secret",
        PAYMENT_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
        PAYMENT_LINK_SECRET: Buffer.alloc(32, 3).toString("base64"),
      }),
      /must be different from EMAIL_ENCRYPTION_KEY/,
    );
  });

  it("coerces a valid API port", () => {
    const environment = parseEnvironment(apiEnvironmentSchema, {
      ...validConnections,
      NODE_ENV: "test",
      API_PORT: "4000",
      TRUST_PROXY_HOPS: "2",
    });

    assert.equal(environment.NODE_ENV, "test");
    assert.equal(environment.API_PORT, 4000);
    assert.equal(environment.TRUST_PROXY_HOPS, 2);
  });

  it("reports every missing worker variable", () => {
    assert.throws(
      () => parseEnvironment(workerEnvironmentSchema, {}),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DATABASE_URL/);
        assert.match(error.message, /REDIS_URL/);
        return true;
      },
    );
  });

  it("applies safe BullMQ worker defaults", () => {
    const environment = parseEnvironment(
      workerEnvironmentSchema,
      validConnections,
    );

    assert.equal(environment.BULLMQ_PREFIX, "mensaly");
    assert.equal(environment.BULLMQ_WORKER_CONCURRENCY, 5);
    assert.equal(environment.BULLMQ_JOB_ATTEMPTS, 4);
    assert.equal(environment.BULLMQ_BACKOFF_MS, 1000);
    assert.equal(environment.BULLMQ_METRICS_INTERVAL_MS, 30_000);
    assert.equal(environment.SCHEDULER_INTERVAL_MS, 60_000);
    assert.equal(environment.SCHEDULER_LOOKAHEAD_MS, 86_400_000);
    assert.equal(environment.FAKE_MESSAGE_ADAPTER_OUTCOME, "READ");
    assert.equal(environment.MESSAGE_AUTOMATION_ENABLED, true);
  });

  it("requires Resend delivery and credentials for the production worker", () => {
    assert.throws(
      () =>
        parseEnvironment(workerEnvironmentSchema, {
          ...validConnections,
          NODE_ENV: "production",
        }),
      /EMAIL_DELIVERY_MODE/,
    );

    const environment = parseEnvironment(workerEnvironmentSchema, {
      ...validConnections,
      NODE_ENV: "production",
      EMAIL_DELIVERY_MODE: "resend",
      RESEND_API_KEY: "re_test_key",
      RESEND_FROM_EMAIL: "noreply@example.test",
      EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    });
    assert.equal(environment.EMAIL_DELIVERY_MODE, "resend");
  });

  it("validates the configured fake adapter outcome", () => {
    const environment = parseEnvironment(workerEnvironmentSchema, {
      ...validConnections,
      FAKE_MESSAGE_ADAPTER_OUTCOME: "DELIVERED",
    });
    assert.equal(environment.FAKE_MESSAGE_ADAPTER_OUTCOME, "DELIVERED");
    assert.throws(
      () =>
        parseEnvironment(workerEnvironmentSchema, {
          ...validConnections,
          FAKE_MESSAGE_ADAPTER_OUTCOME: "META",
        }),
      /FAKE_MESSAGE_ADAPTER_OUTCOME/,
    );
  });

  it("rejects unsafe BullMQ worker configuration", () => {
    assert.throws(
      () =>
        parseEnvironment(workerEnvironmentSchema, {
          ...validConnections,
          BULLMQ_PREFIX: "mensaly:unsafe",
          BULLMQ_WORKER_CONCURRENCY: "0",
          BULLMQ_JOB_ATTEMPTS: "0",
          BULLMQ_BACKOFF_MS: "1",
          BULLMQ_METRICS_INTERVAL_MS: "1",
          SCHEDULER_INTERVAL_MS: "1",
          SCHEDULER_LOOKAHEAD_MS: "1",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /BULLMQ_PREFIX/);
        assert.match(error.message, /BULLMQ_WORKER_CONCURRENCY/);
        assert.match(error.message, /BULLMQ_JOB_ATTEMPTS/);
        assert.match(error.message, /BULLMQ_BACKOFF_MS/);
        assert.match(error.message, /BULLMQ_METRICS_INTERVAL_MS/);
        assert.match(error.message, /SCHEDULER_INTERVAL_MS/);
        assert.match(error.message, /SCHEDULER_LOOKAHEAD_MS/);
        return true;
      },
    );
  });

  it("rejects incorrect connection protocols", () => {
    assert.throws(
      () =>
        parseEnvironment(workerEnvironmentSchema, {
          DATABASE_URL: "https://database.example",
          REDIS_URL: "https://redis.example",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /postgres/);
        assert.match(error.message, /redis/);
        return true;
      },
    );
  });
});
