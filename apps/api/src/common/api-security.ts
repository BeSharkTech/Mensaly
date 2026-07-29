import type { FastifyInstance } from "fastify";

import { readSessionToken } from "../auth/session-cookie";
import { getCorrelationId } from "./correlation";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function registerApiSecurity(
  fastify: FastifyInstance,
  allowedOrigins: string[],
): void {
  fastify.addHook("onRequest", async (request, reply) => {
    if (
      SAFE_METHODS.has(request.method) ||
      !readSessionToken(request.headers.cookie)
    ) {
      return;
    }

    const origin = request.headers.origin;
    const originAllowed =
      !origin ||
      allowedOrigins.includes("*") ||
      allowedOrigins.includes(origin);

    if (originAllowed) {
      return;
    }

    const correlationId = getCorrelationId(request);
    await reply.status(403).send({
      error: {
        code: "CSRF_ORIGIN_REJECTED",
        message: "The request origin is not allowed",
      },
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  });

  fastify.addHook("onSend", async (_request, reply, payload) => {
    void reply.header("cache-control", "no-store");
    void reply.header("x-content-type-options", "nosniff");
    void reply.header("x-frame-options", "DENY");
    void reply.header("referrer-policy", "no-referrer");
    return payload;
  });
}
