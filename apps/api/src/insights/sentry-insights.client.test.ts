import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";

import { configureAdminInsights } from "./admin-insights.configuration";
import { SentryInsightsClient } from "./sentry-insights.client";

function configure() {
  configureAdminInsights(
    parseEnvironment(apiEnvironmentSchema, {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:password@localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      CORS_ORIGINS: "https://allowed.example",
      SENTRY_API_TOKEN: "read-only-token",
      SENTRY_ORG_SLUG: "mensaly",
      SENTRY_PROJECT_ID: "12345",
    }),
  );
}

afterEach(() => mock.restoreAll());

describe("SentryInsightsClient", () => {
  it("normalizes event series and unresolved issues without exposing credentials", async () => {
    configure();
    const requests: string[] = [];
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("stats_v2")) {
        return new Response(JSON.stringify({
          groups: [{ series: { "sum(quantity)": [[1_785_628_800, 3], [1_785_715_200, 4]] } }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify([{
        id: "issue-1",
        title: "Checkout failed",
        culprit: "StripeCheckoutService",
        count: "7",
        level: "error",
        lastSeen: "2026-08-03T10:00:00.000Z",
        permalink: "https://sentry.io/issues/1",
      }]), { status: 200 });
    });

    const result = await new SentryInsightsClient().summary(30);
    assert.equal(result.status, "ready");
    assert.equal(result.totalErrors, 7);
    assert.equal(result.unresolvedIssues[0]?.title, "Checkout failed");
    assert.equal(requests.length, 2);
    assert.equal(requests.some((url) => url.includes("read-only-token")), false);
  });

  it("degrades safely when Sentry is unavailable", async () => {
    configure();
    mock.method(globalThis, "fetch", async () => {
      throw new Error("provider unavailable");
    });
    const result = await new SentryInsightsClient().summary(30);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.dailyErrors, []);
  });
});
