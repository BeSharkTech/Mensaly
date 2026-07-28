import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApiApplication } from "./app";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== "mensaly_test") {
  throw new Error("API tests require the isolated mensaly_test database.");
}

describe("API foundation", () => {
  it("boots the Nest and Fastify application", async () => {
    const app = await createApiApplication();

    try {
      await app.init();

      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: "GET", url: "/" });

      assert.equal(response.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});
