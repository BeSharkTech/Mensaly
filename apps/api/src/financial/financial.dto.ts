import { z } from "zod";

export const generateChargesSchema = z
  .object({
    referenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM"),
  })
  .strict();

export class GenerateChargesDto {
  static readonly schema = generateChargesSchema;
}

export type GenerateChargesInput = z.infer<typeof generateChargesSchema>;

export const chargeListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["PENDING", "PAID", "CANCELLED", "WAIVED"]).optional(),
    referenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  })
  .strict();

export type ChargeListQuery = z.infer<typeof chargeListQuerySchema>;

export const createManualPaymentSchema = z.object({ amountCents: z.number().int().positive(), method: z.enum(["CASH", "PIX", "BANK_TRANSFER", "CARD", "OTHER"]), paidAt: z.string().datetime(), externalReference: z.string().trim().max(255).optional(), notes: z.string().trim().max(1000).optional() }).strict();
export class CreateManualPaymentDto { static readonly schema = createManualPaymentSchema; }
export type CreateManualPaymentInput = z.infer<typeof createManualPaymentSchema>;
