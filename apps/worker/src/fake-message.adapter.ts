import { createHash } from "node:crypto";

export type FakeMessageOutcome =
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "TRANSIENT_FAILURE"
  | "PERMANENT_FAILURE";

export type MessageDeliveryStatus = "SENT" | "DELIVERED" | "READ";

export type SendMessageInput = {
  idempotencyKey: string;
  recipientPhone: string;
  recipientName: string;
  body: string;
};

export type SendMessageResult = {
  providerMessageId: string;
  statuses: MessageDeliveryStatus[];
};

export interface MessageAdapter {
  send(input: SendMessageInput): Promise<SendMessageResult>;
}

export class MessageAdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MessageAdapterError";
  }
}

type OutcomeResolver = (
  input: SendMessageInput,
  callNumber: number,
) => FakeMessageOutcome | Promise<FakeMessageOutcome>;

function statusesFor(outcome: FakeMessageOutcome): MessageDeliveryStatus[] {
  switch (outcome) {
    case "SENT":
      return ["SENT"];
    case "DELIVERED":
      return ["SENT", "DELIVERED"];
    case "READ":
      return ["SENT", "DELIVERED", "READ"];
    default:
      return [];
  }
}

export class FakeMessageAdapter implements MessageAdapter {
  private readonly completed = new Map<string, SendMessageResult>();
  private callCount = 0;

  constructor(
    private readonly outcome: FakeMessageOutcome | OutcomeResolver = "READ",
  ) {}

  get calls(): number {
    return this.callCount;
  }

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const existing = this.completed.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    this.callCount += 1;
    const outcome =
      typeof this.outcome === "function"
        ? await this.outcome(input, this.callCount)
        : this.outcome;

    if (outcome === "TRANSIENT_FAILURE") {
      throw new MessageAdapterError(
        "Fake provider is temporarily unavailable",
        "FAKE_TRANSIENT_FAILURE",
        true,
      );
    }
    if (outcome === "PERMANENT_FAILURE") {
      throw new MessageAdapterError(
        "Fake provider rejected the message",
        "FAKE_PERMANENT_FAILURE",
        false,
      );
    }

    const result = {
      providerMessageId: `fake_${createHash("sha256")
        .update(input.idempotencyKey)
        .digest("hex")
        .slice(0, 24)}`,
      statuses: statusesFor(outcome),
    };
    this.completed.set(input.idempotencyKey, result);
    return result;
  }
}
