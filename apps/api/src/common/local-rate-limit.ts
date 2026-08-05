import { createHash } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import Redis from "ioredis";

import { getCorrelationId } from "./correlation";

export type RateLimitPolicy = {
  id: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  count: number;
  resetAt: number;
};

export interface RateLimitStore {
  consume(key: string, windowMs: number, now: number): Promise<RateLimitResult>;
  close?(): Promise<void>;
}

type RateLimitOptions = {
  store?: RateLimitStore;
  fallbackStore?: RateLimitStore;
  policies?: Partial<Record<RateLimitPolicy["id"], RateLimitPolicy>>;
  limitMultiplier?: number;
  fallbackRetryMs?: number;
  now?: () => number;
};

type Counter = {
  count: number;
  resetAt: number;
};

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const defaultPolicies = {
  login: { id: "login", limit: 10, windowMs: 15 * 60_000 },
  register: { id: "register", limit: 5, windowMs: 60 * 60_000 },
  passwordReset: {
    id: "password-reset",
    limit: 5,
    windowMs: 15 * 60_000,
  },
  emailVerification: {
    id: "email-verification",
    limit: 10,
    windowMs: 15 * 60_000,
  },
  publicForm: { id: "public-form", limit: 30, windowMs: 60_000 },
  publicEnrollmentRead: { id: "public-enrollment-read", limit: 60, windowMs: 60_000 },
  publicEnrollmentWrite: { id: "public-enrollment-write", limit: 5, windowMs: 15 * 60_000 },
  publicCheckout: { id: "public-checkout", limit: 60, windowMs: 60_000 },
  paymentIntegration: {
    id: "payment-integration",
    limit: 20,
    windowMs: 60_000,
  },
  messaging: { id: "messaging", limit: 30, windowMs: 60_000 },
  webhook: { id: "webhook", limit: 600, windowMs: 60_000 },
  mutation: { id: "mutation", limit: 120, windowMs: 60_000 },
} satisfies Record<string, RateLimitPolicy>;

const routePolicies: Array<{
  method?: string;
  path: RegExp;
  policy: keyof typeof defaultPolicies;
}> = [
  { method: "POST", path: /^\/api\/v1\/auth\/login$/, policy: "login" },
  {
    method: "POST",
    path: /^\/api\/v1\/auth\/register$/,
    policy: "register",
  },
  {
    method: "POST",
    path: /^\/api\/v1\/auth\/password-reset\/(?:request|confirm)$/,
    policy: "passwordReset",
  },
  {
    method: "POST",
    path: /^\/api\/v1\/auth\/verify-email\/(?:request|confirm)$/,
    policy: "emailVerification",
  },
  {
    method: "POST",
    path: /^\/api\/v1\/public\/forms\/[^/]+\/responses$/,
    policy: "publicForm",
  },
  {
    method: "GET",
    path: /^\/api\/v1\/public\/enrollment\/[^/]+$/,
    policy: "publicEnrollmentRead",
  },
  {
    method: "POST",
    path: /^\/api\/v1\/public\/enrollment\/[^/]+\/(?:submissions|photo)$/,
    policy: "publicEnrollmentWrite",
  },
  {
    method: "POST",
    path: /^\/api\/v1\/public\/(?:checkout\/[^/]+\/(?:session|reconcile)|mercadopago-checkout\/[^/]+\/(?:process|reconcile))$/,
    policy: "publicCheckout",
  },
  {
    path: /^\/api\/v1\/(?:payment-integrations\/(?:stripe|mercadopago)|charges\/[^/]+\/(?:checkout-link|mercadopago-checkout-link))(?:\/|$)/,
    policy: "paymentIntegration",
  },
  {
    path: /^\/api\/v1\/(?:whatsapp|broadcast-sends|message-schedules)(?:\/|$)/,
    policy: "messaging",
  },
  {
    method: "POST",
    path: /^\/api\/v1\/webhooks\/(?:resend|stripe|mercadopago)$/,
    policy: "webhook",
  },
];

function policyFor(
  request: FastifyRequest,
  overrides: RateLimitOptions["policies"],
  limitMultiplier: number,
): RateLimitPolicy | undefined {
  const path = request.url.split("?")[0] ?? request.url;
  const match = routePolicies.find(
    (entry) =>
      (!entry.method || entry.method === request.method) && entry.path.test(path),
  );
  if (safeMethods.has(request.method) && !match) {
    return undefined;
  }
  const selected = match
    ? defaultPolicies[match.policy]
    : defaultPolicies.mutation;
  const policy = overrides?.[selected.id] ?? selected;
  return { ...policy, limit: Math.max(1, Math.floor(policy.limit * limitMultiplier)) };
}

function pseudonymousClientKey(request: FastifyRequest, policyId: string): string {
  const enrollmentToken = policyId.startsWith("public-enrollment-")
    ? request.url.split("?")[0]?.split("/")[5] ?? ""
    : "";
  const clientHash = createHash("sha256")
    .update(`${request.ip}:${enrollmentToken}`)
    .digest("hex");
  return `${policyId}:${clientHash}`;
}

export class LocalRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, Counter>();

  async consume(key: string, windowMs: number, now: number): Promise<RateLimitResult> {
    const previous = this.counters.get(key);
    const counter =
      !previous || previous.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : previous;
    counter.count += 1;
    this.counters.set(key, counter);

    if (this.counters.size > 10_000) {
      for (const [counterKey, value] of this.counters) {
        if (value.resetAt <= now) {
          this.counters.delete(counterKey);
        }
      }
    }

    return counter;
  }
}

const consumeScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: Redis;

  constructor(redisUrl: string, private readonly prefix: string) {
    this.client = new Redis(redisUrl, {
      commandTimeout: 1_000,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
    });
    this.client.on("error", () => {
      // Request handling logs the transition to the local fallback without
      // exposing connection details or producing one log entry per socket error.
    });
  }

  async consume(key: string, windowMs: number, now: number): Promise<RateLimitResult> {
    const result = (await this.client.eval(
      consumeScript,
      1,
      `${this.prefix}:${key}`,
      windowMs,
    )) as [number, number];
    const count = Number(result[0]);
    const ttl = Math.max(1, Number(result[1]));
    return { count, resetAt: now + ttl };
  }

  async close(): Promise<void> {
    if (this.client.status === "end") {
      return;
    }
    await this.client.quit().catch(() => this.client.disconnect());
  }
}

export function registerRateLimit(
  fastify: FastifyInstance,
  options: RateLimitOptions = {},
): void {
  const now = options.now ?? Date.now;
  const limitMultiplier = options.limitMultiplier ?? 1;
  const fallbackRetryMs = options.fallbackRetryMs ?? 5_000;
  const primaryStore: RateLimitStore =
    options.store ?? new LocalRateLimitStore();
  const fallbackStore: RateLimitStore =
    options.fallbackStore ?? new LocalRateLimitStore();
  let fallbackActive = false;
  let primaryRetryAt = 0;

  fastify.addHook("onRequest", async (request, reply) => {
    const policy = policyFor(request, options.policies, limitMultiplier);
    if (!policy) {
      return;
    }

    const currentTime = now();
    const key = pseudonymousClientKey(request, policy.id);
    let result: RateLimitResult;
    if (fallbackActive && currentTime < primaryRetryAt) {
      result = await fallbackStore.consume(key, policy.windowMs, currentTime);
    } else {
      try {
        result = await primaryStore.consume(key, policy.windowMs, currentTime);
        if (fallbackActive) {
          fallbackActive = false;
          primaryRetryAt = 0;
          request.log.info({ event: "rate_limit.redis_recovered" }, "distributed rate limit recovered");
        }
      } catch (error) {
        result = await fallbackStore.consume(key, policy.windowMs, currentTime);
        primaryRetryAt = currentTime + fallbackRetryMs;
        if (!fallbackActive) {
          fallbackActive = true;
          request.log.warn(
            { event: "rate_limit.redis_fallback", errorName: error instanceof Error ? error.name : "unknown" },
            "distributed rate limit unavailable; local fallback enabled",
          );
        }
      }
    }

    const remaining = Math.max(0, policy.limit - result.count);
    void reply.header("X-RateLimit-Limit", policy.limit);
    void reply.header("X-RateLimit-Remaining", remaining);
    void reply.header("X-RateLimit-Reset", Math.ceil(result.resetAt / 1_000));
    void reply.header(
      "RateLimit-Policy",
      `${policy.limit};w=${Math.ceil(policy.windowMs / 1_000)};name="${policy.id}"`,
    );

    if (result.count <= policy.limit) {
      return;
    }

    const retryAfter = Math.max(
      1,
      Math.ceil((result.resetAt - currentTime) / 1_000),
    );
    void reply.header("Retry-After", retryAfter);
    void reply.status(429).send({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again later",
      },
      correlationId: getCorrelationId(request),
      timestamp: new Date(currentTime).toISOString(),
      path: request.url,
    });
  });

  fastify.addHook("onClose", async () => {
    await primaryStore.close?.();
    if (fallbackStore !== primaryStore) {
      await fallbackStore.close?.();
    }
  });
}
