import { z } from "zod";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Invalid calendar date");

export const dashboardAsOfSchema = z
  .object({
    asOf: calendarDateSchema.optional(),
  })
  .strict();

export const upcomingDueSchema = dashboardAsOfSchema.extend({
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const limitSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const evolutionSchema = z
  .object({
    asOf: calendarDateSchema.optional(),
    months: z.coerce.number().int().min(1).max(24).default(12),
  })
  .strict();

export const adminOrganizationListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).optional(),
    search: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const adminHistorySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const adminFailuresSchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const adminAnalyticsSchema = z
  .object({
    days: z.coerce.number().int().min(7).max(90).default(30),
    months: z.coerce.number().int().min(3).max(12).default(6),
  })
  .strict();
