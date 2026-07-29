import { z } from "zod";

export const auditListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().trim().min(1).max(120).optional(),
    entityType: z.string().trim().min(1).max(120).optional(),
    entityId: z.string().trim().min(1).max(255).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (query) =>
      !query.from ||
      !query.to ||
      new Date(query.from).getTime() <= new Date(query.to).getTime(),
    { message: "from must be earlier than or equal to to", path: ["from"] },
  );

export type AuditList = z.infer<typeof auditListSchema>;
