import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

const forwardedRequestHeaders = [
  "accept",
  "content-type",
  "cookie",
  "idempotency-key",
  "origin",
  "user-agent",
  "x-correlation-id",
  "x-request-id",
  "x-signature",
] as const;

const forwardedResponseHeaders = [
  "cache-control",
  "content-disposition",
  "content-type",
  "location",
  "retry-after",
  "set-cookie",
  "x-correlation-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
] as const;

function apiOrigin(): URL {
  const configured = process.env.MENSALY_API_URL ?? "http://127.0.0.1:3002";
  const url = new URL(configured);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("MENSALY_API_URL must be an HTTP(S) URL");
  }
  return url;
}

function requestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientAddress =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (clientAddress) headers.set("x-forwarded-for", clientAddress);
  return headers;
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of forwardedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const target = new URL(
    `/api/v1/${path.map((segment) => encodeURIComponent(segment)).join("/")}`,
    apiOrigin(),
  );
  target.search = request.nextUrl.search;
  const hasBody = !["GET", "HEAD"].includes(request.method);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: requestHeaders(request),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
    const noBody = request.method === "HEAD" || [204, 304].includes(upstream.status);
    return new Response(noBody ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders(upstream),
    });
  } catch {
    const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();
    return Response.json(
      {
        error: {
          code: "API_UPSTREAM_UNAVAILABLE",
          message: "O serviço está temporariamente indisponível. Tente novamente.",
        },
        correlationId,
      },
      { status: 502, headers: { "cache-control": "no-store", "x-correlation-id": correlationId } },
    );
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
