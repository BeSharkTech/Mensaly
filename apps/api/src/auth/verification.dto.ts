import { z } from "zod";

export const emailRequestSchema = z.object({
  email: z.string().trim().email().max(255),
}).strict();

export const tokenSchema = z.object({
  token: z.string().min(32).max(128),
}).strict();

export const passwordResetSchema = tokenSchema.extend({
  password: z.string().min(12).max(128),
}).strict();

export class EmailRequestDto {
  static readonly schema = emailRequestSchema;
}

export class TokenDto {
  static readonly schema = tokenSchema;
}

export class PasswordResetDto {
  static readonly schema = passwordResetSchema;
}
