import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  verifyPassword,
} from "./index";

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

describe("session tokens", () => {
  it("creates random bearer tokens and persists only their fixed-size digest", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    assert.notEqual(first, second);
    assert.equal(hashSessionToken(first), hashSessionToken(first));
    assert.match(hashSessionToken(first), /^[a-f0-9]{64}$/);
    assert.notEqual(hashSessionToken(first), first);
  });
});
