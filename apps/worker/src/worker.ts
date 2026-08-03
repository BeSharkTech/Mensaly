import { parseEnvironment, workerEnvironmentSchema } from "@mensaly/config";
import {
  disconnectPrismaClient,
  getPrismaClient,
  type PrismaClient,
} from "@mensaly/database";
import { logger } from "@mensaly/logger";
import {
  createMessageQueueRuntime,
  type MessageDispatchHandler,
  type MessageQueueRuntime,
  type MessageQueueRuntimeOptions,
  type QueueLogger,
} from "@mensaly/queue";

import { FakeMessageAdapter } from "./fake-message.adapter";
import { EmailOutboxProcessor } from "./email-outbox.processor";
import { MessageDispatchProcessor } from "./message-dispatch.processor";
import { ScheduledTasksService } from "./scheduled-tasks.service";

export type WorkerRuntime = {
  stop: () => Promise<void>;
};

type WorkerDependencies = {
  database: Pick<PrismaClient, "$connect">;
  disconnectDatabase: () => Promise<void>;
  createQueueRuntime: (
    options: MessageQueueRuntimeOptions,
  ) => Promise<
    Pick<MessageQueueRuntime, "stop" | "enqueue" | "remove">
  >;
  createMessageHandler: () => MessageDispatchHandler;
  createScheduledTasks: (
    queue: Pick<MessageQueueRuntime, "enqueue" | "remove">,
  ) => Pick<ScheduledTasksService, "reconcile">;
  processEmailOutbox?: () => Promise<number>;
  logger: QueueLogger;
};

export async function startWorker(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies?: WorkerDependencies,
): Promise<WorkerRuntime> {
  const configuration = parseEnvironment(
    workerEnvironmentSchema,
    environment,
  );
  const resolvedDependencies =
    dependencies ??
    (() => {
      const database = getPrismaClient();
      const adapter = new FakeMessageAdapter(
        configuration.MESSAGE_AUTOMATION_ENABLED
          ? configuration.FAKE_MESSAGE_ADAPTER_OUTCOME
          : "PERMANENT_FAILURE",
      );
      const processor = new MessageDispatchProcessor(database, adapter);
      const emailOutbox = new EmailOutboxProcessor(database, configuration);
      return {
        database,
        disconnectDatabase: disconnectPrismaClient,
        createQueueRuntime: createMessageQueueRuntime,
        createMessageHandler: () => (job) => processor.process(job.data),
        createScheduledTasks: (queue) =>
          new ScheduledTasksService(database, queue, {
            lookaheadMs: configuration.SCHEDULER_LOOKAHEAD_MS,
            logger,
            messageAutomationEnabled: configuration.MESSAGE_AUTOMATION_ENABLED,
          }),
        processEmailOutbox: () => emailOutbox.processDue(),
        logger,
      };
    })();

  await resolvedDependencies.database.$connect();
  let queues:
    | Pick<MessageQueueRuntime, "stop" | "enqueue" | "remove">
    | undefined;
  let scheduledTasks: Pick<ScheduledTasksService, "reconcile"> | undefined;
  let emailOutboxTimer: NodeJS.Timeout | undefined;
  let processingEmailOutbox = false;
  const processEmailOutbox = async () => {
    if (!resolvedDependencies.processEmailOutbox || processingEmailOutbox) {
      return;
    }
    processingEmailOutbox = true;
    try {
      const processed = await resolvedDependencies.processEmailOutbox();
      if (processed > 0) {
        resolvedDependencies.logger.info(
          { component: "transactional-email-outbox", processed },
          "Transactional email outbox processed",
        );
      }
    } catch (error) {
      resolvedDependencies.logger.error(
        { component: "transactional-email-outbox", error },
        "Transactional email outbox processing failed",
      );
    } finally {
      processingEmailOutbox = false;
    }
  };
  try {
    queues = await resolvedDependencies.createQueueRuntime({
      redisUrl: configuration.REDIS_URL,
      prefix: configuration.BULLMQ_PREFIX,
      concurrency: configuration.BULLMQ_WORKER_CONCURRENCY,
      attempts: configuration.BULLMQ_JOB_ATTEMPTS,
      backoffMs: configuration.BULLMQ_BACKOFF_MS,
      metricsIntervalMs: configuration.BULLMQ_METRICS_INTERVAL_MS,
      schedulerIntervalMs: configuration.SCHEDULER_INTERVAL_MS,
      logger: resolvedDependencies.logger,
      handler: resolvedDependencies.createMessageHandler(),
      async schedulerHandler() {
        await scheduledTasks?.reconcile();
        await processEmailOutbox();
      },
    });
    scheduledTasks = resolvedDependencies.createScheduledTasks(queues);
    await scheduledTasks.reconcile();
    await processEmailOutbox();
    emailOutboxTimer = setInterval(() => {
      void processEmailOutbox();
    }, configuration.SCHEDULER_INTERVAL_MS);
    emailOutboxTimer.unref();
  } catch (error) {
    if (queues) {
      await Promise.allSettled([queues.stop()]);
    }
    await resolvedDependencies.disconnectDatabase();
    throw error;
  }
  resolvedDependencies.logger.info(
    {
      component: "worker",
      queues: [
        "message-dispatch",
        "scheduled-tasks",
        "transactional-email-outbox",
        "dead-letter",
      ],
    },
    "Mensaly worker started",
  );

  let stopPromise: Promise<void> | undefined;

  return {
    stop() {
      if (stopPromise) {
        return stopPromise;
      }

      stopPromise = (async () => {
        if (emailOutboxTimer) {
          clearInterval(emailOutboxTimer);
          emailOutboxTimer = undefined;
        }
        const queueResult = await Promise.allSettled([queues.stop()]);
        const databaseResult = await Promise.allSettled([
          resolvedDependencies.disconnectDatabase(),
        ]);
        const failure = [...queueResult, ...databaseResult].find(
          (result) => result.status === "rejected",
        );
        if (failure?.status === "rejected") {
          throw failure.reason;
        }

        resolvedDependencies.logger.info(
          { component: "worker" },
          "Mensaly worker stopped",
        );
      })();

      return stopPromise;
    },
  };
}
