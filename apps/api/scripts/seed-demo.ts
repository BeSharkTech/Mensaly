import { disconnectPrismaClient, getPrismaClient } from "@mensaly/database";

import { seedDemo } from "../src/demo/demo-seed";

async function main(): Promise<void> {
  const result = await seedDemo(getPrismaClient(), process.env);
  process.stdout.write(
    `Demo seed ready for ${result.email} in ${result.organizationId}\n`,
  );
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Demo seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(disconnectPrismaClient);
