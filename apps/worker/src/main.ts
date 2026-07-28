import { parseEnvironment, workerEnvironmentSchema } from "@mensaly/config";

parseEnvironment(workerEnvironmentSchema, process.env);

console.info("Mensaly worker started");
