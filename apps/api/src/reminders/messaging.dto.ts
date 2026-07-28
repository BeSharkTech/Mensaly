import { z } from "zod";

const idSchema = z.string().uuid();
const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(20);

export const messageScheduleStatusSchema = z.enum([
  "SCHEDULED",
  "QUEUED",
  "PROCESSING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED_RETRYABLE",
  "FAILED_PERMANENT",
  "CANCELLED",
]);

export const createMessageTemplateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    body: z.string().trim().min(1).max(4000),
    active: z.boolean().default(true),
  })
  .strict();

export const updateMessageTemplateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const messageTemplateListQuerySchema = z
  .object({
    page: pageSchema,
    pageSize: pageSizeSchema,
    active: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

export const createMessageScheduleSchema = z
  .object({
    chargeId: idSchema,
    templateId: idSchema,
    scheduledFor: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine(
    (value) => new Date(value.scheduledFor).getTime() > Date.now(),
    {
      path: ["scheduledFor"],
      message: "scheduledFor must be in the future",
    },
  );

export const messageScheduleListQuerySchema = z
  .object({
    page: pageSchema,
    pageSize: pageSizeSchema,
    status: messageScheduleStatusSchema.optional(),
    chargeId: idSchema.optional(),
  })
  .strict();

export class CreateMessageTemplateDto {
  static readonly schema = createMessageTemplateSchema;
}

export class UpdateMessageTemplateDto {
  static readonly schema = updateMessageTemplateSchema;
}

export class CreateMessageScheduleDto {
  static readonly schema = createMessageScheduleSchema;
}

export type CreateMessageTemplateInput = z.infer<
  typeof createMessageTemplateSchema
>;
export type UpdateMessageTemplateInput = z.infer<
  typeof updateMessageTemplateSchema
>;
export type MessageTemplateListQuery = z.infer<
  typeof messageTemplateListQuerySchema
>;
export type CreateMessageScheduleInput = z.infer<
  typeof createMessageScheduleSchema
>;
export type MessageScheduleListQuery = z.infer<
  typeof messageScheduleListQuerySchema
>;
