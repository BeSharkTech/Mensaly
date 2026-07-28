import { z } from "zod";

export const baseEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const portSchema = z.coerce.number().int().min(1).max(65_535).default(3001);
const sessionTtlHoursSchema = z
  .coerce.number()
  .int()
  .min(1)
  .max(24 * 30)
  .default(24 * 7);
const workerConcurrencySchema = z.coerce.number().int().min(1).max(100).default(5);
const jobAttemptsSchema = z.coerce.number().int().min(1).max(20).default(4);
const jobBackoffMsSchema = z.coerce
  .number()
  .int()
  .min(10)
  .max(15 * 60 * 1000)
  .default(1000);
const metricsIntervalMsSchema = z.coerce
  .number()
  .int()
  .min(1000)
  .max(60 * 60 * 1000)
  .default(30_000);
const bullmqPrefixSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .default("mensaly");

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

const corsOriginsSchema = z
  .string()
  .optional()
  .transform((value, context) => {
    const origins = (value ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);

    for (const origin of origins) {
      if (origin === "*") {
        continue;
      }

      try {
        const url = new URL(origin);
        if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
          throw new Error("invalid origin");
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${origin}" must be an exact HTTP(S) origin`,
        });
      }
    }

    return origins;
  });

export const apiEnvironmentSchema = baseEnvironmentSchema
  .extend({
    API_PORT: portSchema,
    DATABASE_URL: databaseUrlSchema,
    REDIS_URL: redisUrlSchema,
    CORS_ORIGINS: corsOriginsSchema,
    AUTH_SESSION_TTL_HOURS: sessionTtlHoursSchema,
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      (environment.CORS_ORIGINS.length === 0 ||
        environment.CORS_ORIGINS.includes("*"))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGINS"],
        message:
          "production requires at least one explicit origin and does not allow *",
      });
    }
  })
  .transform((environment) => {
    if (
      environment.NODE_ENV !== "production" &&
      environment.CORS_ORIGINS.length === 0
    ) {
      return {
        ...environment,
        CORS_ORIGINS: ["http://localhost:3000"],
      };
    }

    return environment;
  });

export const workerEnvironmentSchema = baseEnvironmentSchema.extend({
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  BULLMQ_PREFIX: bullmqPrefixSchema,
  BULLMQ_WORKER_CONCURRENCY: workerConcurrencySchema,
  BULLMQ_JOB_ATTEMPTS: jobAttemptsSchema,
  BULLMQ_BACKOFF_MS: jobBackoffMsSchema,
  BULLMQ_METRICS_INTERVAL_MS: metricsIntervalMsSchema,
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
