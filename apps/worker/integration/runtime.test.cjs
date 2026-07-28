const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");

const { startWorker } = require("../dist/worker.js");

test(
  "compiled worker connects to PostgreSQL and Redis and shuts down safely",
  { timeout: 15_000 },
  async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const redisUrl = process.env.REDIS_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    assert.ok(redisUrl, "REDIS_URL is required");

    const runtime = await startWorker({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      BULLMQ_PREFIX: `mensaly-runtime-${randomUUID()}`,
      BULLMQ_WORKER_CONCURRENCY: "1",
      BULLMQ_JOB_ATTEMPTS: "2",
      BULLMQ_BACKOFF_MS: "10",
      BULLMQ_METRICS_INTERVAL_MS: "1000",
    });

    await runtime.stop();
    await runtime.stop();
  },
);
