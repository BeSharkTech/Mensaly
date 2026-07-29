import { z } from "zod";

const id = z.string().uuid();
const amount = z.number().int().positive();
const dueDay = z.number().int().min(1).max(31);

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

export const createPlanSchema = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).optional(), amountCents: amount, dueDay, frequency: z.literal("MONTHLY").default("MONTHLY") }).strict();
export const updatePlanSchema = createPlanSchema.partial().refine((value) => Object.keys(value).length > 0);
export const createStudentSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(255).optional(), phone: z.string().trim().max(32).optional(), notes: z.string().trim().max(2000).optional() }).strict();
export const updateStudentSchema = createStudentSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).refine((value) => Object.keys(value).length > 0);
export const createGuardianSchema = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(8).max(32), email: z.string().trim().email().max(255).optional(), taxId: z.string().trim().min(11).max(18).optional() }).strict();
export const updateGuardianSchema = createGuardianSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).refine((value) => Object.keys(value).length > 0);
export const createEnrollmentSchema = z.object({ studentId: id, guardianId: id, planId: id, amountCents: amount.optional(), dueDay: dueDay.optional(), discountCents: z.number().int().nonnegative().default(0), startDate: z.string().date(), endDate: z.string().date().optional() }).strict();
export const updateEnrollmentSchema = z.object({ amountCents: amount.optional(), dueDay: dueDay.optional(), discountCents: z.number().int().nonnegative().optional(), endDate: z.string().date().optional(), status: z.enum(["ACTIVE", "ENDED", "CANCELLED"]).optional() }).strict().refine((value) => Object.keys(value).length > 0);

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
