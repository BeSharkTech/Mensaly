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
import { VerificationType } from "@mensaly/database";
import { verifyPassword } from "@mensaly/auth";

import { createApiApplication } from "./app";
import { LocalEmailDeliveryService } from "./auth/local-email-delivery.service";

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

  it("verifies email once and resets a password while revoking sessions", async () => {
    const app = await createApiApplication(testEnvironment());
    const email = `recovery-${randomUUID()}@api.example.test`;
    const initialPassword = "correct-horse-battery-staple";
    const replacementPassword = "new-correct-horse-password";
    registrationTestEmails.add(email);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const outbox = app.get(LocalEmailDeliveryService);
      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/register", payload: { name: "Recovery Owner", email, password: initialPassword } })).statusCode, 201);

      const verification = outbox.latest(email, VerificationType.EMAIL_VERIFICATION);
      assert.ok(verification);
      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/verify-email/confirm", payload: { token: verification.token } })).statusCode, 204);
      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/verify-email/confirm", payload: { token: verification.token } })).statusCode, 400);

      const login = await fastify.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: initialPassword } });
      const cookie = firstHeader(login.headers["set-cookie"])?.split(";")[0];
      assert.equal(login.statusCode, 200);
      assert.ok(cookie);

      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/password-reset/request", payload: { email } })).statusCode, 202);
      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/password-reset/request", payload: { email: `missing-${randomUUID()}@api.example.test` } })).statusCode, 202);
      const reset = outbox.latest(email, VerificationType.PASSWORD_RESET);
      assert.ok(reset);
      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/password-reset/confirm", payload: { token: reset.token, password: replacementPassword } })).statusCode, 204);
      assert.equal((await fastify.inject({ headers: { cookie }, method: "GET", url: "/api/v1/auth/session" })).statusCode, 401);
      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: initialPassword } })).statusCode, 401);
      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: replacementPassword } })).statusCode, 200);
    } finally {
      await app.close();
    }
  });

  it("creates and updates exactly one organization for the authenticated account", async () => {
    const app = await createApiApplication(testEnvironment());
    const email = `organization-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    registrationTestEmails.add(email);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/register", payload: { name: "Organization Owner", email, password } })).statusCode, 201);
      await getPrismaClient().user.update({
        where: { email },
        data: { emailVerified: true, status: "ACTIVE" },
      });
      const login = await fastify.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
      const cookie = firstHeader(login.headers["set-cookie"])?.split(";")[0];
      assert.ok(cookie);

      const unauthenticated = await fastify.inject({ method: "POST", url: "/api/v1/organization", payload: { name: "Blocked", taxId: "12345678901", phone: "11999999999" } });
      assert.equal(unauthenticated.statusCode, 401);

      const created = await fastify.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/v1/organization",
        payload: {
          name: "Mensaly School",
          legalName: "Mensaly School LTDA",
          taxId: "12.345.678/0001-90",
          phone: "+55 (11) 99999-9999",
          timezone: "America/Sao_Paulo",
          address: { street: "Rua das Flores", number: "100", city: "Sao Paulo", state: "SP", postalCode: "01001-000", country: "BR" },
          brand: { primaryColor: "#112233", logoUrl: "https://example.test/logo.png" },
        },
      });
      assert.equal(created.statusCode, 201);
      assert.equal(created.json().data.taxId, "12345678000190");
      assert.equal(created.json().data.phone, "5511999999999");
      assert.equal(created.json().data.status, "ACTIVE");

      const duplicate = await fastify.inject({
        headers: { cookie }, method: "POST", url: "/api/v1/organization",
        payload: { name: "Another Organization", taxId: "98765432100", phone: "11999999999" },
      });
      assert.equal(duplicate.statusCode, 409);
      assert.equal(duplicate.json().error.code, "ORGANIZATION_ALREADY_EXISTS");

      const own = await fastify.inject({ headers: { cookie }, method: "GET", url: "/api/v1/organization" });
      assert.equal(own.statusCode, 200);
      assert.equal(own.json().data.name, "Mensaly School");
      assert.equal(own.json().data.address.street, "Rua das Flores");

      const updated = await fastify.inject({
        headers: { cookie }, method: "PATCH", url: "/api/v1/organization",
        payload: { name: "Mensaly Academy", timezone: "America/Recife", brand: { secondaryColor: "#445566" } },
      });
      assert.equal(updated.statusCode, 200);
      assert.equal(updated.json().data.name, "Mensaly Academy");
      assert.equal(updated.json().data.timezone, "America/Recife");
      assert.equal(updated.json().data.status, "ACTIVE");

      const statusInjection = await fastify.inject({
        headers: { cookie }, method: "PATCH", url: "/api/v1/organization",
        payload: { status: "BLOCKED" },
      });
      assert.equal(statusInjection.statusCode, 400);
      assert.equal(statusInjection.json().error.code, "VALIDATION_ERROR");

      await getPrismaClient().user.update({
        where: { email },
        data: { role: "PLATFORM_ADMIN" },
      });
      const adminRoute = await fastify.inject({ headers: { cookie }, method: "GET", url: "/api/v1/organization" });
      assert.equal(adminRoute.statusCode, 403);
      assert.equal(adminRoute.json().error.code, "COMPANY_ACCOUNT_REQUIRED");

      const audit = await getPrismaClient().auditLog.findMany({
        where: { actor: { email }, action: { in: ["organization.created", "organization.updated"] } },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(audit.map((entry) => entry.action), ["organization.created", "organization.updated"]);
    } finally {
      await app.close();
    }
  });

  it("derives organization context from the session and separates platform administration", async () => {
    const app = await createApiApplication(testEnvironment());
    const emailA = `scope-a-${randomUUID()}@api.example.test`;
    const emailB = `scope-b-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    registrationTestEmails.add(emailA);
    registrationTestEmails.add(emailB);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const createAccount = async (email: string, name: string, taxId: string) => {
        assert.equal((await fastify.inject({ method: "POST", url: "/api/v1/auth/register", payload: { name, email, password } })).statusCode, 201);
        await getPrismaClient().user.update({ where: { email }, data: { emailVerified: true, status: "ACTIVE" } });
        const login = await fastify.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
        const cookie = firstHeader(login.headers["set-cookie"])?.split(";")[0];
        assert.ok(cookie);
        const created = await fastify.inject({
          headers: { cookie }, method: "POST", url: "/api/v1/organization",
          payload: { name, taxId, phone: "11999999999" },
        });
        assert.equal(created.statusCode, 201);
        return { cookie, organizationId: created.json().data.id as string };
      };

      const accountA = await createAccount(emailA, "Scope A", "11111111111");
      const accountB = await createAccount(emailB, "Scope B", "22222222222");

      const attemptedCrossTenantRead = await fastify.inject({
        headers: { cookie: accountA.cookie, "x-organization-id": accountB.organizationId },
        method: "GET",
        url: `/api/v1/organization?organizationId=${accountB.organizationId}`,
      });
      assert.equal(attemptedCrossTenantRead.statusCode, 200);
      assert.equal(attemptedCrossTenantRead.json().data.id, accountA.organizationId);
      assert.equal(attemptedCrossTenantRead.json().data.id === accountB.organizationId, false);

      await getPrismaClient().organization.update({
        where: { id: accountA.organizationId },
        data: { status: "INACTIVE" },
      });
      const inactiveOrganization = await fastify.inject({ headers: { cookie: accountA.cookie }, method: "GET", url: "/api/v1/organization" });
      assert.equal(inactiveOrganization.statusCode, 403);
      assert.equal(inactiveOrganization.json().error.code, "ORGANIZATION_INACTIVE");
      assert.equal((await fastify.inject({ headers: { cookie: accountB.cookie }, method: "GET", url: "/api/v1/organization" })).statusCode, 200);

      await getPrismaClient().user.update({ where: { email: emailB }, data: { role: "PLATFORM_ADMIN" } });
      const adminSession = await fastify.inject({ headers: { cookie: accountB.cookie }, method: "GET", url: "/api/v1/admin/session" });
      assert.equal(adminSession.statusCode, 200);
      assert.deepEqual(adminSession.json().data, { id: adminSession.json().data.id, email: emailB, role: "PLATFORM_ADMIN", organizationId: null });
      const adminUsingCompanyRoute = await fastify.inject({ headers: { cookie: accountB.cookie }, method: "GET", url: "/api/v1/organization" });
      assert.equal(adminUsingCompanyRoute.statusCode, 403);
      assert.equal(adminUsingCompanyRoute.json().error.code, "COMPANY_ACCOUNT_REQUIRED");
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

  const organizations = await prisma.organization.findMany({
    where: { ownerUserId: { in: users.map((user) => user.id) } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: users.map((user) => user.id) } },
        { organizationId: { in: organizations.map((organization) => organization.id) } },
        { entityId: { in: [...loginAttemptEntities] } },
      ],
    },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizations.map((organization) => organization.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: users.map((user) => user.id) } },
  });
});
