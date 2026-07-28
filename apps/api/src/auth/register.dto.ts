import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(12).max(128),
}).strict();

export class RegisterDto {
  static readonly schema = registerSchema;
}

export type RegisterInput = z.infer<typeof registerSchema>;
