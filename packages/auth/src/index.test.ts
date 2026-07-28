import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashPassword, normalizeEmail, verifyPassword } from "./index";

describe("password security", () => {
  it("normalizes e-mail addresses before they are stored", () => {
    assert.equal(normalizeEmail("  OWNER@Example.TEST  "), "owner@example.test");
  });

  it("hashes and verifies passwords without retaining the original password", async () => {
    const password = "a-long-password-123";
    const hash = await hashPassword(password);

    assert.notEqual(hash, password);
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword("wrong-password", hash), false);
    assert.equal(await verifyPassword(password, "scrypt$16384$8$1$invalid$invalid"), false);
  });
});
