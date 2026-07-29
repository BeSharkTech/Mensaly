import type { FastifyInstance, FastifyRequest } from "fastify";

import { getCorrelationId } from "./correlation";

type RateLimitOptions = {
  windowMs?: number;
  maxMutations?: number;
  maxSensitiveMutations?: number;
  now?: () => number;
};

type Counter = {
  count: number;
  resetAt: number;
};

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const sensitivePath =
  /^\/api\/v1\/auth\/(?:login|register|password-reset|verify-email)(?:\/|$)/;

function bucket(request: FastifyRequest): "safe" | "mutation" | "sensitive" {
  if (safeMethods.has(request.method)) {
    return "safe";
  }
  return sensitivePath.test(request.url.split("?")[0] ?? "")
    ? "sensitive"
    : "mutation";
}

export function registerLocalRateLimit(
  fastify: FastifyInstance,
  options: RateLimitOptions = {},
): void {
  const windowMs = options.windowMs ?? 60_000;
  const maxMutations = options.maxMutations ?? 120;
  const maxSensitiveMutations = options.maxSensitiveMutations ?? 20;
  const now = options.now ?? Date.now;
  const counters = new Map<string, Counter>();

  fastify.addHook("onRequest", async (request, reply) => {
    const requestBucket = bucket(request);
    if (requestBucket === "safe") {
      return;
    }
    const currentTime = now();
    const limit =
      requestBucket === "sensitive" ? maxSensitiveMutations : maxMutations;
    const key = `${request.ip}:${requestBucket}`;
    const previous = counters.get(key);
    const counter =
      !previous || previous.resetAt <= currentTime
        ? { count: 0, resetAt: currentTime + windowMs }
        : previous;
    counter.count += 1;
    counters.set(key, counter);

    const remaining = Math.max(0, limit - counter.count);
    void reply.header("X-RateLimit-Limit", limit);
    void reply.header("X-RateLimit-Remaining", remaining);
    void reply.header(
      "X-RateLimit-Reset",
      Math.ceil(counter.resetAt / 1000),
    );

    if (counter.count <= limit) {
      return;
    }

    const retryAfter = Math.max(
      1,
      Math.ceil((counter.resetAt - currentTime) / 1000),
    );
    void reply.header("Retry-After", retryAfter);
    void reply.status(429).send({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
      },
      correlationId: getCorrelationId(request),
      timestamp: new Date(currentTime).toISOString(),
      path: request.url,
    });

    if (counters.size > 10_000) {
      for (const [counterKey, value] of counters) {
        if (value.resetAt <= currentTime) {
          counters.delete(counterKey);
        }
      }
    }
  });
}
