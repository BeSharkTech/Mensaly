import * as assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { verifyResendWebhookSignature } from "./resend-webhook.service";

const secret = "whsec_dGVzdC1zaWduaW5nLXNlY3JldA==";
const rawBody = '{"type":"email.delivered"}';
const timestamp = "1767225600";
const id = "msg_test_123";
const signature = createHmac(
  "sha256",
  Buffer.from(secret.slice(6), "base64"),
)
  .update(`${id}.${timestamp}.${rawBody}`)
  .digest("base64");

describe("Resend webhook signature", () => {
  it("accepts a current signed payload", () => {
    assert.doesNotThrow(() =>
      verifyResendWebhookSignature({
        secret,
        rawBody,
        headers: {
          id,
          timestamp,
          signature: `v1,${signature}`,
        },
        now: new Date(Number(timestamp) * 1000),
      }),
    );
  });

  it("rejects modified bodies and stale deliveries", () => {
    assert.throws(
      () =>
        verifyResendWebhookSignature({
          secret,
          rawBody: "{}",
          headers: { id, timestamp, signature: `v1,${signature}` },
          now: new Date(Number(timestamp) * 1000),
        }),
      { status: 401 },
    );
    assert.throws(
      () =>
        verifyResendWebhookSignature({
          secret,
          rawBody,
          headers: { id, timestamp, signature: `v1,${signature}` },
          now: new Date(Number(timestamp) * 1000 + 5 * 60 * 1000 + 1),
        }),
      { status: 401 },
    );
  });
});
