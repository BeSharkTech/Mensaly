import { z } from "zod";

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
    payload: z.record(z.unknown()),
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
