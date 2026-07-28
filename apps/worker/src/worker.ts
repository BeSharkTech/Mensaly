import { parseEnvironment, workerEnvironmentSchema } from "@mensaly/config";

export function startWorker(environment = process.env) {
  parseEnvironment(workerEnvironmentSchema, environment);
  console.info("Mensaly worker started");
}
