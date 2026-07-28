import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MessageQueueRuntimeOptions } from "@mensaly/queue";

import { startWorker } from "./worker";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/mensaly",
  REDIS_URL: "redis://localhost:6379",
};

function createDependencies(options?: { queueStartupError?: Error }) {
  const events: string[] = [];
  let queueOptions: MessageQueueRuntimeOptions | undefined;

  return {
    events,
    get queueOptions() {
      return queueOptions;
    },
    dependencies: {
      database: {
        async $connect() {
          events.push("database-connect");
        },
      },
      async disconnectDatabase() {
        events.push("database-disconnect");
      },
      async createQueueRuntime(configuration: MessageQueueRuntimeOptions) {
        events.push("queues-start");
        queueOptions = configuration;
        if (options?.queueStartupError) {
          throw options.queueStartupError;
        }
        return {
          async stop() {
            events.push("queues-stop");
          },
        };
      },
      createMessageHandler() {
        return async () => {};
      },
      logger: {
        info(_attributes: Record<string, unknown>, message: string) {
          events.push(`info:${message}`);
        },
        warn(_attributes: Record<string, unknown>, message: string) {
          events.push(`warn:${message}`);
        },
        error(_attributes: Record<string, unknown>, message: string) {
          events.push(`error:${message}`);
        },
      },
    },
  };
}

describe("worker lifecycle", () => {
  it("starts queues after the database and shuts down in safe order", async () => {
    const context = createDependencies();
    const runtime = await startWorker(
      validEnvironment,
      context.dependencies,
    );

    assert.deepEqual(context.events, [
      "database-connect",
      "queues-start",
      "info:Mensaly worker started",
    ]);
    assert.equal(context.queueOptions?.prefix, "mensaly");
    assert.equal(context.queueOptions?.concurrency, 5);
    assert.equal(context.queueOptions?.attempts, 4);
    assert.equal(context.queueOptions?.backoffMs, 1000);

    await runtime.stop();
    await runtime.stop();

    assert.deepEqual(context.events, [
      "database-connect",
      "queues-start",
      "info:Mensaly worker started",
      "queues-stop",
      "database-disconnect",
      "info:Mensaly worker stopped",
    ]);
  });

  it("does not connect with an incomplete environment", async () => {
    const context = createDependencies();

    await assert.rejects(startWorker({}, context.dependencies));
    assert.deepEqual(context.events, []);
  });

  it("disconnects the database when queue startup fails", async () => {
    const context = createDependencies({
      queueStartupError: new Error("Redis unavailable"),
    });

    await assert.rejects(
      startWorker(validEnvironment, context.dependencies),
      /Redis unavailable/,
    );
    assert.deepEqual(context.events, [
      "database-connect",
      "queues-start",
      "database-disconnect",
    ]);
  });
});
