import { z } from "zod";

const maxMoneyCents = 2_000_000_000;
const referenceMonth = z
  .string()
  .regex(/^(?:20\d{2}|[3-9]\d{3})-(0[1-9]|1[0-2])$/, "Use YYYY-MM with year 2000 or later");

export const generateChargesSchema = z
  .object({
    referenceMonth,
  })
  .strict();

export class GenerateChargesDto {
  static readonly schema = generateChargesSchema;
}

export type GenerateChargesInput = z.infer<typeof generateChargesSchema>;

export const createManualChargeSchema = z
  .object({
    studentId: z.string().uuid(),
    referenceMonth,
  })
  .strict();

export class CreateManualChargeDto {
  static readonly schema = createManualChargeSchema;
}

export type CreateManualChargeInput = z.infer<typeof createManualChargeSchema>;

const billingDate = z.string().date().refine((value) => Number(value.slice(0, 4)) >= 2000, {
  message: "Date must use a year from 2000 onwards",
});

export const createBillingRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    sourceType: z.enum(["PLAN", "PRODUCT", "EVENT"]),
    sourceId: z.string().uuid(),
    frequency: z.enum(["MONTHLY", "ONCE"]),
    opensOn: billingDate,
    expiresOn: billingDate,
    repeatUntil: billingDate.nullable().optional(),
    studentIds: z.array(z.string().uuid()).min(1).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresOn < value.opensOn) {
      context.addIssue({ code: "custom", path: ["expiresOn"], message: "Expiration cannot precede opening" });
    }
    if (value.frequency === "MONTHLY" && !value.repeatUntil) {
      context.addIssue({ code: "custom", path: ["repeatUntil"], message: "Monthly charges require an end date" });
    }
    if (value.repeatUntil && value.repeatUntil < value.opensOn) {
      context.addIssue({ code: "custom", path: ["repeatUntil"], message: "Recurrence cannot end before opening" });
    }
  });

export type CreateBillingRuleInput = z.infer<typeof createBillingRuleSchema>;

export const chargeListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["PENDING", "PAID", "CANCELLED", "WAIVED"]).optional(),
    referenceMonth: referenceMonth.optional(),
  })
  .strict();

export type ChargeListQuery = z.infer<typeof chargeListQuerySchema>;

export const createManualPaymentSchema = z
  .object({
    amountCents: z.number().int().positive().max(maxMoneyCents),
    method: z.enum(["CASH", "PIX", "BANK_TRANSFER", "CARD", "OTHER"]),
    paidAt: z.string().datetime(),
    externalReference: z.string().trim().min(1).max(255).optional(),
    notes: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export class CreateManualPaymentDto {
  static readonly schema = createManualPaymentSchema;
}

export type CreateManualPaymentInput = z.infer<
  typeof createManualPaymentSchema
>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    "Use letters, numbers, dots, underscores, colons, or hyphens",
  );
