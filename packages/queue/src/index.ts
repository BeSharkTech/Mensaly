import { createHash } from "node:crypto";

import {
  Job,
  Queue,
  QueueEvents,
  UnrecoverableError,
  Worker,
  type ConnectionOptions,
} from "bullmq";

export const QUEUE_NAMES = {
  MESSAGE_DISPATCH: "message-dispatch",
  SCHEDULED_TASKS: "scheduled-tasks",
  DEAD_LETTER: "dead-letter",
} as const;

export const JOB_NAMES = {
  MESSAGE_DISPATCH: "dispatch-message",
  SCHEDULER_TICK: "scheduler-tick",
  DEAD_LETTER: "dead-letter",
} as const;

export type MessageDispatchJob = {
  organizationId: string;
  scheduleId: string;
};

export type SchedulerTickJob = {
  source: "recurring";
};

export type JobFailureClassification = "transient" | "permanent";

export type DeadLetterJob = {
  sourceQueue: string;
  sourceJobName: string;
  sourceJobId: string;
  originalData: MessageDispatchJob;
  classification: JobFailureClassification;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
};

export type QueueLogger = {
  info: (attributes: Record<string, unknown>, message: string) => void;
  warn: (attributes: Record<string, unknown>, message: string) => void;
  error: (attributes: Record<string, unknown>, message: string) => void;
};

export type MessageDispatchHandler = (
  job: Job<MessageDispatchJob>,
) => Promise<void>;

export type SchedulerTickHandler = (
  job: Job<SchedulerTickJob>,
) => Promise<void>;

export type MessageQueueRuntimeOptions = {
  redisUrl: string;
  prefix: string;
  concurrency: number;
  attempts: number;
  backoffMs: number;
  metricsIntervalMs: number;
  handler: MessageDispatchHandler;
  schedulerIntervalMs: number;
  schedulerHandler: SchedulerTickHandler;
  logger?: QueueLogger;
};

export type QueueMetrics = {
  messages: Record<string, number>;
  scheduler: Record<string, number>;
  deadLetters: Record<string, number>;
};

export type MessageQueueRuntime = {
  messageQueue: Queue<MessageDispatchJob>;
  schedulerQueue: Queue<SchedulerTickJob>;
  deadLetterQueue: Queue<DeadLetterJob>;
  enqueue: (
    payload: MessageDispatchJob,
    options?: { delayMs?: number },
  ) => Promise<Job<MessageDispatchJob>>;
  remove: (scheduleId: string) => Promise<boolean>;
  waitForJob: (
    job: Job<MessageDispatchJob>,
    timeoutMs?: number,
  ) => Promise<unknown>;
  metrics: () => Promise<QueueMetrics>;
  stop: () => Promise<void>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIX_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DEFAULT_COMPLETED_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_FAILED_RETENTION_SECONDS = 30 * 24 * 60 * 60;

const silentLogger: QueueLogger = {
  info() {},
  warn() {},
  error() {},
};

export class TransientJobError extends Error {
  override readonly name = "TransientJobError";
}

export class PermanentJobError extends Error {
  override readonly name = "PermanentJobError";
}

export function classifyJobError(error: unknown): JobFailureClassification {
  return error instanceof PermanentJobError ||
    (error instanceof Error && error.name === "UnrecoverableError")
    ? "permanent"
    : "transient";
}

export function messageDispatchJobId(scheduleId: string): string {
  if (!UUID_PATTERN.test(scheduleId)) {
    throw new Error("scheduleId must be a UUID");
  }

  return `message-${scheduleId.toLowerCase()}`;
}

export function deadLetterJobId(
  sourceQueue: string,
  sourceJobId: string,
): string {
  const digest = createHash("sha256")
    .update(`${sourceQueue}/${sourceJobId}`)
    .digest("hex");
  return `dlq-${digest}`;
}

export function redisConnectionOptions(
  redisUrl: string,
  blocking: boolean,
): ConnectionOptions {
  const parsed = new URL(redisUrl);
  if (!["redis:", "rediss:"].includes(parsed.protocol)) {
    throw new Error("redisUrl must use redis:// or rediss://");
  }

  const databaseText = parsed.pathname.replace(/^\//, "");
  if (databaseText && !/^\d+$/.test(databaseText)) {
    throw new Error("Redis database must be a non-negative integer");
  }

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    ...(databaseText ? { db: Number(databaseText) } : {}),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: blocking ? null : 1,
    enableReadyCheck: true,
  };
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function terminalFailure(
  job: Job<MessageDispatchJob>,
  error: Error,
): boolean {
  const attempts = job.opts.attempts ?? 1;
  return (
    classifyJobError(error) === "permanent" ||
    job.attemptsMade >= attempts
  );
}

export async function createMessageQueueRuntime(
  options: MessageQueueRuntimeOptions,
): Promise<MessageQueueRuntime> {
  if (!PREFIX_PATTERN.test(options.prefix)) {
    throw new Error(
      "prefix must start with a lowercase letter or number and contain only lowercase letters, numbers, _ or -",
    );
  }

  const concurrency = positiveInteger(options.concurrency, "concurrency");
  const attempts = positiveInteger(options.attempts, "attempts");
  const backoffMs = positiveInteger(options.backoffMs, "backoffMs");
  const metricsIntervalMs = nonNegativeInteger(
    options.metricsIntervalMs,
    "metricsIntervalMs",
  );
  const schedulerIntervalMs = positiveInteger(
    options.schedulerIntervalMs,
    "schedulerIntervalMs",
  );
  const logger = options.logger ?? silentLogger;
  const producerConnection = redisConnectionOptions(options.redisUrl, false);
  const blockingConnection = redisConnectionOptions(options.redisUrl, true);

  const messageQueue = new Queue<MessageDispatchJob>(
    QUEUE_NAMES.MESSAGE_DISPATCH,
    {
      connection: producerConnection,
      prefix: options.prefix,
      defaultJobOptions: {
        attempts,
        backoff: { type: "exponential", delay: backoffMs },
        removeOnComplete: {
          age: DEFAULT_COMPLETED_RETENTION_SECONDS,
          count: 10_000,
        },
        removeOnFail: {
          age: DEFAULT_FAILED_RETENTION_SECONDS,
          count: 10_000,
        },
      },
    },
  );
  const deadLetterQueue = new Queue<DeadLetterJob>(QUEUE_NAMES.DEAD_LETTER, {
    connection: producerConnection,
    prefix: options.prefix,
  });
  const schedulerQueue = new Queue<SchedulerTickJob>(
    QUEUE_NAMES.SCHEDULED_TASKS,
    {
      connection: producerConnection,
      prefix: options.prefix,
    },
  );
  const queueEvents = new QueueEvents(QUEUE_NAMES.MESSAGE_DISPATCH, {
    connection: blockingConnection,
    prefix: options.prefix,
  });
  const worker = new Worker<MessageDispatchJob>(
    QUEUE_NAMES.MESSAGE_DISPATCH,
    async (job) => {
      try {
        await options.handler(job);
      } catch (error) {
        const normalized = normalizeError(error);
        if (classifyJobError(normalized) === "permanent") {
          throw new UnrecoverableError(normalized.message);
        }
        throw normalized;
      }
    },
    {
      connection: blockingConnection,
      prefix: options.prefix,
      concurrency,
    },
  );
  const schedulerWorker = new Worker<SchedulerTickJob>(
    QUEUE_NAMES.SCHEDULED_TASKS,
    options.schedulerHandler,
    {
      connection: blockingConnection,
      prefix: options.prefix,
      concurrency: 1,
    },
  );

  const pendingDeadLetters = new Set<Promise<unknown>>();

  worker.on("active", (job) => {
    logger.info(
      {
        queue: QUEUE_NAMES.MESSAGE_DISPATCH,
        jobId: job.id,
        jobName: job.name,
        attempt: job.attemptsMade + 1,
      },
      "BullMQ job started",
    );
  });
  worker.on("completed", (job) => {
    logger.info(
      {
        queue: QUEUE_NAMES.MESSAGE_DISPATCH,
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
      },
      "BullMQ job completed",
    );
  });
  worker.on("failed", (job, error) => {
    if (!job) {
      logger.error(
        {
          queue: QUEUE_NAMES.MESSAGE_DISPATCH,
          error,
        },
        "BullMQ job failed without job context",
      );
      return;
    }

    const classification = classifyJobError(error);
    const terminal = terminalFailure(job, error);
    logger.warn(
      {
        queue: QUEUE_NAMES.MESSAGE_DISPATCH,
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        classification,
        terminal,
        error,
      },
      "BullMQ job failed",
    );
    if (!terminal || !job.id) {
      return;
    }

    const transfer = deadLetterQueue.add(
      JOB_NAMES.DEAD_LETTER,
      {
        sourceQueue: QUEUE_NAMES.MESSAGE_DISPATCH,
        sourceJobName: job.name,
        sourceJobId: job.id,
        originalData: job.data,
        classification,
        failedReason: error.message.slice(0, 1_000),
        attemptsMade: job.attemptsMade,
        failedAt: new Date().toISOString(),
      },
      {
        jobId: deadLetterJobId(QUEUE_NAMES.MESSAGE_DISPATCH, job.id),
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
    pendingDeadLetters.add(transfer);
    void transfer
      .then(() => {
        logger.error(
          {
            queue: QUEUE_NAMES.MESSAGE_DISPATCH,
            deadLetterQueue: QUEUE_NAMES.DEAD_LETTER,
            jobId: job.id,
            classification,
          },
          "BullMQ job moved to dead letter",
        );
      })
      .catch((deadLetterError: unknown) => {
        logger.error(
          {
            queue: QUEUE_NAMES.MESSAGE_DISPATCH,
            jobId: job.id,
            error: deadLetterError,
          },
          "BullMQ dead-letter transfer failed",
        );
      })
      .finally(() => {
        pendingDeadLetters.delete(transfer);
      });
  });
  worker.on("error", (error) => {
    logger.error(
      {
        queue: QUEUE_NAMES.MESSAGE_DISPATCH,
        error,
      },
      "BullMQ worker error",
    );
  });
  schedulerWorker.on("failed", (job, error) => {
    logger.error(
      {
        queue: QUEUE_NAMES.SCHEDULED_TASKS,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        error,
      },
      "BullMQ scheduler tick failed",
    );
  });
  schedulerWorker.on("error", (error) => {
    logger.error(
      { queue: QUEUE_NAMES.SCHEDULED_TASKS, error },
      "BullMQ scheduler worker error",
    );
  });

  try {
    await Promise.all([
      messageQueue.waitUntilReady(),
      schedulerQueue.waitUntilReady(),
      deadLetterQueue.waitUntilReady(),
      queueEvents.waitUntilReady(),
      worker.waitUntilReady(),
      schedulerWorker.waitUntilReady(),
    ]);
    await schedulerQueue.upsertJobScheduler(
      "mensaly-scheduler",
      { every: schedulerIntervalMs },
      {
        name: JOB_NAMES.SCHEDULER_TICK,
        data: { source: "recurring" },
        opts: {
          attempts,
          backoff: { type: "exponential", delay: backoffMs },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
  } catch (error) {
    await Promise.allSettled([
      worker.close(true),
      schedulerWorker.close(true),
      queueEvents.close(),
      messageQueue.close(),
      schedulerQueue.close(),
      deadLetterQueue.close(),
    ]);
    throw error;
  }

  const metrics = async (): Promise<QueueMetrics> => {
    const [messages, scheduler, deadLetters] = await Promise.all([
      messageQueue.getJobCounts(),
      schedulerQueue.getJobCounts(),
      deadLetterQueue.getJobCounts(),
    ]);
    return {
      messages: { ...messages },
      scheduler: { ...scheduler },
      deadLetters: { ...deadLetters },
    };
  };

  const metricsTimer =
    metricsIntervalMs > 0
      ? setInterval(() => {
          void metrics()
            .then((snapshot) => {
              logger.info(
                {
                  queues: snapshot,
                },
                "BullMQ local metrics",
              );
            })
            .catch((error: unknown) => {
              logger.error(
                {
                  error,
                },
                "BullMQ metrics collection failed",
              );
            });
        }, metricsIntervalMs)
      : undefined;
  metricsTimer?.unref();

  logger.info(
    {
      queues: Object.values(QUEUE_NAMES),
      prefix: options.prefix,
      concurrency,
      attempts,
      backoffMs,
      schedulerIntervalMs,
    },
    "BullMQ runtime ready",
  );

  let stopPromise: Promise<void> | undefined;

  return {
    messageQueue,
    schedulerQueue,
    deadLetterQueue,
    enqueue(payload, enqueueOptions) {
      return messageQueue.add(JOB_NAMES.MESSAGE_DISPATCH, payload, {
        jobId: messageDispatchJobId(payload.scheduleId),
        delay: nonNegativeInteger(
          enqueueOptions?.delayMs ?? 0,
          "delayMs",
        ),
      });
    },
    async remove(scheduleId) {
      const job = await messageQueue.getJob(messageDispatchJobId(scheduleId));
      if (!job) {
        return false;
      }
      await job.remove();
      return true;
    },
    waitForJob(job, timeoutMs = 10_000) {
      return job.waitUntilFinished(queueEvents, timeoutMs);
    },
    metrics,
    stop() {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        if (metricsTimer) {
          clearInterval(metricsTimer);
        }

        const workerResult = await Promise.allSettled([
          schedulerWorker.close(),
          worker.close(),
        ]);
        await Promise.allSettled([...pendingDeadLetters]);
        const connectionResults = await Promise.allSettled([
          queueEvents.close(),
          messageQueue.close(),
          schedulerQueue.close(),
          deadLetterQueue.close(),
        ]);
        const failure = [...workerResult, ...connectionResults].find(
          (result) => result.status === "rejected",
        );
        if (failure?.status === "rejected") {
          throw failure.reason;
        }

        logger.info(
          {
            queues: Object.values(QUEUE_NAMES),
          },
          "BullMQ runtime stopped",
        );
      })();

      return stopPromise;
    },
  };
}
