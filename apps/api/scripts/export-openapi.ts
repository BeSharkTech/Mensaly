import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { apiEnvironmentSchema, parseEnvironment } from "@mensaly/config";

import { createApiApplication } from "../src/app";

const outputPath = resolve(process.cwd(), "../../docs/api/openapi.v1.json");
process.env.DATABASE_URL ??= "postgresql://openapi:openapi@127.0.0.1:5432/openapi";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
const exportEnvironment = parseEnvironment(apiEnvironmentSchema, {
  NODE_ENV: "test",
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  CORS_ORIGINS: "https://openapi.invalid",
});

async function main(): Promise<void> {
  const app = await createApiApplication(exportEnvironment);
  try {
    await app.init();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/docs-json",
    });
    if (response.statusCode !== 200) {
      throw new Error(`OpenAPI export failed with HTTP ${response.statusCode}`);
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(response.json(), null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`OpenAPI v1 exported to ${outputPath}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `OpenAPI export failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
