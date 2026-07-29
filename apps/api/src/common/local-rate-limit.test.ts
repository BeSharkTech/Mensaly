import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import fastify from "fastify";

import { registerRequestContext } from "./correlation";
import { registerLocalRateLimit } from "./local-rate-limit";

describe("local request rate limiting", () => {
  it("separates sensitive and general mutation budgets and exposes retry data", async () => {
    let now = Date.parse("2026-07-29T00:00:00.000Z");
    const app = fastify();
    registerRequestContext(app);
    registerLocalRateLimit(app, {
      windowMs: 1_000,
      maxMutations: 2,
      maxSensitiveMutations: 1,
      now: () => now,
    });
    app.post("/api/v1/items", async () => ({ ok: true }));
    app.post("/api/v1/auth/login", async () => ({ ok: true }));
    app.get("/api/v1/items", async () => ({ ok: true }));

    try {
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/items" })).statusCode,
        200,
      );
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/items" })).statusCode,
        200,
      );
      const limited = await app.inject({
        method: "POST",
        url: "/api/v1/items",
      });
      assert.equal(limited.statusCode, 429);
      assert.equal(limited.json().error.code, "RATE_LIMITED");
      assert.equal(limited.headers["retry-after"], "1");
      assert.equal(limited.headers["x-ratelimit-remaining"], "0");

      assert.equal(
        (await app.inject({ method: "GET", url: "/api/v1/items" })).statusCode,
        200,
      );
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/auth/login" }))
          .statusCode,
        200,
      );
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/auth/login" }))
          .statusCode,
        429,
      );

      now += 1_001;
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/v1/items" })).statusCode,
        200,
      );
    } finally {
      await app.close();
    }
  });
});
