import { z } from "zod";

const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();

const addressSchema = z.object({
  street: optionalText(160),
  number: optionalText(32),
  complement: optionalText(80),
  district: optionalText(120),
  city: optionalText(120),
  state: optionalText(64),
  postalCode: z.string().trim().regex(/^\d{5}-?\d{3}$/).optional(),
  country: optionalText(2),
}).strict();

const brandSchema = z.object({
  logoUrl: z.string().trim().url().max(2_048).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict();

const organizationFields = {
  name: z.string().trim().min(2).max(120),
  legalName: optionalText(160),
  taxId: z.string().trim().min(11).max(18),
  phone: z.string().trim().min(8).max(32),
  address: addressSchema.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  brand: brandSchema.optional(),
};

export const createOrganizationSchema = z.object(organizationFields).strict();

export const updateOrganizationSchema = z.object({
  name: organizationFields.name.optional(),
  legalName: organizationFields.legalName,
  taxId: organizationFields.taxId.optional(),
  phone: organizationFields.phone.optional(),
  address: organizationFields.address,
  timezone: organizationFields.timezone,
  brand: organizationFields.brand,
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: "At least one field must be provided",
});

export class CreateOrganizationDto {
  static readonly schema = createOrganizationSchema;
}

export class UpdateOrganizationDto {
  static readonly schema = updateOrganizationSchema;
}

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
