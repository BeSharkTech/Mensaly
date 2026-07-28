import { startWorker } from "./worker";

async function bootstrap(): Promise<void> {
  const runtime = await startWorker();
  let stopping = false;

  const stop = async () => {
    if (stopping) {
      return;
    }

    stopping = true;
    await runtime.stop();
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

void bootstrap();
