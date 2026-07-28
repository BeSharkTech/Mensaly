import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FakeMessageAdapter,
  MessageAdapterError,
  type SendMessageInput,
} from "./fake-message.adapter";

const input: SendMessageInput = {
  idempotencyKey: "message-1",
  recipientPhone: "5511999999999",
  recipientName: "Responsável",
  body: "Mensagem de teste",
};

describe("fake message adapter", () => {
  for (const [outcome, statuses] of [
    ["SENT", ["SENT"]],
    ["DELIVERED", ["SENT", "DELIVERED"]],
    ["READ", ["SENT", "DELIVERED", "READ"]],
  ] as const) {
    it(`simulates ${outcome} and keeps the response idempotent`, async () => {
      const adapter = new FakeMessageAdapter(outcome);
      const first = await adapter.send(input);
      const repeated = await adapter.send(input);

      assert.deepEqual(first.statuses, statuses);
      assert.deepEqual(repeated, first);
      assert.match(first.providerMessageId, /^fake_[0-9a-f]{24}$/);
      assert.equal(adapter.calls, 1);
    });
  }

  it("simulates a retryable provider failure", async () => {
    const adapter = new FakeMessageAdapter("TRANSIENT_FAILURE");
    await assert.rejects(
      adapter.send(input),
      (error: unknown) =>
        error instanceof MessageAdapterError &&
        error.retryable &&
        error.code === "FAKE_TRANSIENT_FAILURE",
    );
  });

  it("simulates a permanent provider failure", async () => {
    const adapter = new FakeMessageAdapter("PERMANENT_FAILURE");
    await assert.rejects(
      adapter.send(input),
      (error: unknown) =>
        error instanceof MessageAdapterError &&
        !error.retryable &&
        error.code === "FAKE_PERMANENT_FAILURE",
    );
  });
});
