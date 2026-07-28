import {
  PrismaClient,
  type Prisma,
} from "@prisma/client";

let sharedClient: PrismaClient | undefined;

export { PrismaClient } from "@prisma/client";
export * from "@prisma/client";

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

export function getPrismaClient(): PrismaClient {
  sharedClient ??= createPrismaClient();
  return sharedClient;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (!sharedClient) {
    return;
  }

  const client = sharedClient;
  sharedClient = undefined;
  await client.$disconnect();
}

export function withTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  client: PrismaClient = getPrismaClient(),
): Promise<T> {
  return client.$transaction(operation);
}
