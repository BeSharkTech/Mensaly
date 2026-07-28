import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
  type ApiEnvironment,
} from "@mensaly/config";
import { errorEnvelopeSchema } from "@mensaly/contracts";
import { getPrismaClient } from "@mensaly/database";
import { verifyPassword } from "@mensaly/auth";

import { createApiApplication } from "./app";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const registrationTestEmails = new Set<string>();
const loginAttemptEntities = new Set<string>();

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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

  it("registers a pending company account with a protected password", async () => {
    const app = await createApiApplication(testEnvironment());
    const email = `registration-${randomUUID()}@api.example.test`;
    registrationTestEmails.add(email);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          name: "Mensaly Owner",
          email: email.toUpperCase(),
          password: "correct-horse-battery-staple",
        },
      });

      assert.equal(response.statusCode, 201);
      assert.deepEqual(response.json().data, {
        id: response.json().data.id,
        name: "Mensaly Owner",
        email,
        emailVerified: false,
        status: "PENDING_VERIFICATION",
      });

      const user = await getPrismaClient().user.findUniqueOrThrow({
        where: { email },
        include: { accounts: true, auditLogs: true },
      });
      const credential = user.accounts.find(
        (account) => account.providerId === "credential",
      );

      assert.equal(user.role, "COMPANY_ACCOUNT");
      assert.equal(user.status, "PENDING_VERIFICATION");
      assert.equal(credential?.password === "correct-horse-battery-staple", false);
      assert.equal(await verifyPassword("correct-horse-battery-staple", credential?.password ?? ""), true);
      assert.equal(user.auditLogs[0]?.action, "auth.registration.created");

      const duplicate = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          name: "Another Owner",
          email,
          password: "another-correct-password",
        },
      });
      assert.equal(duplicate.statusCode, 409);
      assert.equal(duplicate.json().error.code, "EMAIL_ALREADY_REGISTERED");

      const invalid = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          name: "A",
          email: `not-${randomUUID()}.invalid`,
          password: "short",
        },
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(errorEnvelopeSchema.safeParse(invalid.json()).success, true);

      const unexpectedField = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          name: "Mensaly Owner",
          email: `extra-${randomUUID()}@api.example.test`,
          password: "correct-horse-battery-staple",
          role: "PLATFORM_ADMIN",
        },
      });
      assert.equal(unexpectedField.statusCode, 400);
      assert.equal(
        unexpectedField.json().error.code,
        "VALIDATION_ERROR",
      );
    } finally {
      await app.close();
    }
  });

  it("creates, validates, expires, and revokes a secure login session", async () => {
    const app = await createApiApplication(testEnvironment());
    const email = `login-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    registrationTestEmails.add(email);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const registration = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { name: "Login Owner", email, password },
      });
      assert.equal(registration.statusCode, 201);

      const unverified = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      assert.equal(unverified.statusCode, 403);
      assert.equal(unverified.json().error.code, "EMAIL_NOT_VERIFIED");

      await getPrismaClient().user.update({
        where: { email },
        data: { emailVerified: true, status: "ACTIVE" },
      });

      const login = await fastify.inject({
        headers: { "user-agent": "Mensaly test client" },
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: email.toUpperCase(), password },
      });
      assert.equal(login.statusCode, 200);
      assert.equal(login.json().data.email, email);
      assert.equal(login.json().data.password, undefined);

      const loginCookie = firstHeader(login.headers["set-cookie"]);
      assert.ok(loginCookie);
      assert.match(loginCookie, /mensaly_session=/);
      assert.match(loginCookie, /HttpOnly/);
      assert.match(loginCookie, /SameSite=Lax/);
      const cookie = loginCookie.split(";")[0];

      const storedSession = await getPrismaClient().session.findFirstOrThrow({
        where: { user: { email } },
      });
      assert.match(storedSession.tokenHash, /^[a-f0-9]{64}$/);
      assert.equal(storedSession.tokenHash.includes(cookie.split("=")[1]), false);

      const current = await fastify.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/v1/auth/session",
      });
      assert.equal(current.statusCode, 200);
      assert.equal(current.json().data.email, email);

      const logout = await fastify.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/v1/auth/logout",
      });
      assert.equal(logout.statusCode, 204);
      assert.match(firstHeader(logout.headers["set-cookie"]) ?? "", /Max-Age=0/);

      const revoked = await fastify.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/v1/auth/session",
      });
      assert.equal(revoked.statusCode, 401);
      assert.equal(revoked.json().error.code, "SESSION_INVALID");

      const secondLogin = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      const secondCookie = firstHeader(secondLogin.headers["set-cookie"])
        ?.split(";")[0];
      assert.equal(secondLogin.statusCode, 200);
      assert.ok(secondCookie);
      await getPrismaClient().session.updateMany({
        where: { user: { email } },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const expired = await fastify.inject({
        headers: { cookie: secondCookie },
        method: "GET",
        url: "/api/v1/auth/session",
      });
      assert.equal(expired.statusCode, 401);
      assert.equal(expired.json().error.code, "SESSION_INVALID");
    } finally {
      await app.close();
    }
  });

  it("limits repeated failed login attempts", async () => {
    const app = await createApiApplication(testEnvironment());
    const email = `unknown-${randomUUID()}@api.example.test`;
    loginAttemptEntities.add(email);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password: "wrong-password" },
        });
        assert.equal(response.statusCode, 401);
      }

      const limited = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: "wrong-password" },
      });
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json().error.code, "LOGIN_RATE_LIMITED");
    } finally {
      await app.close();
    }
  });
});

after(async () => {
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({
    where: { email: { in: [...registrationTestEmails] } },
    select: { id: true },
  });

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: users.map((user) => user.id) } },
        { entityId: { in: [...loginAttemptEntities] } },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: { id: { in: users.map((user) => user.id) } },
  });
});
