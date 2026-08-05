import { randomUUID } from "node:crypto";

import { logger } from "@mensaly/logger";
import type { FastifyInstance, FastifyRequest } from "fastify";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CorrelatedRequest = FastifyRequest & {
  correlationId: string;
  requestStartedAt: number;
};

export function safeRequestPath(url: string): string {
  const pathname = url.split("?", 1)[0] ?? "/";
  return pathname.replace(
    /(\/api\/v1\/public\/(?:enrollment|checkout|mercadopago-checkout|stripe-checkout)\/)[^/]+/,
    "$1[REDACTED]",
  );
}

function requestedCorrelationId(request: FastifyRequest): string | undefined {
  const header = request.headers["x-correlation-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return value && uuidPattern.test(value) ? value : undefined;
}

export function registerRequestContext(fastify: FastifyInstance): void {
  fastify.addHook("onRequest", async (request, reply) => {
    const correlated = request as CorrelatedRequest;
    correlated.correlationId = requestedCorrelationId(request) ?? randomUUID();
    correlated.requestStartedAt = performance.now();
    request.id = correlated.correlationId;
    void reply.header("x-correlation-id", correlated.correlationId);
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const correlated = request as CorrelatedRequest;
    logger.info(
      {
        correlationId: correlated.correlationId,
        durationMs: Math.round(performance.now() - correlated.requestStartedAt),
        method: request.method,
        path: safeRequestPath(request.url),
        statusCode: reply.statusCode,
      },
      "request completed",
    );
  });
}

export function getCorrelationId(request: FastifyRequest): string {
  return (request as CorrelatedRequest).correlationId ?? randomUUID();
}
