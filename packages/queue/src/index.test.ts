import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";

import { Queue } from "bullmq";

import {
  classifyJobError,
  createMessageQueueRuntime,
  deadLetterJobId,
  JOB_NAMES,
  messageDispatchJobId,
  PermanentJobError,
  QUEUE_NAMES,
  redisConnectionOptions,
  TransientJobError,
  type DeadLetterJob,
  type MessageDispatchJob,
  type MessageQueueRuntime,
  type QueueLogger,
} from "./index";

const redisUrl = process.env.REDIS_URL;
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const duplicateScheduleId = "11111111-1111-4111-8111-111111111111";
const retryScheduleId = "22222222-2222-4222-8222-222222222222";
const permanentScheduleId = "33333333-3333-4333-8333-333333333333";
const exhaustedScheduleId = "44444444-4444-4444-8444-444444444444";
const slowScheduleId = "55555555-5555-4555-8555-555555555555";

function createTestLogger() {
  const events: Array<{ level: string; message: string }> = [];
  const write = (level: string, message: string) => {
    events.push({ level, message });
  };
  const logger: QueueLogger = {
    info(_attributes, message) {
      write("info", message);
    },
    warn(_attributes, message) {
      write("warn", message);
    },
    error(_attributes, message) {
      write("error", message);
    },
  };
  return { events, logger };
}

async function eventually<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await delay(20);
    value = await read();
  }
  assert.equal(predicate(value), true, "condition was not reached in time");
  return value;
}

async function cleanupQueues(prefix: string): Promise<void> {
  assert.ok(redisUrl);
  const connection = redisConnectionOptions(redisUrl, false);
  const messageQueue = new Queue(QUEUE_NAMES.MESSAGE_DISPATCH, {
    connection,
    prefix,
  });
  const deadLetterQueue = new Queue(QUEUE_NAMES.DEAD_LETTER, {
    connection,
    prefix,
  });
  const schedulerQueue = new Queue(QUEUE_NAMES.SCHEDULED_TASKS, {
    connection,
    prefix,
  });
  try {
    await Promise.all([
      messageQueue.obliterate({ force: true }),
      deadLetterQueue.obliterate({ force: true }),
      schedulerQueue.obliterate({ force: true }),
    ]);
  } finally {
    await Promise.all([
      messageQueue.close(),
      deadLetterQueue.close(),
      schedulerQueue.close(),
    ]);
  }
}

function runtimeOptions(
  prefix: string,
  handler: Parameters<typeof createMessageQueueRuntime>[0]["handler"],
  logger: QueueLogger,
  schedulerHandler: Parameters<
    typeof createMessageQueueRuntime
  >[0]["schedulerHandler"] = async () => {},
) {
  assert.ok(redisUrl, "REDIS_URL is required for BullMQ integration tests");
  return {
    redisUrl,
    prefix,
    concurrency: 2,
    attempts: 3,
    backoffMs: 10,
    metricsIntervalMs: 0,
    schedulerIntervalMs: 60_000,
    handler,
    schedulerHandler,
    logger,
  };
}

async function stopAndClean(
  runtime: MessageQueueRuntime,
  prefix: string,
): Promise<void> {
  await runtime.stop();
  await cleanupQueues(prefix);
}

describe("BullMQ contracts", () => {
  it("uses stable queue names and idempotent job IDs", () => {
    assert.deepEqual(QUEUE_NAMES, {
      MESSAGE_DISPATCH: "message-dispatch",
      SCHEDULED_TASKS: "scheduled-tasks",
      DEAD_LETTER: "dead-letter",
    });
    assert.deepEqual(JOB_NAMES, {
      MESSAGE_DISPATCH: "dispatch-message",
      SCHEDULER_TICK: "scheduler-tick",
      DEAD_LETTER: "dead-letter",
    });
    assert.equal(
      messageDispatchJobId(duplicateScheduleId),
      `message-${duplicateScheduleId}`,
    );
    assert.equal(
      deadLetterJobId("message-dispatch", "message-1"),
      deadLetterJobId("message-dispatch", "message-1"),
    );
    assert.doesNotMatch(
      deadLetterJobId("message-dispatch", "message-1"),
      /:/,
    );
    assert.throws(() => messageDispatchJobId("not-a-uuid"), /UUID/);
  });

  it("classifies permanent and transient errors explicitly", () => {
    assert.equal(
      classifyJobError(new PermanentJobError("invalid recipient")),
      "permanent",
    );
    assert.equal(
      classifyJobError(new TransientJobError("provider unavailable")),
      "transient",
    );
    assert.equal(classifyJobError(new Error("unknown")), "transient");
  });

  it("parses Redis URLs without exposing credentials", () => {
    assert.deepEqual(
      redisConnectionOptions("rediss://user:p%40ss@redis.example:6380/2", true),
      {
        host: "redis.example",
        port: 6380,
        username: "user",
        password: "p@ss",
        db: 2,
        tls: {},
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      },
    );
    assert.throws(
      () => redisConnectionOptions("https://redis.example", false),
      /redis/,
    );
  });
});

describe("BullMQ runtime integration", () => {
  it("deduplicates, retries, classifies terminal failures and fills the DLQ", async () => {
    const prefix = `mensaly-test-${randomUUID()}`;
    const attemptsBySchedule = new Map<string, number>();
    const { events, logger } = createTestLogger();
    const runtime = await createMessageQueueRuntime(
      runtimeOptions(
        prefix,
        async (job) => {
          const attempt = (attemptsBySchedule.get(job.data.scheduleId) ?? 0) + 1;
          attemptsBySchedule.set(job.data.scheduleId, attempt);
          if (job.data.scheduleId === retryScheduleId && attempt < 3) {
            throw new TransientJobError("temporary failure");
          }
          if (job.data.scheduleId === permanentScheduleId) {
            throw new PermanentJobError("invalid message");
          }
          if (job.data.scheduleId === exhaustedScheduleId) {
            throw new TransientJobError("still unavailable");
          }
        },
        logger,
      ),
    );

    try {
      const duplicatePayload: MessageDispatchJob = {
        organizationId,
        scheduleId: duplicateScheduleId,
      };
      const [firstDuplicate, secondDuplicate] = await Promise.all([
        runtime.enqueue(duplicatePayload),
        runtime.enqueue(duplicatePayload),
      ]);
      assert.equal(firstDuplicate.id, secondDuplicate.id);
      await runtime.waitForJob(firstDuplicate);
      assert.equal(attemptsBySchedule.get(duplicateScheduleId), 1);

      const retryJob = await runtime.enqueue({
        organizationId,
        scheduleId: retryScheduleId,
      });
      await runtime.waitForJob(retryJob);
      assert.equal(attemptsBySchedule.get(retryScheduleId), 3);

      const permanentJob = await runtime.enqueue({
        organizationId,
        scheduleId: permanentScheduleId,
      });
      await assert.rejects(
        runtime.waitForJob(permanentJob),
        /invalid message/,
      );
      assert.equal(attemptsBySchedule.get(permanentScheduleId), 1);

      const exhaustedJob = await runtime.enqueue({
        organizationId,
        scheduleId: exhaustedScheduleId,
      });
      await assert.rejects(
        runtime.waitForJob(exhaustedJob),
        /still unavailable/,
      );
      assert.equal(attemptsBySchedule.get(exhaustedScheduleId), 3);

      const deadLetters = await eventually(
        () =>
          runtime.deadLetterQueue.getJobs(
            ["waiting"],
            0,
            -1,
            true,
          ),
        (jobs) => jobs.length === 2,
      );
      assert.deepEqual(
        deadLetters
          .map((job) => (job.data as DeadLetterJob).classification)
          .sort(),
        ["permanent", "transient"],
      );
      assert.equal(
        new Set(deadLetters.map((job) => job.id)).size,
        2,
      );

      const metrics = await runtime.metrics();
      assert.equal(metrics.messages.completed, 2);
      assert.equal(metrics.messages.failed, 2);
      assert.ok(metrics.scheduler.delayed >= 1);
      assert.equal(metrics.deadLetters.waiting, 2);
      assert.equal(
        events.some((event) => event.message === "BullMQ job completed"),
        true,
      );
      assert.equal(
        events.filter(
          (event) => event.message === "BullMQ job moved to dead letter",
        ).length,
        2,
      );
    } finally {
      await stopAndClean(runtime, prefix);
    }
  });

  it("waits for active work and makes shutdown idempotent", async () => {
    const prefix = `mensaly-test-${randomUUID()}`;
    const { logger } = createTestLogger();
    let releaseHandler: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const handlerReleased = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const runtime = await createMessageQueueRuntime(
      runtimeOptions(
        prefix,
        async () => {
          signalStarted?.();
          await handlerReleased;
        },
        logger,
      ),
    );

    await runtime.enqueue({
      organizationId,
      scheduleId: slowScheduleId,
    });
    await handlerStarted;

    let stopped = false;
    const firstStop = runtime.stop().then(() => {
      stopped = true;
    });
    const secondStop = runtime.stop();
    await delay(30);
    assert.equal(stopped, false);

    releaseHandler?.();
    await Promise.all([firstStop, secondStop]);
    assert.equal(stopped, true);
    await cleanupQueues(prefix);
  });

  it("runs recurring scheduler ticks and supports delayed message recovery", async () => {
    const prefix = `mensaly-test-${randomUUID()}`;
    const { logger } = createTestLogger();
    let ticks = 0;
    const runtime = await createMessageQueueRuntime({
      ...runtimeOptions(prefix, async () => {}, logger, async () => {
        ticks += 1;
      }),
      schedulerIntervalMs: 1000,
    });

    try {
      await eventually(
        () => Promise.resolve(ticks),
        (value) => value >= 1,
        4000,
      );
      const delayed = await runtime.enqueue(
        {
          organizationId,
          scheduleId: slowScheduleId,
        },
        { delayMs: 60_000 },
      );
      assert.equal(await delayed.getState(), "delayed");
      assert.equal(await runtime.remove(slowScheduleId), true);
      assert.equal(
        await runtime.messageQueue.getJob(messageDispatchJobId(slowScheduleId)),
        undefined,
      );
    } finally {
      await stopAndClean(runtime, prefix);
    }
  });
});
