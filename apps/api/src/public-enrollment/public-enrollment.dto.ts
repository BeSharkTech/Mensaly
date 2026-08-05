import { z } from "zod";

export const publicEnrollmentFieldConfigurationSchema = z
  .object({
    studentBirthDateRequired: z.boolean().default(true),
    studentPhoneRequired: z.boolean().default(true),
    relationshipRequired: z.boolean().default(true),
    approvalMode: z.enum(["SAFE", "AUTOMATIC"]).default("SAFE"),
  })
  .strip();

export const updatePublicEnrollmentFormSchema = z
  .object({
    active: z.boolean().optional(),
    fieldConfiguration: publicEnrollmentFieldConfigurationSchema
      .partial()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one form setting is required",
  });

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => value || undefined);

const studentDocumentSchema = z
  .object({ value: z.string().trim().min(5).max(30) })
  .strict();

export const submitPublicEnrollmentSchema = z
  .object({
    student: z
      .object({
        name: z.string().trim().min(2).max(120),
        document: studentDocumentSchema,
        photoFileId: z.string().uuid(),
        birthDate: z.string().date().optional(),
        phone: optionalText(32),
      })
      .strict(),
    guardian: z
      .object({
        name: z.string().trim().min(2).max(120),
        cpf: z.string().trim().min(11).max(14),
        phone: z.string().trim().min(8).max(32),
        relationship: optionalText(80),
      })
      .strict(),
    selfResponsible: z.boolean().default(false),
    planId: z.string().uuid(),
    studentValues: z
      .record(z.string().uuid(), z.string().trim().max(500))
      .refine((values) => Object.keys(values).length <= 100, {
        message: "At most 100 custom fields are accepted",
      })
      .default({}),
    guardianValues: z
      .record(z.string().uuid(), z.string().trim().max(500))
      .refine((values) => Object.keys(values).length <= 100, {
        message: "At most 100 custom fields are accepted",
      })
      .default({}),
    privacyAccepted: z.literal(true),
    privacyNoticeVersion: z.string().trim().min(1).max(40),
    companyWebsite: z.string().max(0).default(""),
  })
  .strict();

export type PublicEnrollmentFieldConfiguration = z.infer<
  typeof publicEnrollmentFieldConfigurationSchema
>;
export type UpdatePublicEnrollmentFormInput = z.infer<
  typeof updatePublicEnrollmentFormSchema
>;
export type SubmitPublicEnrollmentInput = z.infer<
  typeof submitPublicEnrollmentSchema
>;

export const defaultPublicEnrollmentFieldConfiguration: PublicEnrollmentFieldConfiguration =
  {
    studentBirthDateRequired: true,
    studentPhoneRequired: true,
    relationshipRequired: true,
    approvalMode: "SAFE",
  };
