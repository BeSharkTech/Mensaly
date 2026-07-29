import { z } from "zod";

const MAX_PAYLOAD_DEPTH = 32;
const MAX_PAYLOAD_NODES = 10_000;

function validatePayload(
  payload: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  const pending: Array<{ depth: number; value: unknown }> = [
    { depth: 1, value: payload },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_PAYLOAD_NODES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Payload exceeds ${MAX_PAYLOAD_NODES} nodes`,
      });
      return;
    }
    if (current.depth > MAX_PAYLOAD_DEPTH) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Payload exceeds ${MAX_PAYLOAD_DEPTH} levels`,
      });
      return;
    }
    if (Array.isArray(current.value)) {
      for (const value of current.value) {
        pending.push({ depth: current.depth + 1, value });
      }
    } else if (current.value && typeof current.value === "object") {
      for (const value of Object.values(current.value)) {
        pending.push({ depth: current.depth + 1, value });
      }
    }
  }
}

const providerSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

export const receiveWebhookEventSchema = z
  .object({
    provider: providerSchema,
    externalEventId: z.string().trim().min(1).max(255),
    eventType: z.string().trim().min(1).max(160),
    payload: z.record(z.unknown()).superRefine(validatePayload),
    organizationId: z.string().uuid().optional(),
  })
  .strict();

export class ReceiveWebhookEventDto {
  static readonly schema = receiveWebhookEventSchema;
}

export type ReceiveWebhookEventInput = z.infer<
  typeof receiveWebhookEventSchema
>;

export const webhookEventListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    provider: providerSchema.optional(),
    status: z
      .enum([
        "PENDING",
        "PROCESSING",
        "PROCESSED",
        "FAILED_RETRYABLE",
        "FAILED_PERMANENT",
      ])
      .optional(),
  })
  .strict();

export type WebhookEventList = z.infer<typeof webhookEventListSchema>;
