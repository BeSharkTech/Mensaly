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
import { MessageDispatchProcessor } from "./message-dispatch.processor";

export type WorkerRuntime = {
  stop: () => Promise<void>;
};

type WorkerDependencies = {
  database: Pick<PrismaClient, "$connect">;
  disconnectDatabase: () => Promise<void>;
  createQueueRuntime: (
    options: MessageQueueRuntimeOptions,
  ) => Promise<Pick<MessageQueueRuntime, "stop">>;
  createMessageHandler: () => MessageDispatchHandler;
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
        configuration.FAKE_MESSAGE_ADAPTER_OUTCOME,
      );
      const processor = new MessageDispatchProcessor(database, adapter);
      return {
        database,
        disconnectDatabase: disconnectPrismaClient,
        createQueueRuntime: createMessageQueueRuntime,
        createMessageHandler: () => (job) => processor.process(job.data),
        logger,
      };
    })();

  await resolvedDependencies.database.$connect();
  let queues: Pick<MessageQueueRuntime, "stop">;
  try {
    queues = await resolvedDependencies.createQueueRuntime({
      redisUrl: configuration.REDIS_URL,
      prefix: configuration.BULLMQ_PREFIX,
      concurrency: configuration.BULLMQ_WORKER_CONCURRENCY,
      attempts: configuration.BULLMQ_JOB_ATTEMPTS,
      backoffMs: configuration.BULLMQ_BACKOFF_MS,
      metricsIntervalMs: configuration.BULLMQ_METRICS_INTERVAL_MS,
      logger: resolvedDependencies.logger,
      handler: resolvedDependencies.createMessageHandler(),
    });
  } catch (error) {
    await resolvedDependencies.disconnectDatabase();
    throw error;
  }
  resolvedDependencies.logger.info(
    {
      component: "worker",
      queues: ["message-dispatch", "dead-letter"],
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
