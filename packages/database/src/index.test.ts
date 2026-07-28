import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PrismaClient } from "./index";

describe("database package foundation", () => {
  it("exports a Prisma client without opening a database connection", () => {
    assert.equal(typeof PrismaClient, "function");
    assert.equal(typeof PrismaClient.prototype.$connect, "function");
    assert.equal(typeof PrismaClient.prototype.$disconnect, "function");
  });
});
