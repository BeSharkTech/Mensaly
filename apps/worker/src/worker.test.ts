import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { startWorker } from "./worker";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/mensaly",
  REDIS_URL: "redis://localhost:6379",
};

function createDependencies() {
  const events: string[] = [];

  return {
    events,
    dependencies: {
      database: {
        async $connect() {
          events.push("connect");
        },
      },
      async disconnectDatabase() {
        events.push("disconnect");
      },
      log(message: string) {
        events.push(message);
      },
    },
  };
}

describe("worker database lifecycle", () => {
  it("connects before starting and disconnects once", async () => {
    const { dependencies, events } = createDependencies();
    const runtime = await startWorker(validEnvironment, dependencies);

    assert.deepEqual(events, ["connect", "Mensaly worker started"]);

    await runtime.stop();
    await runtime.stop();

    assert.deepEqual(events, [
      "connect",
      "Mensaly worker started",
      "disconnect",
    ]);
  });

  it("does not connect with an incomplete environment", async () => {
    const { dependencies, events } = createDependencies();

    await assert.rejects(startWorker({}, dependencies));
    assert.deepEqual(events, []);
  });
});
