import { z } from "zod";

const id = z.string().uuid();
export const MAX_MONEY_CENTS = 2_000_000_000;
const amount = z.number().int().positive().max(MAX_MONEY_CENTS);
const dueDay = z.number().int().min(1).max(31);
const chargeOpenTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  message: "Charge opening time must use HH:mm (24-hour clock)",
});
const cpf = z.string().trim().min(11).max(14);
const date = z
  .string()
  .date()
  .refine((value) => Number(value.slice(0, 4)) >= 2000, {
    message: "Date must use a year from 2000 onwards",
  });

const operationalListBaseSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const operationalListSchema = operationalListBaseSchema.extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});
export const enrollmentListSchema = operationalListBaseSchema.extend({
  status: z.enum(["ACTIVE", "ENDED", "CANCELLED"]).optional(),
});
export const linkGuardianSchema = z
  .object({
    relationship: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const planFieldsSchema = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).optional(), amountCents: amount, chargeOpenDay: dueDay.default(1), chargeOpenTime: chargeOpenTime.default("00:00"), dueDay, frequency: z.literal("MONTHLY").default("MONTHLY") }).strict();
const validChargeWindow = (value: { chargeOpenDay?: number; dueDay?: number }) =>
  value.chargeOpenDay === undefined || value.dueDay === undefined || value.chargeOpenDay <= value.dueDay;
export const createPlanSchema = planFieldsSchema.refine(validChargeWindow, { path: ["chargeOpenDay"], message: "Charge opening day cannot be after due day" });
export const updatePlanSchema = planFieldsSchema
  .partial()
  .extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() })
  .refine((value) => Object.keys(value).length > 0)
  .refine(validChargeWindow, { path: ["chargeOpenDay"], message: "Charge opening day cannot be after due day" });
export const createStudentSchema = z.object({ name: z.string().trim().min(2).max(120), cpf, birthDate: z.string().date().optional(), email: z.string().trim().email().max(255).optional(), phone: z.string().trim().max(32).optional(), notes: z.string().trim().max(2000).optional() }).strict();
export const updateStudentSchema = createStudentSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).refine((value) => Object.keys(value).length > 0);
export const createGuardianSchema = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(8).max(32), email: z.string().trim().email().max(255).optional(), taxId: cpf }).strict();
export const updateGuardianSchema = createGuardianSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).refine((value) => Object.keys(value).length > 0);
export const createEnrollmentSchema = z
  .object({
    studentId: id,
    guardianId: id,
    planId: id,
    amountCents: amount.optional(),
    chargeOpenDay: dueDay.optional(),
    chargeOpenTime: chargeOpenTime.optional(),
    dueDay: dueDay.optional(),
    discountCents: z.number().int().nonnegative().max(MAX_MONEY_CENTS).default(0),
    startDate: date,
    endDate: date.optional(),
  })
  .strict()
  .refine(validChargeWindow, {
    path: ["chargeOpenDay"],
    message: "Charge opening day cannot be after due day",
  })
  .refine(
    (value) =>
      !value.endDate ||
      new Date(`${value.endDate}T00:00:00.000Z`) >=
        new Date(`${value.startDate}T00:00:00.000Z`),
    { path: ["endDate"], message: "End date cannot precede start date" },
  )
  .refine(
    (value) =>
      value.amountCents === undefined ||
      value.discountCents < value.amountCents,
    { path: ["discountCents"], message: "Discount must be lower than amount" },
  );
export const updateEnrollmentSchema = z
  .object({
    amountCents: amount.optional(),
    chargeOpenDay: dueDay.optional(),
    chargeOpenTime: chargeOpenTime.optional(),
    dueDay: dueDay.optional(),
    discountCents: z.number().int().nonnegative().max(MAX_MONEY_CENTS).optional(),
    endDate: date.optional(),
    status: z.enum(["ACTIVE", "ENDED", "CANCELLED"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0)
  .refine(validChargeWindow, { path: ["chargeOpenDay"], message: "Charge opening day cannot be after due day" });

export class CreatePlanDto { static readonly schema = createPlanSchema; }
export class UpdatePlanDto { static readonly schema = updatePlanSchema; }
export class CreateStudentDto { static readonly schema = createStudentSchema; }
export class UpdateStudentDto { static readonly schema = updateStudentSchema; }
export class CreateGuardianDto { static readonly schema = createGuardianSchema; }
export class UpdateGuardianDto { static readonly schema = updateGuardianSchema; }
export class CreateEnrollmentDto { static readonly schema = createEnrollmentSchema; }
export class UpdateEnrollmentDto { static readonly schema = updateEnrollmentSchema; }
export type CreatePlanInput = z.infer<typeof createPlanSchema>; export type UpdatePlanInput = z.infer<typeof updatePlanSchema>; export type CreateStudentInput = z.infer<typeof createStudentSchema>; export type UpdateStudentInput = z.infer<typeof updateStudentSchema>; export type CreateGuardianInput = z.infer<typeof createGuardianSchema>; export type UpdateGuardianInput = z.infer<typeof updateGuardianSchema>; export type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>; export type UpdateEnrollmentInput = z.infer<typeof updateEnrollmentSchema>;
export type OperationalListInput = z.infer<typeof operationalListSchema>;
export type EnrollmentListInput = z.infer<typeof enrollmentListSchema>;
export type LinkGuardianInput = z.infer<typeof linkGuardianSchema>;
