import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";
import { getPrismaClient } from "@mensaly/database";

import { createApiApplication } from "../app";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const emails = new Set<string>();

if (!databaseUrl || !redisUrl || new URL(databaseUrl).pathname.slice(1) !== "mensaly_test") {
  throw new Error("Health tests require isolated test services.");
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
  return (Array.isArray(value) ? value[0] : value)?.split(";")[0];
}

describe("platform health", () => {
  it("is public only for liveness/readiness and protected for platform diagnostics", async () => {
    const app = await createApiApplication(environment());
    const email = `health-${randomUUID()}@api.example.test`;
    emails.add(email);
    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      assert.equal((await fastify.inject({ method: "GET", url: "/api/v1/health/live" })).statusCode, 200);
      assert.equal((await fastify.inject({ method: "GET", url: "/api/v1/health/platform" })).statusCode, 401);
      assert.equal(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/v1/auth/register",
            payload: { name: "Health Admin", email, password: "correct-horse-battery-staple" },
          })
        ).statusCode,
        201,
      );
      await getPrismaClient().user.update({
        where: { email },
        data: { role: "PLATFORM_ADMIN", emailVerified: true, status: "ACTIVE" },
      });
      const login = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: "correct-horse-battery-staple" },
      });
      const cookie = cookieHeader(login.headers["set-cookie"]);
      assert.ok(cookie);
      const response = await fastify.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/v1/health/platform",
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().dependencies.database, "ready");
      assert.equal(response.json().dependencies.redis, "ready");
      assert.equal(response.json().dependencies.storage, "ready");
    } finally {
      await app.close();
    }
  });
});

after(async () => {
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.verification.deleteMany({ where: { identifier: { in: [...emails] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});
