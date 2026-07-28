import { logger } from "@mensaly/logger";

import { startWorker } from "./worker";

async function bootstrap(): Promise<void> {
  const runtime = await startWorker();
  let stopping = false;

  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) {
      return;
    }

    stopping = true;
    logger.info({ signal }, "Mensaly worker shutdown requested");
    try {
      await runtime.stop();
    } catch (error) {
      logger.error({ error, signal }, "Mensaly worker shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

void bootstrap().catch((error: unknown) => {
  logger.error({ error }, "Mensaly worker startup failed");
  process.exitCode = 1;
});
