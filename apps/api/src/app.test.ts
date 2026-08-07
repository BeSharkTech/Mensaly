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
import { FinancialService } from "./financial/financial.service";
import { OperationalService } from "./operational/operational.service";

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

      assert.equal(fastify.initialConfig.maxParamLength, 256);

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
      assert.equal(live.headers["cache-control"], "no-store");
      assert.equal(live.headers["x-content-type-options"], "nosniff");
      assert.equal(live.headers["x-frame-options"], "DENY");
      assert.equal(live.headers["referrer-policy"], "no-referrer");

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

      const csrfRejected = await fastify.inject({
        headers: {
          cookie: "mensaly_session=browser-session",
          origin: "https://denied.example",
        },
        method: "POST",
        url: "/api/v1/auth/logout",
      });
      assert.equal(csrfRejected.statusCode, 403);
      assert.equal(csrfRejected.json().error.code, "CSRF_ORIGIN_REJECTED");

      const csrfAllowed = await fastify.inject({
        headers: {
          cookie: "mensaly_session=browser-session",
          origin: "https://allowed.example",
        },
        method: "POST",
        url: "/api/v1/auth/logout",
      });
      assert.equal(csrfAllowed.statusCode, 204);

      const csrfAllowedFromLocalDevelopment = await fastify.inject({
        headers: {
          cookie: "mensaly_session=browser-session",
          origin: "http://localhost:5173",
        },
        method: "POST",
        url: "/api/v1/auth/logout",
      });
      assert.equal(csrfAllowedFromLocalDevelopment.statusCode, 204);

      const openApi = await fastify.inject({
        method: "GET",
        url: "/api/docs-json",
      });
      assert.equal(openApi.statusCode, 200);
      assert.ok(
        openApi.json().paths["/api/v1/health/live"],
        "OpenAPI must document the versioned liveness endpoint",
      );
      const createPaymentOperation =
        openApi.json().paths["/api/v1/charges/{id}/payments"]?.post;
      assert.ok(
        createPaymentOperation,
        "OpenAPI must document manual payment creation",
      );
      assert.equal(
        createPaymentOperation.parameters.some(
          (parameter: { in?: string; name?: string; required?: boolean }) =>
            parameter.in === "header" &&
            parameter.name === "Idempotency-Key" &&
            parameter.required === true,
        ),
        true,
      );
      assert.deepEqual(
        createPaymentOperation.requestBody.content["application/json"].schema
          .required,
        ["amountCents", "method", "paidAt"],
      );
      const reminderConfigurationOperation =
        openApi.json().paths["/api/v1/reminder-configuration"]?.put;
      assert.ok(
        reminderConfigurationOperation,
        "OpenAPI must document reminder configuration",
      );
      assert.deepEqual(
        reminderConfigurationOperation.requestBody.content["application/json"]
          .schema.required,
        ["enabled", "allowedHours", "dailyLimit", "rules"],
      );
      const messageTemplateOperation =
        openApi.json().paths["/api/v1/message-templates"]?.post;
      assert.ok(
        messageTemplateOperation,
        "OpenAPI must document internal message templates",
      );
      assert.deepEqual(
        messageTemplateOperation.requestBody.content["application/json"].schema
          .required,
        ["name", "body"],
      );
      const messageScheduleOperation =
        openApi.json().paths["/api/v1/message-schedules"]?.post;
      assert.ok(
        messageScheduleOperation,
        "OpenAPI must document persisted message schedules",
      );
      assert.deepEqual(
        messageScheduleOperation.requestBody.content["application/json"].schema
          .required,
        ["chargeId", "templateId", "scheduledFor"],
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
        { field: "database", message: "Indisponível no momento." },
      ]);
    } finally {
      await app.close();
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("registers a pending account with a protected password", async () => {
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
        devVerificationToken: response.json().data.devVerificationToken,
      });
      assert.equal(
        typeof response.json().data.devVerificationToken,
        "string",
      );

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
      const registrationVerification = app
        .get(LocalEmailDeliveryService)
        .latest(email, VerificationType.EMAIL_VERIFICATION);
      assert.ok(registrationVerification);
      assert.equal(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/v1/auth/verify-email/confirm",
            payload: { token: registrationVerification.token },
          })
        ).statusCode,
        204,
      );
      assert.equal(
        (
          await getPrismaClient().user.findUniqueOrThrow({
            where: { email },
          })
        ).emailVerified,
        true,
      );
      assert.equal(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/v1/auth/verify-email/confirm",
            payload: { token: registrationVerification.token },
          })
        ).statusCode,
        400,
      );

      const shortPasswordEmail = `short-password-${randomUUID()}@api.example.test`;
      registrationTestEmails.add(shortPasswordEmail);
      const shortPasswordRegistration = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          name: "Short Password Owner",
          email: shortPasswordEmail,
          password: "senha6",
        },
      });
      assert.equal(shortPasswordRegistration.statusCode, 201);

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
          name: "Invalid Password Owner",
          email: `not-${randomUUID()}@api.example.test`,
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
      const loginVerification = app
        .get(LocalEmailDeliveryService)
        .latest(email, VerificationType.EMAIL_VERIFICATION);
      assert.ok(loginVerification);
      assert.equal(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/v1/auth/verify-email/confirm",
            payload: { token: loginVerification.token },
          })
        ).statusCode,
        204,
      );

      const firstLogin = await fastify.inject({
        headers: { "user-agent": "Mensaly test client" },
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: email.toUpperCase(), password },
      });
      assert.equal(firstLogin.statusCode, 200);

      const login = firstLogin;
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
      assert.equal(
        await getPrismaClient().session.count({
          where: { user: { email } },
        }),
        0,
      );
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

  it("does not let failed attempts lock out the owner with the correct password", async () => {
    const app = await createApiApplication(testEnvironment());
    const email = `lockout-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    registrationTestEmails.add(email);
    loginAttemptEntities.add(email);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      assert.equal((await fastify.inject({method:"POST",url:"/api/v1/auth/register",payload:{name:"Lockout Owner",email,password}})).statusCode,201);
      await getPrismaClient().user.update({where:{email},data:{emailVerified:true,status:"ACTIVE"}});
      for (let attempt = 0; attempt < 5; attempt += 1) {
        assert.equal((await fastify.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password:"wrong-password"}})).statusCode,401);
      }
      const ownerLogin = await fastify.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password}});
      assert.equal(ownerLogin.statusCode,200);
      assert.ok(firstHeader(ownerLogin.headers["set-cookie"]));
      const attackerRetry = await fastify.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password:"wrong-password"}});
      assert.equal(attackerRetry.statusCode,429);
    } finally {
      await app.close();
    }
  });

  it("resets a password while revoking sessions", async () => {
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
      const recoveryVerification = outbox.latest(
        email,
        VerificationType.EMAIL_VERIFICATION,
      );
      assert.ok(recoveryVerification);
      assert.equal(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/v1/auth/verify-email/confirm",
            payload: { token: recoveryVerification.token },
          })
        ).statusCode,
        204,
      );

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
      const statusUpdate = await fastify.inject({ headers: { cookie: accountB.cookie }, method: "PATCH", url: `/api/v1/admin/organizations/${accountA.organizationId}/status`, payload: { status: "ACTIVE" } });
      assert.equal(statusUpdate.statusCode, 200);
      assert.equal(statusUpdate.json().data.status, "ACTIVE");
      assert.equal((await fastify.inject({ headers: { cookie: accountB.cookie }, method: "PATCH", url: "/api/v1/admin/organizations/not-a-uuid/status", payload: { status: "ACTIVE" } })).statusCode, 400);
      const statusAudit = await getPrismaClient().auditLog.findFirstOrThrow({ where: { organizationId: accountA.organizationId, action: "organization.status.updated" } });
      assert.notEqual(statusAudit.correlationId, null);
      const adminUsingCompanyRoute = await fastify.inject({ headers: { cookie: accountB.cookie }, method: "GET", url: "/api/v1/organization" });
      assert.equal(adminUsingCompanyRoute.statusCode, 403);
      assert.equal(adminUsingCompanyRoute.json().error.code, "COMPANY_ACCOUNT_REQUIRED");
    } finally {
      await app.close();
    }
  });

  it("runs the Lovable workspace, public form, and broadcast flow", async () => {
    const app = await createApiApplication(testEnvironment());
    const email = `workspace-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    registrationTestEmails.add(email);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      assert.equal((await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { name: "Workspace Owner", email, password },
      })).statusCode, 201);
      const workspaceVerification = app
        .get(LocalEmailDeliveryService)
        .latest(email, VerificationType.EMAIL_VERIFICATION);
      assert.ok(workspaceVerification);
      assert.equal(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/v1/auth/verify-email/confirm",
            payload: { token: workspaceVerification.token },
          })
        ).statusCode,
        204,
      );
      const login = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      const cookie = firstHeader(login.headers["set-cookie"])?.split(";")[0];
      assert.ok(cookie);
      const headers = { cookie };

      const organization = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/organization",
        payload: {
          name: "Workspace School",
          brand: { primaryColor: "#4353ff", onboardingComplete: true },
        },
      });
      assert.equal(organization.statusCode, 201);
      const organizationId = organization.json().data.id as string;
      const plan = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/plans",
        payload: { name: "Mensal", amountCents: 19000, dueDay: 10 },
      });
      const student = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/students",
        payload: { name: "Aluno Workspace", cpf: "52998224725", birthDate: "2015-04-12" },
      });
      const guardian = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/guardians",
        payload: { name: "Responsavel Workspace", phone: "11999999999", taxId: "11144477735" },
      });
      assert.equal(plan.statusCode, 201);
      assert.equal(student.statusCode, 201);
      assert.equal(student.json().birthDate.slice(0, 10), "2015-04-12");
      assert.equal(guardian.statusCode, 201);
      assert.equal((await fastify.inject({
        headers,
        method: "POST",
        url: `/api/v1/students/${student.json().id}/guardians/${guardian.json().id}`,
        payload: { relationship: "Responsavel" },
      })).statusCode, 201);
      const enrollment = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/enrollments",
        payload: {
          studentId: student.json().id,
          guardianId: guardian.json().id,
          planId: plan.json().id,
          startDate: "2026-01-01",
        },
      });
      assert.equal(enrollment.statusCode, 201);
      assert.equal(enrollment.json().chargeOpenDay, 1);
      const updatedPlanWindow = await fastify.inject({
        headers,
        method: "PATCH",
        url: `/api/v1/plans/${plan.json().id}`,
        payload: { chargeOpenDay: 5, dueDay: 15 },
      });
      assert.equal(updatedPlanWindow.statusCode, 200);
      const propagatedEnrollment = await fastify.inject({
        headers,
        method: "GET",
        url: `/api/v1/enrollments/${enrollment.json().id}`,
      });
      assert.equal(propagatedEnrollment.json().chargeOpenDay, 5);
      assert.equal(propagatedEnrollment.json().dueDay, 15);
      assert.equal(
        (
          await fastify.inject({
            headers,
            method: "PATCH",
            url: `/api/v1/plans/${plan.json().id}`,
            payload: { chargeOpenDay: 16 },
          })
        ).statusCode,
        400,
      );

      const field = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/workspace/custom-fields",
        payload: {
          label: "Turma",
          fieldType: "SELECT",
          options: ["A", "B"],
          required: true,
        },
      });
      const guardianField = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/workspace/custom-fields",
        payload: {
          label: "Contato alternativo",
          fieldType: "TEXT",
          subject: "GUARDIAN",
          required: false,
        },
      });
      const product = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/workspace/products",
        payload: {
          name: "Uniforme",
          description: "",
          priceCents: 8500,
          stockQuantity: 20,
        },
      });
      const event = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/workspace/events",
        payload: {
          name: "Festa",
          description: "",
          location: "Quadra",
          startsAt: "2026-12-10T18:00:00.000Z",
          endsAt: "2026-12-10T21:00:00.000Z",
          priceCents: 3000,
        },
      });
      assert.equal(field.statusCode, 201);
      assert.equal(guardianField.statusCode, 201);
      assert.equal(product.statusCode, 201);
      assert.equal(event.statusCode, 201);
      assert.equal((await fastify.inject({
        headers,
        method: "PATCH",
        url: `/api/v1/workspace/student-field-values/${student.json().id}`,
        payload: { values: { [field.json().id]: "A" } },
      })).statusCode, 200);

      const wrongSubject = await fastify.inject({
        headers,
        method: "PATCH",
        url: `/api/v1/workspace/student-field-values/${student.json().id}`,
        payload: { values: { [guardianField.json().id]: "should fail" } },
      });
      assert.equal(wrongSubject.statusCode, 400);
      assert.equal(wrongSubject.json().error.code, "CUSTOM_FIELD_SUBJECT_INVALID");
      assert.equal((await fastify.inject({
        headers,
        method: "PATCH",
        url: `/api/v1/workspace/guardian-field-values/${guardian.json().id}`,
        payload: { values: { [guardianField.json().id]: "11988887777" } },
      })).statusCode, 200);

      const broadcast = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/workspace/broadcasts",
        payload: {
          name: "Aviso geral",
          body: "Mensagem de teste",
          targetType: "GENERAL",
        },
      });
      assert.equal(broadcast.statusCode, 201);
      const queued = await fastify.inject({
        headers,
        method: "POST",
        url: "/api/v1/workspace/broadcast-sends",
        payload: {
          messageId: broadcast.json().id,
          studentIds: [student.json().id],
        },
      });
      assert.equal(queued.statusCode, 201);
      assert.equal(queued.json().queued, 1);

      const workspace = await fastify.inject({
        headers,
        method: "GET",
        url: "/api/v1/workspace",
      });
      assert.equal(workspace.statusCode, 200);
      assert.equal(workspace.json().products.length, 1);
      assert.equal(workspace.json().events.length, 1);
      assert.equal(workspace.json().guardianFieldValues[guardian.json().id][guardianField.json().id], "11988887777");
      assert.equal(workspace.json().broadcastSends[0].status, "QUEUED");

      const publicForm = await fastify.inject({
        method: "GET",
        url: `/api/v1/public/forms/${organizationId}`,
      });
      assert.equal(publicForm.statusCode, 410);
      assert.equal(publicForm.json().error.code, "LEGACY_PUBLIC_FORM_RETIRED");
      const retiredSubmission = await fastify.inject({
        method: "POST",
        url: `/api/v1/public/forms/${organizationId}/responses`,
        payload: { cpf: "52998224725", values: { [field.json().id]: "B" } },
      });
      assert.equal(retiredSubmission.statusCode, 410);
      assert.equal(retiredSubmission.json().error.code, "LEGACY_PUBLIC_FORM_RETIRED");

      const updatedProduct = await fastify.inject({
        headers,
        method: "PATCH",
        url: `/api/v1/workspace/products/${product.json().id}`,
        payload: { stockQuantity: 5 },
      });
      assert.equal(updatedProduct.statusCode, 200);
      assert.equal(updatedProduct.json().stockQuantity, 5);
      const updatedEvent = await fastify.inject({
        headers,
        method: "PATCH",
        url: `/api/v1/workspace/events/${event.json().id}`,
        payload: { location: "Quadra 2" },
      });
      assert.equal(updatedEvent.statusCode, 200);
      assert.equal(updatedEvent.json().location, "Quadra 2");
      assert.equal((await fastify.inject({headers,method:"DELETE",url:`/api/v1/workspace/products/${product.json().id}`})).statusCode,204);
      assert.equal((await fastify.inject({headers,method:"DELETE",url:`/api/v1/workspace/events/${event.json().id}`})).statusCode,204);
      assert.equal((await fastify.inject({headers,method:"DELETE",url:`/api/v1/workspace/custom-fields/${field.json().id}`})).statusCode,204);
      assert.equal((await fastify.inject({headers,method:"DELETE",url:`/api/v1/workspace/custom-fields/${guardianField.json().id}`})).statusCode,204);
      const emptyWorkspace = await fastify.inject({headers,method:"GET",url:"/api/v1/workspace"});
      assert.equal(emptyWorkspace.json().products.length,0);
      assert.equal(emptyWorkspace.json().events.length,0);
      assert.equal(emptyWorkspace.json().customFields.length,0);
    } finally {
      await app.close();
    }
  });

  it("runs the operational CRUD flow without crossing organization boundaries", async () => {
    const app = await createApiApplication(testEnvironment());
    const email = `operational-${randomUUID()}@api.example.test`;
    const otherEmail = `financial-scope-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    registrationTestEmails.add(email);
    registrationTestEmails.add(otherEmail);
    try {
      await app.init(); const fastify = app.getHttpAdapter().getInstance();
      assert.equal((await fastify.inject({ method:"POST",url:"/api/v1/auth/register",payload:{name:"Operational Owner",email,password} })).statusCode,201);
      await getPrismaClient().user.update({where:{email},data:{emailVerified:true,status:"ACTIVE"}});
      const login=await fastify.inject({method:"POST",url:"/api/v1/auth/login",payload:{email,password}}); const cookie=firstHeader(login.headers["set-cookie"])?.split(";")[0]; assert.ok(cookie);
      const organization=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/organization",payload:{name:"Operational School",taxId:`33${Date.now().toString().slice(-9)}`,phone:"11999999999"}}); assert.equal(organization.statusCode,201);
      const organizationId = organization.json().data.id as string;
      await getPrismaClient().mercadoPagoConnection.create({data:{organizationId,mercadoPagoUserId:`operational-${randomUUID()}`,publicKey:"TEST-public-key",encryptedAccessToken:{version:1},encryptedRefreshToken:{version:1},status:"CONNECTED",liveMode:false,scopes:"payments write",tokenExpiresAt:new Date("2100-01-01T00:00:00.000Z")}});
      const plan=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/plans",payload:{name:"Mensal",amountCents:15000,dueDay:10}}); assert.equal(plan.statusCode,201);
      const operationalService=app.get(OperationalService);
      await assert.rejects(operationalService.updatePlan({userId:randomUUID(),email:"missing@example.test",role:"COMPANY_ACCOUNT",organizationId},plan.json().id,{name:"Must Roll Back"}));
      assert.equal((await getPrismaClient().plan.findUniqueOrThrow({where:{id:plan.json().id}})).name,"Mensal");
      const student=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/students",payload:{name:"Ana Student",cpf:"11111111111",phone:"(11) 98888-7777"}}); assert.equal(student.statusCode,201); assert.equal(student.json().cpf,"11111111111");
      const guardian=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/guardians",payload:{name:"Maria Guardian",phone:"11999998888",taxId:"22222222222"}}); assert.equal(guardian.statusCode,201); assert.equal(guardian.json().taxId,"22222222222");
      const guardianLink=await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/students/${student.json().id}/guardians/${guardian.json().id}`,payload:{relationship:"Mae"}}); assert.equal(guardianLink.statusCode,201);
      const repeatedGuardianLink=await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/students/${student.json().id}/guardians/${guardian.json().id}`,payload:{relationship:"Responsavel"}}); assert.equal(repeatedGuardianLink.statusCode,201); assert.equal(repeatedGuardianLink.json().id,guardianLink.json().id);
      assert.equal(await getPrismaClient().studentGuardian.count({where:{organizationId,studentId:student.json().id,guardianId:guardian.json().id}}),1);
      const enrollment=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/enrollments",payload:{studentId:student.json().id,guardianId:guardian.json().id,planId:plan.json().id,startDate:"2026-01-01"}}); assert.equal(enrollment.statusCode,201); assert.equal(enrollment.json().amountCents,15000);
      const billingToday=new Date(); const billingOpensOn=new Date(Date.UTC(billingToday.getUTCFullYear(),billingToday.getUTCMonth(),1)).toISOString().slice(0,10); const billingExpiresOn=new Date(Date.UTC(billingToday.getUTCFullYear(),billingToday.getUTCMonth()+1,0)).toISOString().slice(0,10);
      const billingRulePayload={name:"Taxa de uniforme",sourceType:"PLAN",sourceId:plan.json().id,frequency:"ONCE",opensOn:billingOpensOn,expiresOn:billingExpiresOn,studentIds:[student.json().id]};
      const billingRuleHeaders={cookie,"idempotency-key":"billing-rule:uniform-test"};
      const billingRule=await fastify.inject({headers:billingRuleHeaders,method:"POST",url:"/api/v1/billing-rules",payload:billingRulePayload}); assert.equal(billingRule.statusCode,201); assert.equal(billingRule.json().data.chargesCreated,1); assert.equal(billingRule.json().data.replayed,false);
      const replayedBillingRule=await fastify.inject({headers:billingRuleHeaders,method:"POST",url:"/api/v1/billing-rules",payload:billingRulePayload}); assert.equal(replayedBillingRule.statusCode,201); assert.equal(replayedBillingRule.json().data.rule.id,billingRule.json().data.rule.id); assert.equal(replayedBillingRule.json().data.replayed,true);
      const reusedBillingRuleKey=await fastify.inject({headers:billingRuleHeaders,method:"POST",url:"/api/v1/billing-rules",payload:{...billingRulePayload,name:"Outra cobrança"}}); assert.equal(reusedBillingRuleKey.statusCode,409); assert.equal(reusedBillingRuleKey.json().error.code,"IDEMPOTENCY_KEY_REUSED");
      assert.equal(await getPrismaClient().billingRule.count({where:{organizationId}}),1);
      assert.equal(await getPrismaClient().charge.count({where:{billingRuleId:billingRule.json().data.rule.id}}),1);
      const listedBillingRules=await fastify.inject({headers:{cookie},method:"GET",url:"/api/v1/billing-rules"}); assert.equal(listedBillingRules.statusCode,200); assert.equal(listedBillingRules.json().data[0].targets[0].student.id,student.json().id);
      const duplicateActiveEnrollment=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/enrollments",payload:{studentId:student.json().id,guardianId:guardian.json().id,planId:plan.json().id,startDate:"2026-01-02"}}); assert.equal(duplicateActiveEnrollment.statusCode,409); assert.equal(duplicateActiveEnrollment.json().error.code,"ACTIVE_ENROLLMENT_EXISTS");
      const invalidPhone=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/guardians",payload:{name:"Invalid Phone",phone:"--------",taxId:"12345678909"}}); assert.equal(invalidPhone.statusCode,400); assert.equal(invalidPhone.json().error.code,"PHONE_INVALID");
      const invalidTax=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/guardians",payload:{name:"Invalid Tax",phone:"11999990000",taxId:"..........."}}); assert.equal(invalidTax.statusCode,400); assert.equal(invalidTax.json().error.code,"CPF_INVALID");
      const invalidDateRange=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/enrollments",payload:{studentId:student.json().id,guardianId:guardian.json().id,planId:plan.json().id,startDate:"2026-02-01",endDate:"2026-01-31"}}); assert.equal(invalidDateRange.statusCode,400);
      const fullDiscount=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/enrollments",payload:{studentId:student.json().id,guardianId:guardian.json().id,planId:plan.json().id,amountCents:15000,discountCents:15000,startDate:"2026-02-01"}}); assert.equal(fullDiscount.statusCode,400);
      const malformedUuid=await fastify.inject({headers:{cookie},method:"GET",url:"/api/v1/students/not-a-uuid"}); assert.equal(malformedUuid.statusCode,400);
      const [firstGeneration, repeatedGeneration] = await Promise.all([
        fastify.inject({ headers:{cookie}, method:"POST", url:"/api/v1/charges/generate", payload:{referenceMonth:"2026-02"} }),
        fastify.inject({ headers:{cookie}, method:"POST", url:"/api/v1/charges/generate", payload:{referenceMonth:"2026-02"} }),
      ]);
      assert.equal(firstGeneration.statusCode,201); assert.equal(repeatedGeneration.statusCode,201);
      const charges = await getPrismaClient().charge.findMany({ where:{ enrollmentId: enrollment.json().id, referenceMonth:new Date("2026-02-01T00:00:00.000Z") } });
      assert.equal(charges.length,1); assert.equal(charges[0]?.amountCents,15000); assert.equal(charges[0]?.finalAmountCents,15000); assert.equal(charges[0]?.dueDate.toISOString().slice(0,10),"2026-02-10");
      const chargeId = charges[0]!.id;
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/charges/${chargeId}/cancel`})).statusCode,200);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/charges/${chargeId}/waive`})).statusCode,409);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/charges/${chargeId}/reopen`})).statusCode,200);
      const chargeList=await fastify.inject({headers:{cookie},method:"GET",url:"/api/v1/charges?referenceMonth=2026-02&status=PENDING"}); assert.equal(chargeList.statusCode,200); assert.equal(chargeList.json().meta.total,1); assert.equal(chargeList.json().data[0].enrollment.plan.name,"Mensal");
      const paymentPayload={amountCents:15000,method:"PIX",paidAt:"2026-02-10T12:00:00.000Z",externalReference:"manual-test"};
      const paymentHeaders={cookie,"idempotency-key":"manual:2026-02:test"};
      const createdPayment=await fastify.inject({headers:paymentHeaders,method:"POST",url:`/api/v1/charges/${chargeId}/payments`,payload:paymentPayload}); assert.equal(createdPayment.statusCode,201); assert.equal(createdPayment.json().data.status,"PENDING_RECONCILIATION"); assert.equal(createdPayment.json().meta.idempotentReplay,false);
      const replayedPayment=await fastify.inject({headers:paymentHeaders,method:"POST",url:`/api/v1/charges/${chargeId}/payments`,payload:paymentPayload}); assert.equal(replayedPayment.statusCode,201); assert.equal(replayedPayment.json().data.id,createdPayment.json().data.id); assert.equal(replayedPayment.json().meta.idempotentReplay,true);
      const reusedKey=await fastify.inject({headers:paymentHeaders,method:"POST",url:`/api/v1/charges/${chargeId}/payments`,payload:{...paymentPayload,notes:"different"}}); assert.equal(reusedKey.statusCode,409); assert.equal(reusedKey.json().error.code,"IDEMPOTENCY_KEY_REUSED");
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/charges/${chargeId}/cancel`})).statusCode,409);
      const paymentId=createdPayment.json().data.id;
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/payments/${paymentId}/confirm`})).statusCode,200);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/payments/${paymentId}/confirm`})).statusCode,409);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/payments/${paymentId}/reverse`})).statusCode,200);
      const reopened=await fastify.inject({headers:{cookie},method:"GET",url:`/api/v1/charges/${chargeId}`}); assert.equal(reopened.statusCode,200); assert.equal(reopened.json().data.status,"PENDING");

      await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/charges/generate",payload:{referenceMonth:"2026-03"}});
      const marchCharge=await getPrismaClient().charge.findFirstOrThrow({where:{organizationId,referenceMonth:new Date("2026-03-01T00:00:00.000Z")}});
      const concurrentPayments=await Promise.all([
        fastify.inject({headers:{cookie,"idempotency-key":"manual:concurrent:a"},method:"POST",url:`/api/v1/charges/${marchCharge.id}/payments`,payload:{amountCents:15000,method:"CASH",paidAt:"2026-03-10T12:00:00.000Z"}}),
        fastify.inject({headers:{cookie,"idempotency-key":"manual:concurrent:b"},method:"POST",url:`/api/v1/charges/${marchCharge.id}/payments`,payload:{amountCents:15000,method:"CASH",paidAt:"2026-03-10T12:00:00.000Z"}}),
      ]);
      assert.deepEqual(concurrentPayments.map((response)=>response.statusCode).sort(),[201,409]);
      const successfulConcurrentPayment=concurrentPayments.find((response)=>response.statusCode===201); assert.ok(successfulConcurrentPayment);
      const concurrentPaymentId=successfulConcurrentPayment.json().data.id as string;
      assert.equal(await getPrismaClient().payment.count({where:{chargeId:marchCharge.id,status:{in:["PENDING_RECONCILIATION","CONFIRMED"]}}}),1);
      const confirmations=await Promise.all([fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/payments/${concurrentPaymentId}/confirm`}),fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/payments/${concurrentPaymentId}/confirm`})]);
      assert.deepEqual(confirmations.map((response)=>response.statusCode).sort(),[200,409]);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/payments/${concurrentPaymentId}/reverse`})).statusCode,200);

      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/charges/${chargeId}/payments`,payload:paymentPayload})).statusCode,400);

      assert.equal((await fastify.inject({method:"POST",url:"/api/v1/auth/register",payload:{name:"Financial Scope B",email:otherEmail,password}})).statusCode,201);
      await getPrismaClient().user.update({where:{email:otherEmail},data:{emailVerified:true,status:"ACTIVE"}});
      const otherLogin=await fastify.inject({method:"POST",url:"/api/v1/auth/login",payload:{email:otherEmail,password}});
      const otherCookie=firstHeader(otherLogin.headers["set-cookie"])?.split(";")[0]; assert.ok(otherCookie);
      const otherOrganization=await fastify.inject({headers:{cookie:otherCookie},method:"POST",url:"/api/v1/organization",payload:{name:"Financial Scope B",taxId:`55${Date.now().toString().slice(-9)}`,phone:"11999999998"}}); assert.equal(otherOrganization.statusCode,201);
       const otherOrganizationId=otherOrganization.json().data.id as string;
       await getPrismaClient().mercadoPagoConnection.create({data:{organizationId:otherOrganizationId,mercadoPagoUserId:`operational-other-${randomUUID()}`,publicKey:"TEST-public-key",encryptedAccessToken:{version:1},encryptedRefreshToken:{version:1},status:"CONNECTED",liveMode:false,scopes:"payments write",tokenExpiresAt:new Date("2100-01-01T00:00:00.000Z")}});
       const otherRules=await fastify.inject({headers:{cookie:otherCookie},method:"GET",url:"/api/v1/billing-rules"}); assert.equal(otherRules.statusCode,200); assert.equal(otherRules.json().data.length,0);
      const crossTenantRule=await fastify.inject({headers:{cookie:otherCookie,"idempotency-key":"billing-rule:cross-tenant"},method:"POST",url:"/api/v1/billing-rules",payload:billingRulePayload}); assert.equal(crossTenantRule.statusCode,404); assert.equal(crossTenantRule.json().error.code,"BILLING_SOURCE_NOT_FOUND");
      await assert.rejects(
        getPrismaClient().studentGuardian.create({data:{organizationId:otherOrganizationId,studentId:student.json().id,guardianId:guardian.json().id}}),
        (error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="P2003",
      );
      await assert.rejects(
        getPrismaClient().enrollment.create({data:{organizationId:otherOrganizationId,studentId:student.json().id,guardianId:guardian.json().id,planId:plan.json().id,amountCents:15000,dueDay:10,startDate:new Date("2026-01-01"),planNameSnapshot:"Cross tenant"}}),
        (error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="P2003",
      );
      assert.equal((await fastify.inject({headers:{cookie:otherCookie},method:"GET",url:`/api/v1/charges/${chargeId}`})).statusCode,404);
      assert.equal((await fastify.inject({headers:{cookie:otherCookie},method:"POST",url:`/api/v1/charges/${chargeId}/cancel`})).statusCode,404);
      assert.equal((await fastify.inject({headers:{cookie:otherCookie,"idempotency-key":"cross-tenant-payment"},method:"POST",url:`/api/v1/charges/${chargeId}/payments`,payload:paymentPayload})).statusCode,404);
      assert.equal((await fastify.inject({headers:{cookie:otherCookie},method:"POST",url:`/api/v1/payments/${paymentId}/confirm`})).statusCode,404);

      await assert.rejects(
        getPrismaClient().charge.create({data:{organizationId:otherOrganizationId,enrollmentId:enrollment.json().id,referenceMonth:new Date("2026-04-01T00:00:00.000Z"),dueDate:new Date("2026-04-10T00:00:00.000Z"),amountCents:15000,finalAmountCents:15000}}),
        (error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="P2003",
      );

      await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/charges/generate",payload:{referenceMonth:"2026-04"}});
      const aprilCharge=await getPrismaClient().charge.findFirstOrThrow({where:{organizationId,referenceMonth:new Date("2026-04-01T00:00:00.000Z")}});
      await assert.rejects(
        getPrismaClient().payment.create({data:{organizationId:otherOrganizationId,chargeId:aprilCharge.id,idempotencyKey:"cross-db-payment",amountCents:15000,method:"PIX",paidAt:new Date("2026-04-10T12:00:00.000Z")}}),
        (error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="P2003",
      );

      await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/charges/generate",payload:{referenceMonth:"2026-05"}});
      const mayCharge=await getPrismaClient().charge.findFirstOrThrow({where:{organizationId,referenceMonth:new Date("2026-05-01T00:00:00.000Z")}});
      const rollbackPayment=await fastify.inject({headers:{cookie,"idempotency-key":"manual:rollback:test"},method:"POST",url:`/api/v1/charges/${mayCharge.id}/payments`,payload:{amountCents:15000,method:"PIX",paidAt:"2026-05-10T12:00:00.000Z"}}); assert.equal(rollbackPayment.statusCode,201);
      const rollbackPaymentId=rollbackPayment.json().data.id as string;
      const financial=app.get(FinancialService);
      await assert.rejects(financial.changePaymentStatus({userId:randomUUID(),email:"missing@example.test",role:"COMPANY_ACCOUNT",organizationId},rollbackPaymentId,"CONFIRMED"));
      assert.equal((await getPrismaClient().payment.findUniqueOrThrow({where:{id:rollbackPaymentId}})).status,"PENDING_RECONCILIATION");
      assert.equal((await getPrismaClient().charge.findUniqueOrThrow({where:{id:mayCharge.id}})).status,"PENDING");
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/payments/${rollbackPaymentId}/cancel`})).statusCode,200);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/payments/${rollbackPaymentId}/confirm`})).statusCode,409);
      const replacementPayment=await fastify.inject({headers:{cookie,"idempotency-key":"manual:rollback:replacement"},method:"POST",url:`/api/v1/charges/${mayCharge.id}/payments`,payload:{amountCents:15000,method:"PIX",paidAt:"2026-05-11T12:00:00.000Z"}}); assert.equal(replacementPayment.statusCode,201);

      const amountMismatch=await fastify.inject({headers:{cookie,"idempotency-key":"manual:amount:mismatch"},method:"POST",url:`/api/v1/charges/${aprilCharge.id}/payments`,payload:{amountCents:14999,method:"PIX",paidAt:"2026-04-10T12:00:00.000Z"}}); assert.equal(amountMismatch.statusCode,400); assert.equal(amountMismatch.json().error.code,"PAYMENT_AMOUNT_MISMATCH");
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/charges/${aprilCharge.id}/waive`})).statusCode,200);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/charges/${aprilCharge.id}/reopen`})).statusCode,200);

      const financialAudit=await getPrismaClient().auditLog.findMany({where:{organizationId,action:{in:["charge.generation_requested","charge.cancelled","charge.waived","charge.pending","payment.created","payment.confirmed","payment.cancelled","payment.reversed"]}}});
      assert.equal(financialAudit.length>0,true);
      assert.equal(financialAudit.every((entry)=>entry.correlationId!==null),true);

      const invalidMonth = await fastify.inject({ headers:{cookie}, method:"POST", url:"/api/v1/charges/generate", payload:{referenceMonth:"2026-13"} });
      assert.equal(invalidMonth.statusCode,400);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/charges/generate",payload:{referenceMonth:"0001-01"}})).statusCode,400);
      assert.equal((await fastify.inject({headers:{cookie},method:"GET",url:"/api/v1/charges/not-a-uuid"})).statusCode,400);
      assert.equal((await fastify.inject({headers:{cookie,"idempotency-key":"manual:overflow:test"},method:"POST",url:`/api/v1/charges/${aprilCharge.id}/payments`,payload:{amountCents:3000000000,method:"PIX",paidAt:"2026-04-10T12:00:00.000Z"}})).statusCode,400);
      const listed=await fastify.inject({headers:{cookie},method:"GET",url:"/api/v1/students?search=Ana&page=1&pageSize=10"}); assert.equal(listed.statusCode,200); assert.equal(listed.json().total,1);
      assert.equal((await fastify.inject({headers:{cookie},method:"GET",url:"/api/v1/plans?search=Mensal"})).json().total,1);
      assert.equal((await fastify.inject({headers:{cookie},method:"GET",url:"/api/v1/guardians?search=Maria"})).json().total,1);
      assert.equal((await fastify.inject({headers:{cookie},method:"GET",url:"/api/v1/enrollments?search=Ana"})).json().total,1);
      assert.equal((await fastify.inject({headers:{cookie},method:"PATCH",url:`/api/v1/enrollments/${enrollment.json().id}`,payload:{status:"ENDED",endDate:"2026-12-31"}})).statusCode,200);

      const guardianCountBeforeRollback = await getPrismaClient().guardian.count({where:{organizationId}});
      const atomicConflict = await fastify.inject({
        headers:{cookie},
        method:"POST",
        url:"/api/v1/enrollments/manual",
        payload:{
          student:{name:"Duplicate Ana",cpf:"11111111111"},
          guardian:{name:"Must Roll Back",phone:"11977776666",taxId:"12345678909"},
          relationship:"Responsavel",
          planId:plan.json().id,
          startDate:"2026-06-01",
        },
      });
      assert.equal(atomicConflict.statusCode,409);
      assert.equal(atomicConflict.json().error.code,"MANUAL_ENROLLMENT_CONFLICT");
      assert.equal(await getPrismaClient().guardian.count({where:{organizationId}}),guardianCountBeforeRollback);

      const resumedEnrollment=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/enrollments",payload:{studentId:student.json().id,guardianId:guardian.json().id,planId:plan.json().id,startDate:"2027-01-01"}}); assert.equal(resumedEnrollment.statusCode,201);
      assert.equal((await fastify.inject({headers:{cookie},method:"PATCH",url:`/api/v1/students/${student.json().id}`,payload:{status:"INACTIVE"}})).statusCode,200);
      assert.equal((await getPrismaClient().enrollment.findUniqueOrThrow({where:{id:resumedEnrollment.json().id}})).status,"CANCELLED");
      await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/charges/generate",payload:{referenceMonth:"2027-02"}});
      assert.equal(await getPrismaClient().charge.count({where:{enrollmentId:resumedEnrollment.json().id,referenceMonth:new Date("2027-02-01T00:00:00.000Z")}}),0);

      const planStudent=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/students",payload:{name:"Plan Lifecycle",rg:"RG998877"}}); assert.equal(planStudent.statusCode,201);
      const planGuardian=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/guardians",payload:{name:"Plan Guardian",phone:"11966665555",taxId:"98765432100"}}); assert.equal(planGuardian.statusCode,201);
      assert.equal((await fastify.inject({headers:{cookie},method:"POST",url:`/api/v1/students/${planStudent.json().id}/guardians/${planGuardian.json().id}`,payload:{relationship:"Responsavel"}})).statusCode,201);
      const planEnrollment=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/enrollments",payload:{studentId:planStudent.json().id,guardianId:planGuardian.json().id,planId:plan.json().id,startDate:"2027-01-01"}}); assert.equal(planEnrollment.statusCode,201);
      assert.equal((await fastify.inject({headers:{cookie},method:"PATCH",url:`/api/v1/plans/${plan.json().id}`,payload:{status:"INACTIVE"}})).statusCode,200);
      assert.equal((await getPrismaClient().enrollment.findUniqueOrThrow({where:{id:planEnrollment.json().id}})).status,"CANCELLED");
      await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/charges/generate",payload:{referenceMonth:"2027-03"}});
      assert.equal(await getPrismaClient().charge.count({where:{enrollmentId:planEnrollment.json().id,referenceMonth:new Date("2027-03-01T00:00:00.000Z")}}),0);
      const removableStudent=await fastify.inject({headers:{cookie},method:"POST",url:"/api/v1/students",payload:{name:"Removable Student",rg:"RG556677"}}); assert.equal(removableStudent.statusCode,201);
      assert.equal((await fastify.inject({headers:{cookie},method:"DELETE",url:`/api/v1/students/${removableStudent.json().id}`})).statusCode,200);
      assert.equal((await getPrismaClient().student.findUniqueOrThrow({where:{id:removableStudent.json().id}})).status,"INACTIVE");
      const financialStudentRemoval=await fastify.inject({headers:{cookie},method:"DELETE",url:`/api/v1/students/${student.json().id}`});
      assert.equal(financialStudentRemoval.statusCode,200);
      assert.equal((await getPrismaClient().student.findUniqueOrThrow({where:{id:student.json().id}})).status,"INACTIVE");
      assert.equal(await getPrismaClient().charge.count({where:{organizationId,enrollment:{studentId:student.json().id},status:"PENDING"}}),0);
      const operationalAudit=await getPrismaClient().auditLog.findMany({where:{organizationId,action:{in:["plan.created","student.created","student.removed","guardian.created","student_guardian.linked","enrollment.created","enrollment.updated","charge.cancelled_for_student_removal"]}}});
      assert.equal(operationalAudit.length>=7,true);
      assert.equal(operationalAudit.every((entry)=>entry.correlationId!==null),true);
    } finally { await app.close(); }
  });

  it("configures reminder rules without crossing organization boundaries", async () => {
    const app = await createApiApplication(testEnvironment());
    const emailA = `reminders-a-${randomUUID()}@api.example.test`;
    const emailB = `reminders-b-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    registrationTestEmails.add(emailA);
    registrationTestEmails.add(emailB);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const createAccount = async (
        email: string,
        name: string,
        taxId: string,
        timezone: string,
      ) => {
        assert.equal(
          (
            await fastify.inject({
              method: "POST",
              url: "/api/v1/auth/register",
              payload: { name, email, password },
            })
          ).statusCode,
          201,
        );
        await getPrismaClient().user.update({
          where: { email },
          data: { emailVerified: true, status: "ACTIVE" },
        });
        const login = await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password },
        });
        const cookie = firstHeader(login.headers["set-cookie"])?.split(";")[0];
        assert.ok(cookie);
        const organization = await fastify.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/v1/organization",
          payload: { name, taxId, phone: "11999999999", timezone },
        });
        assert.equal(organization.statusCode, 201);
        const organizationId = organization.json().data.id as string;
        await getPrismaClient().mercadoPagoConnection.create({data:{organizationId,mercadoPagoUserId:`messaging-${randomUUID()}`,publicKey:"TEST-public-key",encryptedAccessToken:{version:1},encryptedRefreshToken:{version:1},status:"CONNECTED",liveMode:false,scopes:"payments write",tokenExpiresAt:new Date("2100-01-01T00:00:00.000Z")}});
        return {
          cookie,
          organizationId,
        };
      };

      const accountA = await createAccount(
        emailA,
        "Reminder School A",
        "66666666666",
        "America/Recife",
      );
      const accountB = await createAccount(
        emailB,
        "Reminder School B",
        "77777777777",
        "America/Sao_Paulo",
      );
      const [reminderTemplateA, reminderTemplateB] = await Promise.all([
        getPrismaClient().messageTemplate.create({
          data: {
            organizationId: accountA.organizationId,
            name: "Lembrete automático A",
            body: "Sua mensalidade está próxima do vencimento.",
          },
        }),
        getPrismaClient().messageTemplate.create({
          data: {
            organizationId: accountB.organizationId,
            name: "Lembrete automático B",
            body: "Sua mensalidade está próxima do vencimento.",
          },
        }),
      ]);

      assert.equal(
        (
          await fastify.inject({
            method: "GET",
            url: "/api/v1/reminder-configuration",
          })
        ).statusCode,
        401,
      );
      const missing = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/reminder-configuration",
      });
      assert.equal(missing.statusCode, 404);
      assert.equal(
        missing.json().error.code,
        "REMINDER_CONFIGURATION_NOT_FOUND",
      );

      const validPayload = {
        enabled: true,
        allowedHours: { start: "08:30", end: "18:00" },
        dailyLimit: 50,
        rules: [
          {
            timing: "BEFORE_DUE",
            dayOffset: 3,
            templateId: reminderTemplateA.id,
            enabled: true,
          },
          {
            timing: "ON_DUE",
            dayOffset: 0,
            templateId: reminderTemplateA.id,
            enabled: true,
          },
          { timing: "AFTER_DUE", dayOffset: 2, enabled: false },
        ],
      };
      const validPayloadB = {
        ...validPayload,
        rules: validPayload.rules.map((rule) => ({
          ...rule,
          ...(rule.enabled ? { templateId: reminderTemplateB.id } : {}),
        })),
      };
      const invalidPayloads = [
        {
          ...validPayload,
          allowedHours: { start: "18:00", end: "08:00" },
        },
        {
          ...validPayload,
          rules: [
            { timing: "BEFORE_DUE", dayOffset: 3, enabled: true },
            { timing: "BEFORE_DUE", dayOffset: 3, enabled: false },
          ],
        },
        {
          ...validPayload,
          rules: [{ timing: "ON_DUE", dayOffset: 1, enabled: true }],
        },
        {
          ...validPayload,
          rules: [{ timing: "ON_DUE", dayOffset: 0, enabled: false }],
        },
      ];
      for (const payload of invalidPayloads) {
        const invalid = await fastify.inject({
          headers: { cookie: accountA.cookie },
          method: "PUT",
          url: "/api/v1/reminder-configuration",
          payload,
        });
        assert.equal(invalid.statusCode, 400);
        assert.equal(invalid.json().error.code, "VALIDATION_ERROR");
      }

      const created = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "PUT",
        url: "/api/v1/reminder-configuration",
        payload: validPayload,
      });
      assert.equal(created.statusCode, 200);
      assert.equal(created.json().data.enabled, true);
      assert.equal(created.json().data.timezone, "America/Recife");
      assert.deepEqual(created.json().data.allowedHours, {
        start: "08:30",
        end: "18:00",
      });
      assert.equal(created.json().data.dailyLimit, 50);
      assert.equal(created.json().data.rules.length, 3);
      assert.equal(
        created.json().data.rules[0]?.templateId,
        reminderTemplateA.id,
      );
      assert.equal("organizationId" in created.json().data, false);

      const injectedOrganization = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "PUT",
        url: "/api/v1/reminder-configuration",
        payload: { ...validPayload, organizationId: accountB.organizationId },
      });
      assert.equal(injectedOrganization.statusCode, 400);
      const crossTenantTemplate = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "PUT",
        url: "/api/v1/reminder-configuration",
        payload: {
          ...validPayload,
          rules: validPayload.rules.map((rule) => ({
            ...rule,
            ...(rule.enabled ? { templateId: reminderTemplateB.id } : {}),
          })),
        },
      });
      assert.equal(crossTenantTemplate.statusCode, 404);
      assert.equal(
        crossTenantTemplate.json().error.code,
        "MESSAGE_TEMPLATE_NOT_FOUND",
      );

      const disabled = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "PUT",
        url: "/api/v1/reminder-configuration",
        payload: {
          enabled: false,
          allowedHours: { start: "09:00", end: "17:30" },
          dailyLimit: 25,
          rules: [
            { timing: "BEFORE_DUE", dayOffset: 5, enabled: false },
          ],
        },
      });
      assert.equal(disabled.statusCode, 200);
      assert.equal(disabled.json().data.enabled, false);
      assert.equal(disabled.json().data.rules.length, 1);

      const accountBRead = await fastify.inject({
        headers: { cookie: accountB.cookie },
        method: "GET",
        url: "/api/v1/reminder-configuration",
      });
      assert.equal(accountBRead.statusCode, 404);
      const accountBConfiguration = await fastify.inject({
        headers: { cookie: accountB.cookie },
        method: "PUT",
        url: "/api/v1/reminder-configuration",
        payload: validPayloadB,
      });
      assert.equal(accountBConfiguration.statusCode, 200);
      assert.equal(
        accountBConfiguration.json().data.timezone,
        "America/Sao_Paulo",
      );

      const configurationA =
        await getPrismaClient().reminderConfiguration.findUniqueOrThrow({
          where: { organizationId: accountA.organizationId },
        });
      await assert.rejects(
        getPrismaClient().reminderRule.create({
          data: {
            organizationId: accountB.organizationId,
            configurationId: configurationA.id,
            timing: "AFTER_DUE",
            dayOffset: 59,
          },
        }),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2003",
      );

      const timezoneUpdate = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "PATCH",
        url: "/api/v1/organization",
        payload: { timezone: "America/Manaus" },
      });
      assert.equal(timezoneUpdate.statusCode, 200);
      const refreshed = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: "/api/v1/reminder-configuration",
      });
      assert.equal(refreshed.statusCode, 200);
      assert.equal(refreshed.json().data.timezone, "America/Manaus");
      assert.equal(refreshed.json().data.enabled, false);

      const audit = await getPrismaClient().auditLog.findMany({
        where: {
          organizationId: accountA.organizationId,
          action: {
            in: [
              "reminder_configuration.created",
              "reminder_configuration.updated",
            ],
          },
        },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(
        audit.map((entry) => entry.action),
        [
          "reminder_configuration.created",
          "reminder_configuration.updated",
        ],
      );
      assert.equal(audit.every((entry) => entry.correlationId !== null), true);
      assert.equal(audit[1]?.before !== null, true);
      assert.equal(audit[1]?.after !== null, true);
    } finally {
      await app.close();
    }
  });

  it("persists idempotent message schedules and cancels them after payment", async () => {
    const app = await createApiApplication(testEnvironment());
    const emailA = `messaging-a-${randomUUID()}@api.example.test`;
    const emailB = `messaging-b-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    registrationTestEmails.add(emailA);
    registrationTestEmails.add(emailB);

    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const createAccount = async (
        email: string,
        name: string,
        taxId: string,
      ) => {
        const registration = await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { name, email, password },
        });
        assert.equal(registration.statusCode, 201);
        await getPrismaClient().user.update({
          where: { email },
          data: { emailVerified: true, status: "ACTIVE" },
        });
        const login = await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password },
        });
        const cookie = firstHeader(login.headers["set-cookie"])?.split(";")[0];
        assert.ok(cookie);
        const organization = await fastify.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/v1/organization",
          payload: { name, taxId, phone: "11999999999" },
        });
        assert.equal(organization.statusCode, 201);
        const organizationId = organization.json().data.id as string;
        await getPrismaClient().mercadoPagoConnection.create({data:{organizationId,mercadoPagoUserId:`message-schedule-${randomUUID()}`,publicKey:"TEST-public-key",encryptedAccessToken:{version:1},encryptedRefreshToken:{version:1},status:"CONNECTED",liveMode:false,scopes:"payments write",tokenExpiresAt:new Date("2100-01-01T00:00:00.000Z")}});
        return {
          cookie,
          organizationId,
        };
      };

      const accountA = await createAccount(
        emailA,
        "Messaging School A",
        "88888888888",
      );
      const accountB = await createAccount(
        emailB,
        "Messaging School B",
        "99999999999",
      );

      assert.equal(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/v1/message-templates",
            payload: { name: "Cobrança mensal", body: "Olá" },
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountA.cookie },
            method: "POST",
            url: "/api/v1/message-templates",
            payload: {
              name: "Cobrança mensal",
              body: "Olá {{responsavel}}, há uma mensalidade pendente.",
              organizationId: accountB.organizationId,
            },
          })
        ).statusCode,
        400,
      );

      const templateA = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/message-templates",
        payload: {
          name: "Cobrança mensal",
          body: "Olá {{responsavel}}, há uma mensalidade pendente.",
        },
      });
      assert.equal(templateA.statusCode, 201);
      assert.equal(templateA.json().data.active, true);
      const templateAId = templateA.json().data.id as string;

      const duplicateTemplate = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/message-templates",
        payload: {
          name: "cobrança mensal",
          body: "Outro conteúdo",
        },
      });
      assert.equal(duplicateTemplate.statusCode, 409);
      assert.equal(
        duplicateTemplate.json().error.code,
        "MESSAGE_TEMPLATE_NAME_CONFLICT",
      );

      const templateB = await fastify.inject({
        headers: { cookie: accountB.cookie },
        method: "POST",
        url: "/api/v1/message-templates",
        payload: { name: "Cobrança mensal", body: "Template B" },
      });
      assert.equal(templateB.statusCode, 201);
      const templateBId = templateB.json().data.id as string;
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountB.cookie },
            method: "GET",
            url: `/api/v1/message-templates/${templateAId}`,
          })
        ).statusCode,
        404,
      );

      const plan = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/plans",
        payload: { name: "Mensal", amountCents: 15000, dueDay: 10 },
      });
      const student = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/students",
        payload: { name: "Aluno Mensagens", cpf: "52998224725" },
      });
      const guardian = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/guardians",
        payload: {
          name: "Responsável Mensagens",
          phone: "11988887777",
          taxId: "11144477735",
        },
      });
      assert.equal(plan.statusCode, 201);
      assert.equal(student.statusCode, 201);
      assert.equal(guardian.statusCode, 201);
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountA.cookie },
            method: "POST",
            url: `/api/v1/students/${student.json().id}/guardians/${guardian.json().id}`,
            payload: { relationship: "Responsável financeiro" },
          })
        ).statusCode,
        201,
      );
      const enrollment = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/enrollments",
        payload: {
          studentId: student.json().id,
          guardianId: guardian.json().id,
          planId: plan.json().id,
          startDate: "2026-01-01",
        },
      });
      assert.equal(enrollment.statusCode, 201);
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountA.cookie },
            method: "POST",
            url: "/api/v1/charges/generate",
            payload: { referenceMonth: "2030-01" },
          })
        ).statusCode,
        201,
      );
      const charge = await getPrismaClient().charge.findFirstOrThrow({
        where: {
          organizationId: accountA.organizationId,
          enrollmentId: enrollment.json().id,
          referenceMonth: new Date("2030-01-01T00:00:00.000Z"),
        },
      });

      const invalidPastSchedule = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/message-schedules",
        payload: {
          chargeId: charge.id,
          templateId: templateAId,
          scheduledFor: "2020-01-05T12:00:00.000Z",
        },
      });
      assert.equal(invalidPastSchedule.statusCode, 400);

      const crossTenantSchedule = await fastify.inject({
        headers: { cookie: accountB.cookie },
        method: "POST",
        url: "/api/v1/message-schedules",
        payload: {
          chargeId: charge.id,
          templateId: templateBId,
          scheduledFor: "2030-01-05T12:00:00.000Z",
        },
      });
      assert.equal(crossTenantSchedule.statusCode, 404);

      const schedulePayload = {
        chargeId: charge.id,
        templateId: templateAId,
        scheduledFor: "2030-01-05T12:00:00.000Z",
      };
      const concurrentSchedules = await Promise.all([
        fastify.inject({
          headers: { cookie: accountA.cookie },
          method: "POST",
          url: "/api/v1/message-schedules",
          payload: schedulePayload,
        }),
        fastify.inject({
          headers: { cookie: accountA.cookie },
          method: "POST",
          url: "/api/v1/message-schedules",
          payload: schedulePayload,
        }),
      ]);
      assert.deepEqual(
        concurrentSchedules.map((response) => response.statusCode),
        [201, 201],
      );
      assert.deepEqual(
        concurrentSchedules
          .map((response) => response.json().meta.idempotentReplay)
          .sort(),
        [false, true],
      );
      const scheduleId = concurrentSchedules[0]?.json().data.id as string;
      assert.equal(
        concurrentSchedules[1]?.json().data.id,
        scheduleId,
      );
      assert.equal(
        await getPrismaClient().messageSchedule.count({
          where: {
            organizationId: accountA.organizationId,
            chargeId: charge.id,
          },
        }),
        1,
      );

      const updatedTemplate = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "PATCH",
        url: `/api/v1/message-templates/${templateAId}`,
        payload: { body: "Conteúdo atualizado para agendamentos futuros." },
      });
      assert.equal(updatedTemplate.statusCode, 200);
      const persistedSchedule = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: `/api/v1/message-schedules/${scheduleId}`,
      });
      assert.equal(persistedSchedule.statusCode, 200);
      assert.equal(
        persistedSchedule.json().data.bodySnapshot,
        "Olá {{responsavel}}, há uma mensalidade pendente.",
      );
      assert.deepEqual(persistedSchedule.json().data.recipient, {
        name: "Responsável Mensagens",
        phone: "11988887777",
      });
      assert.deepEqual(persistedSchedule.json().data.delivery, {
        providerMessageId: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
      });
      assert.deepEqual(persistedSchedule.json().data.attempts, {
        count: 0,
        lastAt: null,
        lastError: null,
      });

      const createdHistory = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: `/api/v1/message-schedules/${scheduleId}/history`,
      });
      assert.equal(createdHistory.statusCode, 200);
      assert.deepEqual(
        createdHistory.json().data.map(
          (entry: { toStatus: string }) => entry.toStatus,
        ),
        ["SCHEDULED"],
      );
      const createdAttempts = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: `/api/v1/message-schedules/${scheduleId}/attempts`,
      });
      assert.equal(createdAttempts.statusCode, 200);
      assert.deepEqual(createdAttempts.json().data, []);
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountB.cookie },
            method: "GET",
            url: `/api/v1/message-schedules/${scheduleId}/attempts`,
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await fastify.inject({
            headers: { cookie: accountB.cookie },
            method: "GET",
            url: `/api/v1/message-schedules/${scheduleId}`,
          })
        ).statusCode,
        404,
      );

      const manualSchedule = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/message-schedules",
        payload: {
          ...schedulePayload,
          scheduledFor: "2030-01-06T12:00:00.000Z",
        },
      });
      assert.equal(manualSchedule.statusCode, 201);
      const manualScheduleId = manualSchedule.json().data.id as string;
      const manualCancellation = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: `/api/v1/message-schedules/${manualScheduleId}/cancel`,
      });
      assert.equal(manualCancellation.statusCode, 200);
      assert.equal(manualCancellation.json().data.status, "CANCELLED");
      assert.equal(
        manualCancellation.json().data.cancellation.reason,
        "MANUAL_CANCELLATION",
      );

      const payment = await fastify.inject({
        headers: {
          cookie: accountA.cookie,
          "idempotency-key": "messaging:payment:2030-01",
        },
        method: "POST",
        url: `/api/v1/charges/${charge.id}/payments`,
        payload: {
          amountCents: 15000,
          method: "PIX",
          paidAt: "2030-01-10T12:00:00.000Z",
        },
      });
      assert.equal(payment.statusCode, 201);
      const confirmation = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: `/api/v1/payments/${payment.json().data.id}/confirm`,
      });
      assert.equal(confirmation.statusCode, 200);

      const cancelledAfterPayment = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: `/api/v1/message-schedules/${scheduleId}`,
      });
      assert.equal(cancelledAfterPayment.statusCode, 200);
      assert.equal(cancelledAfterPayment.json().data.status, "CANCELLED");
      assert.equal(
        cancelledAfterPayment.json().data.cancellation.reason,
        "CHARGE_PAID",
      );
      const paidHistory = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: `/api/v1/message-schedules/${scheduleId}/history`,
      });
      assert.deepEqual(
        paidHistory.json().data.map(
          (entry: { toStatus: string }) => entry.toStatus,
        ),
        ["SCHEDULED", "CANCELLED"],
      );
      assert.equal(
        paidHistory.json().data[1]?.metadata.paymentId,
        payment.json().data.id,
      );

      const schedulePaidCharge = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/message-schedules",
        payload: {
          ...schedulePayload,
          scheduledFor: "2030-01-07T12:00:00.000Z",
        },
      });
      assert.equal(schedulePaidCharge.statusCode, 409);
      assert.equal(
        schedulePaidCharge.json().error.code,
        "CHARGE_STATE_CONFLICT",
      );

      const raceChargeGeneration = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/charges/generate",
        payload: { referenceMonth: "2030-02" },
      });
      assert.equal(raceChargeGeneration.statusCode, 201);
      const raceCharge = await getPrismaClient().charge.findFirstOrThrow({
        where: {
          organizationId: accountA.organizationId,
          enrollmentId: enrollment.json().id,
          referenceMonth: new Date("2030-02-01T00:00:00.000Z"),
        },
      });
      const racePayment = await fastify.inject({
        headers: {
          cookie: accountA.cookie,
          "idempotency-key": "messaging:payment:2030-02",
        },
        method: "POST",
        url: `/api/v1/charges/${raceCharge.id}/payments`,
        payload: {
          amountCents: 15000,
          method: "PIX",
          paidAt: "2030-02-10T12:00:00.000Z",
        },
      });
      assert.equal(racePayment.statusCode, 201);

      const [racingSchedule, racingConfirmation] = await Promise.all([
        fastify.inject({
          headers: { cookie: accountA.cookie },
          method: "POST",
          url: "/api/v1/message-schedules",
          payload: {
            chargeId: raceCharge.id,
            templateId: templateAId,
            scheduledFor: "2030-02-05T12:00:00.000Z",
          },
        }),
        fastify.inject({
          headers: { cookie: accountA.cookie },
          method: "POST",
          url: `/api/v1/payments/${racePayment.json().data.id}/confirm`,
        }),
      ]);
      assert.equal(racingConfirmation.statusCode, 200);
      assert.equal([201, 409].includes(racingSchedule.statusCode), true);
      assert.equal(
        await getPrismaClient().messageSchedule.count({
          where: {
            organizationId: accountA.organizationId,
            chargeId: raceCharge.id,
            status: { in: ["SCHEDULED", "QUEUED"] },
          },
        }),
        0,
      );
      if (racingSchedule.statusCode === 201) {
        const racedSchedule = await fastify.inject({
          headers: { cookie: accountA.cookie },
          method: "GET",
          url: `/api/v1/message-schedules/${racingSchedule.json().data.id}`,
        });
        assert.equal(racedSchedule.statusCode, 200);
        assert.equal(racedSchedule.json().data.status, "CANCELLED");
        assert.equal(
          racedSchedule.json().data.cancellation.reason,
          "CHARGE_PAID",
        );
      } else {
        assert.equal(
          racingSchedule.json().error.code,
          "CHARGE_STATE_CONFLICT",
        );
      }

      const cancelledList = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "GET",
        url: `/api/v1/message-schedules?status=CANCELLED&chargeId=${charge.id}`,
      });
      assert.equal(cancelledList.statusCode, 200);
      assert.equal(cancelledList.json().meta.total, 2);

      await assert.rejects(
        getPrismaClient().messageSchedule.create({
          data: {
            organizationId: accountB.organizationId,
            chargeId: charge.id,
            templateId: templateBId,
            scheduledFor: new Date("2030-01-08T12:00:00.000Z"),
            deduplicationKey: "a".repeat(64),
            templateBodySnapshot: "Cross tenant",
            recipientNameSnapshot: "Cross tenant",
            recipientPhoneSnapshot: "11999999999",
          },
        }),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2003",
      );

      const messagingAudit = await getPrismaClient().auditLog.findMany({
        where: {
          organizationId: accountA.organizationId,
          action: {
            in: [
              "message_template.created",
              "message_template.updated",
              "message_schedule.created",
              "message_schedule.cancelled",
            ],
          },
        },
      });
      assert.equal(messagingAudit.length >= 4, true);
      assert.equal(
        messagingAudit.every((entry) => entry.correlationId !== null),
        true,
      );
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
  await prisma.messageScheduleHistory.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.messageSchedule.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.reminderRule.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.messageTemplate.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.payment.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.charge.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.billingRule.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.reminderConfiguration.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.enrollment.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.broadcastSend.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.broadcastMessage.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.studentFieldValue.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.guardianFieldValue.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.customField.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.product.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.event.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.plan.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.student.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.guardian.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.mercadoPagoConnection.deleteMany({ where: { organizationId: { in: organizations.map((organization) => organization.id) } } });
  await prisma.organization.deleteMany({
    where: { id: { in: organizations.map((organization) => organization.id) } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: users.map((user) => user.id) } },
  });
});
