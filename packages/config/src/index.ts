import { z } from "zod";

export const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});
