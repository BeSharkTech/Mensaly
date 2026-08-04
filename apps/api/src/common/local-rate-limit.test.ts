import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import fastify, { type FastifyInstance } from "fastify";

import { registerRequestContext } from "./correlation";
import {
  LocalRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
  registerRateLimit,
} from "./local-rate-limit";

const compactPolicies = {
  login: { id: "login", limit: 1, windowMs: 1_000 },
  register: { id: "register", limit: 1, windowMs: 1_000 },
  "password-reset": { id: "password-reset", limit: 1, windowMs: 1_000 },
  "email-verification": {
    id: "email-verification",
    limit: 1,
    windowMs: 1_000,
  },
  "public-form": { id: "public-form", limit: 1, windowMs: 1_000 },
  "public-checkout": { id: "public-checkout", limit: 1, windowMs: 1_000 },
  "payment-integration": {
    id: "payment-integration",
    limit: 1,
    windowMs: 1_000,
  },
  messaging: { id: "messaging", limit: 1, windowMs: 1_000 },
  webhook: { id: "webhook", limit: 1, windowMs: 1_000 },
  mutation: { id: "mutation", limit: 2, windowMs: 1_000 },
};

function testApplication(
  options: Parameters<typeof registerRateLimit>[1],
): FastifyInstance {
  const app = fastify();
  registerRequestContext(app);
  registerRateLimit(app, { ...options, policies: compactPolicies });
  app.post("/api/v1/items", async () => ({ ok: true }));
  app.get("/api/v1/items", async () => ({ ok: true }));
  app.post("/api/v1/auth/login", async () => ({ ok: true }));
  app.post("/api/v1/auth/register", async () => ({ ok: true }));
  app.post("/api/v1/public/forms/:organizationId/responses", async () => ({ ok: true }));
  app.post("/api/v1/public/checkout/:token/session", async () => ({ ok: true }));
  app.post("/api/v1/public/mercadopago-checkout/:token/process", async () => ({ ok: true }));
  app.post("/api/v1/webhooks/stripe", async () => ({ ok: true }));
  app.post("/api/v1/webhooks/mercadopago", async () => ({ ok: true }));
  return app;
}

describe("request rate limiting", () => {
  it("separates route budgets, ignores reads and exposes retry data", async () => {
    let now = Date.parse("2026-07-29T00:00:00.000Z");
    const app = testApplication({ now: () => now });

    try {
      assert.equal((await app.inject({ method: "GET", url: "/api/v1/items" })).statusCode, 200);
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/items" })).statusCode, 200);
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/items" })).statusCode, 200);
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/items" })).statusCode, 429);

      const firstLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login" });
      assert.equal(firstLogin.statusCode, 200);
      assert.match(String(firstLogin.headers["ratelimit-policy"] ?? ""), /name="login"/);
      const limited = await app.inject({ method: "POST", url: "/api/v1/auth/login" });
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json().error.code, "RATE_LIMITED");
      assert.equal(limited.headers["retry-after"], "1");
      assert.equal(limited.headers["x-ratelimit-remaining"], "0");

      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/auth/register" })).statusCode,
        200,
      );
      now += 1_001;
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/auth/login" })).statusCode,
        200,
      );
    } finally {
      await app.close();
    }
  });

  it("shares a distributed budget between API instances", async () => {
    const sharedStore = new LocalRateLimitStore();
    const now = () => Date.parse("2026-07-29T00:00:00.000Z");
    const first = testApplication({ store: sharedStore, now });
    const second = testApplication({ store: sharedStore, now });

    try {
      assert.equal(
        (await first.inject({ method: "POST", url: "/api/v1/auth/login" })).statusCode,
        200,
      );
      assert.equal(
        (await second.inject({ method: "POST", url: "/api/v1/auth/login" })).statusCode,
        429,
      );
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("keeps enforcing a local budget when the distributed store fails", async () => {
    let attempts = 0;
    const unavailableStore: RateLimitStore = {
      async consume() {
        attempts += 1;
        throw new Error("redis unavailable");
      },
    };
    const app = testApplication({ store: unavailableStore });

    try {
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/public/checkout/token/session" }))
          .statusCode,
        200,
      );
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/public/checkout/token/session" }))
          .statusCode,
        429,
      );
      assert.equal(attempts, 1);
    } finally {
      await app.close();
    }
  });

  it("probes the distributed store again after the fallback cooldown", async () => {
    let now = 0;
    let attempts = 0;
    const recoveringStore: RateLimitStore = {
      async consume(_key, windowMs, currentTime) {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("redis unavailable");
        }
        return { count: 1, resetAt: currentTime + windowMs };
      },
    };
    const app = testApplication({
      store: recoveringStore,
      fallbackRetryMs: 5_000,
      now: () => now,
    });

    try {
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/auth/login" })).statusCode,
        200,
      );
      now = 4_999;
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/auth/register" })).statusCode,
        200,
      );
      assert.equal(attempts, 1);
      now = 5_001;
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/auth/register" })).statusCode,
        200,
      );
      assert.equal(attempts, 2);
    } finally {
      await app.close();
    }
  });

  it("assigns dedicated policies to public forms and signed webhooks", async () => {
    const app = testApplication({});

    try {
      const form = await app.inject({
        method: "POST",
        url: "/api/v1/public/forms/company/responses",
      });
      const webhook = await app.inject({ method: "POST", url: "/api/v1/webhooks/stripe" });
      const mercadoPago = await app.inject({ method: "POST", url: "/api/v1/webhooks/mercadopago" });
      assert.match(String(form.headers["ratelimit-policy"] ?? ""), /name="public-form"/);
      assert.match(String(webhook.headers["ratelimit-policy"] ?? ""), /name="webhook"/);
      assert.match(String(mercadoPago.headers["ratelimit-policy"] ?? ""), /name="webhook"/);
    } finally {
      await app.close();
    }
  });

  it(
    "increments one atomic counter in Redis",
    { skip: !(process.env.TEST_REDIS_URL ?? process.env.REDIS_URL) },
    async () => {
      const store = new RedisRateLimitStore(
        process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? "",
        `mensaly:test:rate-limit:${randomUUID()}`,
      );
      const now = Date.now();

      try {
        const first = await store.consume("login:client", 1_000, now);
        const second = await store.consume("login:client", 1_000, now);
        assert.equal(first.count, 1);
        assert.equal(second.count, 2);
        assert.ok(second.resetAt >= now);
        assert.ok(second.resetAt <= now + 1_000);
      } finally {
        await store.close();
      }
    },
  );
});
