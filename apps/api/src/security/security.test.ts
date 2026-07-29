import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
} from "@mensaly/config";
import { getPrismaClient } from "@mensaly/database";

import { createApiApplication } from "../app";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const emails = new Set<string>();
const organizationIds = new Set<string>();

if (
  !databaseUrl ||
  !redisUrl ||
  new URL(databaseUrl).pathname.slice(1) !== "mensaly_test"
) {
  throw new Error("Security tests require isolated test services.");
}

function environment() {
  return parseEnvironment(apiEnvironmentSchema, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    CORS_ORIGINS: "https://allowed.example",
  });
}

function cookieHeader(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.split(";")[0];
}

describe("security hardening", () => {
  it("enforces tenant audit scope, strict input and bounded pagination", async () => {
    const app = await createApiApplication(environment());
    const password = "correct-horse-battery-staple";
    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const createAccount = async (label: string) => {
        const suffix = randomUUID();
        const email = `security-${label}-${suffix}@api.example.test`;
        emails.add(email);
        await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { name: `Security ${label}`, email, password },
        });
        const user = await getPrismaClient().user.update({
          where: { email },
          data: { emailVerified: true, status: "ACTIVE" },
        });
        const login = await fastify.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password },
        });
        const cookie = cookieHeader(login.headers["set-cookie"]);
        assert.ok(cookie);
        const created = await fastify.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/v1/organization",
          payload: {
            name: `Security ${label}`,
            taxId: randomUUID().replace(/\D/g, "").padEnd(11, "0").slice(0, 11),
            phone: "11999999999",
          },
        });
        assert.equal(created.statusCode, 201);
        organizationIds.add(created.json().data.id);
        return {
          cookie,
          userId: user.id,
          organizationId: created.json().data.id as string,
        };
      };
      const accountA = await createAccount("A");
      const accountB = await createAccount("B");

      const audit = await fastify.inject({
        headers: {
          cookie: accountA.cookie,
          "x-organization-id": accountB.organizationId,
        },
        method: "GET",
        url: "/api/v1/audit-logs?action=organization.created",
      });
      assert.equal(audit.statusCode, 200);
      assert.equal(audit.json().meta.total, 1);
      assert.equal(audit.json().data[0].action, "organization.created");

      for (const url of [
        "/api/v1/audit-logs?page=NaN",
        "/api/v1/plans?page=NaN",
        "/api/v1/files?pageSize=101",
        "/api/v1/charges?page=-1",
      ]) {
        const invalid = await fastify.inject({
          headers: { cookie: accountA.cookie },
          method: "GET",
          url,
        });
        assert.equal(invalid.statusCode, 400, url);
        assert.equal(invalid.json().error.code, "VALIDATION_ERROR");
      }

      const massAssignment = await fastify.inject({
        headers: { cookie: accountA.cookie },
        method: "POST",
        url: "/api/v1/plans",
        payload: {
          name: "Injected plan",
          amountCents: 10000,
          dueDay: 10,
          organizationId: accountB.organizationId,
          status: "INACTIVE",
        },
      });
      assert.equal(massAssignment.statusCode, 400);
      assert.equal(massAssignment.json().error.code, "VALIDATION_ERROR");
      assert.equal(
        await getPrismaClient().plan.count({
          where: {
            name: "Injected plan",
            organizationId: {
              in: [accountA.organizationId, accountB.organizationId],
            },
          },
        }),
        0,
      );

      await getPrismaClient().user.update({
        where: { id: accountB.userId },
        data: { role: "PLATFORM_ADMIN" },
      });
      const adminOnCompanyAudit = await fastify.inject({
        headers: { cookie: accountB.cookie },
        method: "GET",
        url: "/api/v1/audit-logs",
      });
      assert.equal(adminOnCompanyAudit.statusCode, 403);
      assert.equal(
        adminOnCompanyAudit.json().error.code,
        "COMPANY_ACCOUNT_REQUIRED",
      );

      const openApi = await fastify.inject({
        method: "GET",
        url: "/api/docs-json",
      });
      assert.ok(openApi.json().paths["/api/v1/audit-logs"]);
    } finally {
      await app.close();
    }
  });
});

after(async () => {
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({
    where: { email: { in: [...emails] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { organizationId: { in: [...organizationIds] } },
        { actorUserId: { in: userIds } },
      ],
    },
  });
  await prisma.plan.deleteMany({
    where: { organizationId: { in: [...organizationIds] } },
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.verification.deleteMany({
    where: { identifier: { in: [...emails] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [...organizationIds] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});
