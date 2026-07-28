import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";

import { createApiApplication } from "./app";

async function bootstrap() {
  const environment = parseEnvironment(apiEnvironmentSchema, process.env);
  const app = await createApiApplication();
  await app.listen({ host: "0.0.0.0", port: environment.API_PORT });
}

void bootstrap();
