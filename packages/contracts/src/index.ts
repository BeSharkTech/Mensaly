import { z } from "zod";

export const API_VERSION = "v1" as const;

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function dataEnvelopeSchema<TSchema extends z.ZodTypeAny>(
  data: TSchema,
) {
  return z.object({ data });
}

export function paginatedEnvelopeSchema<TSchema extends z.ZodTypeAny>(
  item: TSchema,
) {
  return z.object({
    data: z.array(item),
    meta: paginationMetaSchema,
  });
}

export const errorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
  }),
  correlationId: z.string().uuid(),
  timestamp: z.string().datetime(),
  path: z.string(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export type ZodDtoConstructor = {
  new (): object;
  schema: z.ZodTypeAny;
};

export function createZodDto<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): ZodDtoConstructor {
  class ZodDto {
    static readonly schema = schema;
  }

  return ZodDto;
}
