import { z } from "zod";

export const baseEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const portSchema = z.coerce.number().int().min(1).max(65_535).default(3001);
const trustProxyHopsSchema = z.coerce.number().int().min(0).max(10).default(0);
const sessionTtlHoursSchema = z
  .coerce.number()
  .int()
  .min(1)
  .max(24 * 30)
  .default(24 * 7);
const fileMaxSizeBytesSchema = z.coerce
  .number()
  .int()
  .min(1024)
  .max(25 * 1024 * 1024)
  .default(5 * 1024 * 1024);
const storageDriverSchema = z.enum(["local", "s3"]).default("local");
// Docker Compose expands an unset `${VARIABLE:-}` to an empty string when the
// variable is listed in a container's environment. Normalize that transport
// detail back to `undefined` before validating optional provider settings.
const emptyStringToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalNonEmptyStringSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalUrlSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().url().optional(),
);
const optionalPositiveIntegerSchema = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().positive().optional(),
);
const s3EndpointSchema = z
  .string()
  .url()
  .refine((value) => usesProtocol(value, ["http:", "https:"]), {
    message: "must be an HTTP(S) URL",
  })
  .optional();
const sentrySampleRateSchema = z.coerce.number().min(0).max(1).default(0.1);
const nonNegativeCostSchema = z.coerce.number().int().min(0).max(100_000_000).default(0);
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
const schedulerIntervalMsSchema = z.coerce
  .number()
  .int()
  .min(1000)
  .max(24 * 60 * 60 * 1000)
  .default(60_000);
const schedulerLookaheadMsSchema = z.coerce
  .number()
  .int()
  .min(1000)
  .max(90 * 24 * 60 * 60 * 1000)
  .default(24 * 60 * 60 * 1000);
const bullmqPrefixSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .default("mensaly");
const fakeMessageAdapterOutcomeSchema = z
  .enum([
    "SENT",
    "DELIVERED",
    "READ",
    "TRANSIENT_FAILURE",
    "PERMANENT_FAILURE",
  ])
  .default("READ");
const booleanFlagSchema = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");
const emailDeliveryModeSchema = z.enum(["local", "resend"]).default("local");
const stripeConnectModeSchema = z.enum(["disabled", "test", "live"]).default("disabled");
const emailEncryptionKeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "must be a 32-byte base64 key").optional();

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
    TRUST_PROXY_HOPS: trustProxyHopsSchema,
    DATABASE_URL: databaseUrlSchema,
    REDIS_URL: redisUrlSchema,
    CORS_ORIGINS: corsOriginsSchema,
    AUTH_SESSION_TTL_HOURS: sessionTtlHoursSchema,
    LOCAL_STORAGE_PATH: z.string().trim().min(1).default(".local-storage"),
    FILE_MAX_SIZE_BYTES: fileMaxSizeBytesSchema,
    FILE_STORAGE_DRIVER: storageDriverSchema,
    S3_ENDPOINT: s3EndpointSchema,
    S3_REGION: z.string().trim().min(1).default("auto"),
    S3_BUCKET: z.string().trim().min(3).max(255).optional(),
    S3_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
    S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    SENTRY_DSN: optionalUrlSchema,
    SENTRY_TRACES_SAMPLE_RATE: sentrySampleRateSchema,
    SENTRY_API_BASE_URL: z.string().url().default("https://sentry.io/api/0"),
    SENTRY_API_TOKEN: optionalNonEmptyStringSchema,
    SENTRY_ORG_SLUG: optionalNonEmptyStringSchema.pipe(z.string().max(100).optional()),
    SENTRY_PROJECT_ID: optionalPositiveIntegerSchema,
    ADMIN_MONTHLY_FIXED_COST_CENTS: nonNegativeCostSchema,
    ADMIN_EMAIL_COST_PER_THOUSAND_CENTS: nonNegativeCostSchema,
    ADMIN_STORAGE_COST_PER_GB_CENTS: nonNegativeCostSchema,
    EMAIL_DELIVERY_MODE: emailDeliveryModeSchema,
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    RESEND_FROM_EMAIL: z.string().trim().email().optional(),
    RESEND_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
    WEB_APP_URL: z.string().url().default("http://localhost:5173"),
    EMAIL_ENCRYPTION_KEY: emailEncryptionKeySchema,
    STRIPE_CONNECT_MODE: stripeConnectModeSchema,
    STRIPE_SECRET_KEY: z.string().trim().min(1).optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().trim().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
    PAYMENT_LINK_SECRET: emailEncryptionKeySchema,
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
    if (environment.NODE_ENV === "production" && environment.FILE_STORAGE_DRIVER !== "s3") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FILE_STORAGE_DRIVER"],
        message: "production requires s3 storage; local disk is not allowed",
      });
    }
    if (environment.FILE_STORAGE_DRIVER === "s3") {
      for (const field of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!environment[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: "is required when FILE_STORAGE_DRIVER=s3",
          });
        }
      }
    }
    if (environment.EMAIL_DELIVERY_MODE === "resend") {
      for (const field of [
        "RESEND_API_KEY",
        "RESEND_FROM_EMAIL",
        "RESEND_WEBHOOK_SECRET",
      ] as const) {
        if (!environment[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: "is required when EMAIL_DELIVERY_MODE=resend",
          });
        }
      }
    }
    if (environment.NODE_ENV === "production" && environment.EMAIL_DELIVERY_MODE !== "resend") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_DELIVERY_MODE"],
        message: "production requires Resend email delivery",
      });
    }
    if (environment.NODE_ENV === "production" && !environment.EMAIL_ENCRYPTION_KEY) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["EMAIL_ENCRYPTION_KEY"], message: "production requires an email encryption key" });
    }
    if (environment.STRIPE_CONNECT_MODE !== "disabled") {
      for (const field of [
        "STRIPE_SECRET_KEY",
        "STRIPE_PUBLISHABLE_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "PAYMENT_LINK_SECRET",
      ] as const) {
        if (!environment[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `is required when STRIPE_CONNECT_MODE=${environment.STRIPE_CONNECT_MODE}`,
          });
        }
      }
      const expectedSecretPrefix = environment.STRIPE_CONNECT_MODE === "live" ? "sk_live_" : "sk_test_";
      const expectedPublicPrefix = environment.STRIPE_CONNECT_MODE === "live" ? "pk_live_" : "pk_test_";
      if (environment.STRIPE_SECRET_KEY && !environment.STRIPE_SECRET_KEY.startsWith(expectedSecretPrefix)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_SECRET_KEY"], message: `must start with ${expectedSecretPrefix}` });
      }
      if (environment.STRIPE_PUBLISHABLE_KEY && !environment.STRIPE_PUBLISHABLE_KEY.startsWith(expectedPublicPrefix)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_PUBLISHABLE_KEY"], message: `must start with ${expectedPublicPrefix}` });
      }
      if (environment.STRIPE_WEBHOOK_SECRET && !environment.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["STRIPE_WEBHOOK_SECRET"], message: "must start with whsec_" });
      }
    }
    if (environment.STRIPE_CONNECT_MODE === "live" && environment.NODE_ENV !== "production") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_CONNECT_MODE"],
        message: "live mode is allowed only in production",
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

export const workerEnvironmentSchema = baseEnvironmentSchema
  .extend({
    DATABASE_URL: databaseUrlSchema,
    REDIS_URL: redisUrlSchema,
    BULLMQ_PREFIX: bullmqPrefixSchema,
    BULLMQ_WORKER_CONCURRENCY: workerConcurrencySchema,
    BULLMQ_JOB_ATTEMPTS: jobAttemptsSchema,
    BULLMQ_BACKOFF_MS: jobBackoffMsSchema,
    BULLMQ_METRICS_INTERVAL_MS: metricsIntervalMsSchema,
    SCHEDULER_INTERVAL_MS: schedulerIntervalMsSchema,
    SCHEDULER_LOOKAHEAD_MS: schedulerLookaheadMsSchema,
    FAKE_MESSAGE_ADAPTER_OUTCOME: fakeMessageAdapterOutcomeSchema,
    MESSAGE_AUTOMATION_ENABLED: booleanFlagSchema,
    EMAIL_DELIVERY_MODE: emailDeliveryModeSchema,
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    RESEND_FROM_EMAIL: z.string().trim().email().optional(),
    WEB_APP_URL: z.string().url().default("http://localhost:5173"),
    EMAIL_ENCRYPTION_KEY: emailEncryptionKeySchema,
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      environment.EMAIL_DELIVERY_MODE !== "resend"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_DELIVERY_MODE"],
        message: "production requires EMAIL_DELIVERY_MODE=resend",
      });
    }
    if (environment.EMAIL_DELIVERY_MODE !== "resend") return;
    for (const field of [
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "EMAIL_ENCRYPTION_KEY",
    ] as const) {
      if (!environment[field]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "is required when EMAIL_DELIVERY_MODE=resend",
        });
      }
    }
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

export {
  validateDeploymentReadiness,
  type DeploymentReadinessReport,
  type DeploymentTarget,
} from "./deployment-readiness";
