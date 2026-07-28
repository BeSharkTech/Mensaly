import * as assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  createPrismaClient,
  disconnectPrismaClient,
  getPrismaClient,
  PrismaClient,
} from "./index";

describe("database client lifecycle", () => {
  afterEach(async () => {
    await disconnectPrismaClient();
  });

  it("creates an independent Prisma client on demand", async () => {
    const client = createPrismaClient();

    try {
      assert.equal(typeof client.$connect, "function");
      assert.equal(typeof client.$disconnect, "function");
      assert.equal(typeof PrismaClient, "function");
    } finally {
      await client.$disconnect();
    }
  });

  it("reuses one shared Prisma client per process", () => {
    assert.equal(getPrismaClient(), getPrismaClient());
  });

  it("can disconnect more than once safely", async () => {
    getPrismaClient();
    await disconnectPrismaClient();
    await disconnectPrismaClient();
  });
});
