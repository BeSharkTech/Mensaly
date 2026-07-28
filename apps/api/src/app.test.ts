import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
  type ApiEnvironment,
} from "@mensaly/config";
import { errorEnvelopeSchema } from "@mensaly/contracts";

import { createApiApplication } from "./app";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if (
  !databaseUrl ||
  !redisUrl ||
  new URL(databaseUrl).pathname.slice(1) !== "mensaly_test"
) {
  throw new Error("API tests require the isolated mensaly_test services.");
}

function testEnvironment(
  overrides: Partial<Record<keyof ApiEnvironment, string>> = {},
): ApiEnvironment {
  return parseEnvironment(apiEnvironmentSchema, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    CORS_ORIGINS: "https://allowed.example",
    ...overrides,
  });
}

describe("HTTP API foundation", () => {
  it("serves versioned health, readiness, errors, CORS, correlation, and OpenAPI", async () => {
    const app = await createApiApplication(testEnvironment());

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();

      const live = await fastify.inject({
        method: "GET",
        url: "/api/v1/health/live",
      });
      assert.equal(live.statusCode, 200);
      assert.deepEqual(live.json(), { status: "ok" });
      assert.match(
        live.headers["x-correlation-id"] as string,
        /^[0-9a-f-]{36}$/i,
      );

      const suppliedCorrelationId = "c0a80121-7ac0-4b60-a98f-9c639336a001";
      const correlated = await fastify.inject({
        headers: { "x-correlation-id": suppliedCorrelationId },
        method: "GET",
        url: "/api/v1/health/live",
      });
      assert.equal(
        correlated.headers["x-correlation-id"],
        suppliedCorrelationId,
      );

      const ready = await fastify.inject({
        method: "GET",
        url: "/api/v1/health/ready",
      });
      assert.equal(ready.statusCode, 200);
      assert.deepEqual(ready.json(), {
        status: "ready",
        dependencies: { database: "ready", redis: "ready" },
      });

      const missing = await fastify.inject({
        method: "GET",
        url: "/api/v1/missing",
      });
      assert.equal(missing.statusCode, 404);
      assert.equal(errorEnvelopeSchema.safeParse(missing.json()).success, true);
      assert.equal(missing.json().error.code, "NOT_FOUND");

      const allowed = await fastify.inject({
        headers: { origin: "https://allowed.example" },
        method: "GET",
        url: "/api/v1/health/live",
      });
      assert.equal(
        allowed.headers["access-control-allow-origin"],
        "https://allowed.example",
      );

      const denied = await fastify.inject({
        headers: { origin: "https://denied.example" },
        method: "GET",
        url: "/api/v1/health/live",
      });
      assert.equal(denied.headers["access-control-allow-origin"], undefined);

      const openApi = await fastify.inject({
        method: "GET",
        url: "/api/docs-json",
      });
      assert.equal(openApi.statusCode, 200);
      assert.ok(
        openApi.json().paths["/api/v1/health/live"],
        "OpenAPI must document the versioned liveness endpoint",
      );
    } finally {
      await app.close();
    }
  });

  it("keeps liveness available while readiness reports a database outage", async () => {
    const unavailableDatabaseUrl =
      "postgresql://mensaly_test:mensaly_test_local@127.0.0.1:1/mensaly_test?connect_timeout=1";
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = unavailableDatabaseUrl;
    const app = await createApiApplication(
      testEnvironment({ DATABASE_URL: unavailableDatabaseUrl }),
    );

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const live = await fastify.inject({
        method: "GET",
        url: "/api/v1/health/live",
      });
      const ready = await fastify.inject({
        method: "GET",
        url: "/api/v1/health/ready",
      });

      assert.equal(live.statusCode, 200);
      assert.equal(ready.statusCode, 503);
      assert.equal(ready.json().error.code, "DEPENDENCIES_NOT_READY");
      assert.deepEqual(ready.json().error.details, [
        { field: "database", message: "unavailable" },
      ]);
    } finally {
      await app.close();
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });
});
