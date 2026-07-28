import { parseEnvironment, workerEnvironmentSchema } from "@mensaly/config";
import {
  disconnectPrismaClient,
  getPrismaClient,
  type PrismaClient,
} from "@mensaly/database";

export type WorkerRuntime = {
  stop: () => Promise<void>;
};

type WorkerDependencies = {
  database: Pick<PrismaClient, "$connect">;
  disconnectDatabase: () => Promise<void>;
  log: (message: string) => void;
};

export async function startWorker(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies?: WorkerDependencies,
): Promise<WorkerRuntime> {
  parseEnvironment(workerEnvironmentSchema, environment);
  const resolvedDependencies = dependencies ?? {
    database: getPrismaClient(),
    disconnectDatabase: disconnectPrismaClient,
    log: console.info,
  };

  await resolvedDependencies.database.$connect();
  resolvedDependencies.log("Mensaly worker started");

  let stopped = false;

  return {
    async stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      await resolvedDependencies.disconnectDatabase();
    },
  };
}
