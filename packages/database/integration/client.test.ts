import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
  createPrismaClient,
  UserStatus,
  withTransaction,
} from "../src";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database integration tests.");
}

const databaseName = new URL(databaseUrl).pathname.slice(1);

if (databaseName !== "mensaly_test") {
  throw new Error(
    `Database integration tests refuse to use "${databaseName || "unknown"}"; expected "mensaly_test".`,
  );
}

const prisma = createPrismaClient();
const testEmailSuffix = "@client.example.test";

describe("database client integration", () => {
  it("connects to PostgreSQL and executes a query", async () => {
    const rows = await prisma.$queryRaw<Array<{ result: number }>>`
      SELECT 1 AS result
    `;

    assert.equal(rows[0]?.result, 1);
  });

  it("commits a successful transaction", async () => {
    const email = `commit-${randomUUID()}${testEmailSuffix}`;

    const userId = await withTransaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          name: "Committed user",
          email,
          status: UserStatus.ACTIVE,
        },
      });

      return user.id;
    }, prisma);

    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    assert.equal(persisted?.email, email);
  });

  it("rolls back a failed transaction", async () => {
    const email = `rollback-${randomUUID()}${testEmailSuffix}`;

    await assert.rejects(
      withTransaction(async (transaction) => {
        await transaction.user.create({
          data: { name: "Rolled-back user", email },
        });

        throw new Error("force rollback");
      }, prisma),
      /force rollback/,
    );

    assert.equal(await prisma.user.count({ where: { email } }), 0);
  });
});

after(async () => {
  await prisma.user.deleteMany({
    where: { email: { endsWith: testEmailSuffix } },
  });
  await prisma.$disconnect();
});
