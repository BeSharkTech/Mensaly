import { PrismaClient } from "@prisma/client";

import { seedPlatformAdmin } from "./seed-lib";

const prisma = new PrismaClient();

async function main() {
  await seedPlatformAdmin(prisma, process.env);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
