import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startWorker } from "./worker";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/mensaly",
  REDIS_URL: "redis://localhost:6379",
};

describe("worker foundation", () => {
  it("validates its environment before starting", () => {
    assert.doesNotThrow(() => startWorker(validEnvironment));
  });

  it("does not start with an incomplete environment", () => {
    assert.throws(() => startWorker({}));
  });
});
