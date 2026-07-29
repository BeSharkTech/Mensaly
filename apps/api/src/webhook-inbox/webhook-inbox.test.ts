import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  apiEnvironmentSchema,
  parseEnvironment,
} from "@mensaly/config";
import { getPrismaClient } from "@mensaly/database";

import { createApiApplication } from "../app";
import {
  WebhookInboxService,
  WebhookProcessingError,
} from "./webhook-inbox.service";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const emails = new Set<string>();
const eventIds = new Set<string>();

if (
  !databaseUrl ||
  !redisUrl ||
  new URL(databaseUrl).pathname.slice(1) !== "mensaly_test"
) {
  throw new Error("Webhook inbox tests require isolated test services.");
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

describe("generic webhook inbox", () => {
  it("is admin-only, idempotent, conflict-safe and documented", async () => {
    const app = await createApiApplication(environment());
    const email = `webhook-admin-${randomUUID()}@api.example.test`;
    const password = "correct-horse-battery-staple";
    emails.add(email);
    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      const unauthorized = await fastify.inject({
        method: "POST",
        url: "/api/v1/admin/webhook-events",
        payload: {
          provider: "internal",
          externalEventId: "event-unauthorized",
          eventType: "resource.updated",
          payload: {},
        },
      });
      assert.equal(unauthorized.statusCode, 401);

      assert.equal(
        (
          await fastify.inject({
            method: "POST",
            url: "/api/v1/auth/register",
            payload: { name: "Webhook Admin", email, password },
          })
        ).statusCode,
        201,
      );
      await getPrismaClient().user.update({
        where: { email },
        data: {
          emailVerified: true,
          role: "PLATFORM_ADMIN",
          status: "ACTIVE",
        },
      });
      const login = await fastify.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      const cookie = cookieHeader(login.headers["set-cookie"]);
      assert.equal(login.statusCode, 200);
      assert.ok(cookie);

      const body = {
        provider: "internal",
        externalEventId: `evt-${randomUUID()}`,
        eventType: "resource.updated",
        payload: { resourceId: "resource-1", version: 1 },
      };
      const [first, duplicate] = await Promise.all([
        fastify.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/v1/admin/webhook-events",
          payload: body,
        }),
        fastify.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/v1/admin/webhook-events",
          payload: body,
        }),
      ]);
      assert.equal(first.statusCode, 201);
      assert.equal(duplicate.statusCode, 201);
      const received = [first.json(), duplicate.json()];
      assert.deepEqual(
        received.map((response) => response.meta.duplicate).sort(),
        [false, true],
      );
      const eventId = received[0].data.id as string;
      eventIds.add(eventId);
      assert.equal(received[1].data.id, eventId);

      const conflict = await fastify.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/v1/admin/webhook-events",
        payload: { ...body, payload: { resourceId: "other" } },
      });
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.json().error.code, "WEBHOOK_EVENT_CONFLICT");

      let nestedPayload: Record<string, unknown> = {};
      for (let depth = 0; depth < 33; depth += 1) {
        nestedPayload = { nested: nestedPayload };
      }
      const tooDeep = await fastify.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/v1/admin/webhook-events",
        payload: {
          ...body,
          externalEventId: `deep-${randomUUID()}`,
          payload: nestedPayload,
        },
      });
      assert.equal(tooDeep.statusCode, 400);
      assert.equal(tooDeep.json().error.code, "VALIDATION_ERROR");

      const processed = await fastify.inject({
        headers: { cookie },
        method: "POST",
        url: `/api/v1/admin/webhook-events/${eventId}/process`,
      });
      assert.equal(processed.statusCode, 200);
      assert.equal(processed.json().data.status, "PROCESSED");
      const repeated = await fastify.inject({
        headers: { cookie },
        method: "POST",
        url: `/api/v1/admin/webhook-events/${eventId}/process`,
      });
      assert.equal(repeated.json().data.attemptCount, 1);

      const detail = await fastify.inject({
        headers: { cookie },
        method: "GET",
        url: `/api/v1/admin/webhook-events/${eventId}`,
      });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().data.attempts.length, 1);
      assert.equal(detail.json().data.attempts[0].status, "SUCCEEDED");

      const openApi = await fastify.inject({
        method: "GET",
        url: "/api/docs-json",
      });
      assert.ok(openApi.json().paths["/api/v1/admin/webhook-events"]);
    } finally {
      await app.close();
    }
  });

  it("records retryable and permanent failures and serializes concurrent claims", async () => {
    const app = await createApiApplication(environment());
    try {
      await app.init();
      const service = app.get(WebhookInboxService);
      const now = new Date("2026-07-29T12:00:00.000Z");
      const retryEvent = await service.receive({
        provider: "test",
        externalEventId: `retry-${randomUUID()}`,
        eventType: "retryable",
        payload: {},
      });
      eventIds.add(retryEvent.event.id);
      const failed = await service.process(
        retryEvent.event.id,
        async () => {
          throw new WebhookProcessingError(
            "TEMPORARY_UNAVAILABLE",
            "Temporary failure",
            true,
          );
        },
        now,
      );
      assert.equal(failed.status, "FAILED_RETRYABLE");
      assert.equal(failed.attemptCount, 1);
      const waiting = await service.process(
        retryEvent.event.id,
        async () => assert.fail("backoff must prevent early retry"),
        now,
      );
      assert.equal(waiting.attemptCount, 1);
      const recovered = await service.process(
        retryEvent.event.id,
        async () => undefined,
        new Date(now.getTime() + 1000),
      );
      assert.equal(recovered.status, "PROCESSED");
      assert.equal(recovered.attemptCount, 2);

      const permanentEvent = await service.receive({
        provider: "test",
        externalEventId: `permanent-${randomUUID()}`,
        eventType: "permanent",
        payload: {},
      });
      eventIds.add(permanentEvent.event.id);
      const permanent = await service.process(
        permanentEvent.event.id,
        async () => {
          throw new WebhookProcessingError(
            "INVALID_SIGNATURE",
            "Permanent failure",
            false,
          );
        },
        now,
      );
      assert.equal(permanent.status, "FAILED_PERMANENT");
      assert.equal(
        (await service.process(permanentEvent.event.id)).attemptCount,
        1,
      );

      const oversizedErrorEvent = await service.receive({
        provider: "test",
        externalEventId: `oversized-${randomUUID()}`,
        eventType: "oversized-error",
        payload: {},
      });
      eventIds.add(oversizedErrorEvent.event.id);
      const oversized = await service.process(
        oversizedErrorEvent.event.id,
        async () => {
          throw new WebhookProcessingError(
            "C".repeat(200),
            "M".repeat(2_000),
            false,
          );
        },
        now,
      );
      assert.equal(oversized.lastErrorCode?.length, 120);
      assert.equal(oversized.lastErrorMessage?.length, 1_000);

      const concurrentEvent = await service.receive({
        provider: "test",
        externalEventId: `concurrent-${randomUUID()}`,
        eventType: "concurrent",
        payload: {},
      });
      eventIds.add(concurrentEvent.event.id);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const first = service.process(concurrentEvent.event.id, async () => {
        calls += 1;
        await gate;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await service.process(
        concurrentEvent.event.id,
        async () => {
          calls += 1;
        },
      );
      assert.equal(second.status, "PROCESSING");
      release();
      assert.equal((await first).status, "PROCESSED");
      assert.equal(calls, 1);

      const leasedEvent = await service.receive({
        provider: "test",
        externalEventId: `leased-${randomUUID()}`,
        eventType: "leased",
        payload: {},
      });
      eventIds.add(leasedEvent.event.id);
      let releaseLease!: () => void;
      const leaseGate = new Promise<void>((resolve) => {
        releaseLease = resolve;
      });
      const stale = service.process(
        leasedEvent.event.id,
        async () => leaseGate,
        now,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const takeover = await service.process(
        leasedEvent.event.id,
        async () => undefined,
        new Date(now.getTime() + 5 * 60 * 1000 + 1),
      );
      assert.equal(takeover.status, "PROCESSED");
      assert.equal(takeover.attemptCount, 2);
      releaseLease();
      const fenced = await stale;
      assert.equal(fenced.status, "PROCESSED");
      assert.equal(fenced.attemptCount, 2);
      const leaseAttempts = await getPrismaClient().webhookEventAttempt.findMany({
        where: { eventId: leasedEvent.event.id },
        orderBy: { attemptNumber: "asc" },
      });
      assert.deepEqual(
        leaseAttempts.map((attempt) => [
          attempt.attemptNumber,
          attempt.status,
          attempt.errorCode,
        ]),
        [
          [1, "FAILED_PERMANENT", "PROCESSING_LEASE_LOST"],
          [2, "SUCCEEDED", null],
        ],
      );
    } finally {
      await app.close();
    }
  });
});

after(async () => {
  const prisma = getPrismaClient();
  await prisma.webhookEventAttempt.deleteMany({
    where: { eventId: { in: [...eventIds] } },
  });
  await prisma.webhookEvent.deleteMany({
    where: { id: { in: [...eventIds] } },
  });
  const users = await prisma.user.findMany({
    where: { email: { in: [...emails] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.verification.deleteMany({
    where: { identifier: { in: [...emails] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});
