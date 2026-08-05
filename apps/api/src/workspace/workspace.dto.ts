import { z } from "zod";

const id = z.string().uuid();
const status = z.enum(["ACTIVE", "INACTIVE"]);
const image = z.string().max(2_000_000).nullable().optional();

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  priceCents: z.number().int().nonnegative().max(2_000_000_000),
  stockQuantity: z.number().int().nonnegative().max(2_000_000_000),
  imageDataUrl: image,
  status: status.default("ACTIVE"),
}).strict();
export const updateProductSchema = productSchema.partial().refine((value) => Object.keys(value).length > 0);

const eventBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  location: z.string().trim().max(160).default(""),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  priceCents: z.number().int().nonnegative().max(2_000_000_000),
  imageDataUrl: image,
  status: status.default("ACTIVE"),
}).strict();
export const eventSchema = eventBaseSchema.refine(
  (value) => !value.endsAt || new Date(value.endsAt) >= new Date(value.startsAt),
  { path: ["endsAt"], message: "End date cannot precede start date" },
);
export const updateEventSchema = eventBaseSchema.partial().refine((value) => Object.keys(value).length > 0);

const customFieldBaseSchema = z.object({
  label: z.string().trim().min(1).max(60),
  fieldType: z.enum(["TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN"]),
  subject: z.enum(["STUDENT", "GUARDIAN"]).default("STUDENT"),
  options: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  required: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().max(10_000).default(0),
  active: z.boolean().default(true),
}).strict();
export const customFieldSchema = customFieldBaseSchema.refine((value) => value.fieldType !== "SELECT" || value.options.length > 0, {
  path: ["options"],
  message: "Select fields require at least one option",
});
export const updateCustomFieldSchema = customFieldBaseSchema.partial().refine((value) => Object.keys(value).length > 0);

export const broadcastSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  targetType: z.enum(["GENERAL", "PLAN", "PRODUCT", "EVENT", "FORM"]),
  planId: id.nullable().optional(),
  productId: id.nullable().optional(),
  eventId: id.nullable().optional(),
  active: z.boolean().default(true),
  scheduledFor: z.string().datetime().nullable().optional(),
  scheduleType: z.enum(["MANUAL", "ONCE", "DAILY", "WEEKLY", "MONTHLY"]).default("MANUAL"),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  sendTime: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  repeatUntil: z.string().date().nullable().optional(),
}).strict();
export const updateBroadcastSchema = broadcastSchema.partial().refine((value) => Object.keys(value).length > 0);

export const studentValuesSchema = z.object({
  values: z.record(id, z.string().trim().max(500)),
}).strict();

export const broadcastSendSchema = z.object({
  messageId: id,
  studentIds: z.array(id).min(1).max(500),
  scheduledFor: z.string().datetime().nullable().optional(),
}).strict();

export const publicFormResponseSchema = z.object({
  cpf: z.string().trim().min(11).max(14),
  values: z.record(id, z.string().trim().max(500)),
}).strict();

export type ProductInput = z.infer<typeof productSchema>;
export type EventInput = z.infer<typeof eventSchema>;
export type CustomFieldInput = z.infer<typeof customFieldSchema>;
export type BroadcastInput = z.infer<typeof broadcastSchema>;
