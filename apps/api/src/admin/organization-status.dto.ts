import { z } from "zod";
export const organizationStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]) }).strict();
export class OrganizationStatusDto { static readonly schema = organizationStatusSchema; }
