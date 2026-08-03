import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decryptPayload, encryptPayload } from "./index";

describe("encrypted payloads", () => {
  it("round trips without storing plaintext", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptPayload({ token: "secret-token" }, key);
    assert.equal(JSON.stringify(encrypted).includes("secret-token"), false);
    assert.deepEqual(decryptPayload(encrypted, key), { token: "secret-token" });
  });

  it("rejects tampered ciphertext", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const encrypted = encryptPayload({ token: "secret-token" }, key);
    encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -2)}AA`;
    assert.throws(() => decryptPayload(encrypted, key));
  });
});
