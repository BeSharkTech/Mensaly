import { z } from "zod";

export const baseEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const portSchema = z.coerce.number().int().min(1).max(65_535).default(3001);

function usesProtocol(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const databaseUrlSchema = z
  .string()
  .refine((value) => usesProtocol(value, ["postgres:", "postgresql:"]), {
    message: "must use the postgres:// or postgresql:// protocol",
  });

const redisUrlSchema = z
  .string()
  .refine((value) => usesProtocol(value, ["redis:", "rediss:"]), {
    message: "must use the redis:// or rediss:// protocol",
  });

export const apiEnvironmentSchema = baseEnvironmentSchema.extend({
  API_PORT: portSchema,
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
});

export const workerEnvironmentSchema = baseEnvironmentSchema.extend({
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function parseEnvironment<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  environment: Record<string, string | undefined>,
): z.infer<TSchema> {
  const result = schema.safeParse(environment);

  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    )
    .join("; ");

  throw new Error(`Invalid environment configuration: ${details}`);
}
