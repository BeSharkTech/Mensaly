import { z } from "zod";

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
