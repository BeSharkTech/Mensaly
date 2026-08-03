export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
};

export type ApiEnvelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

function apiOrigin() {
  if (typeof window !== "undefined") {
    // Keep every browser request same-origin. Next proxies /api/v1 to the
    // configured API, avoiding CORS and cookie-domain differences between
    // localhost and 127.0.0.1 during local development.
    return process.env.NEXT_PUBLIC_MENSALY_API_URL || window.location.origin;
  }
  return process.env.MENSALY_API_URL ?? "http://127.0.0.1:3002";
}

function endpoint(path: string, query?: Record<string, unknown>) {
  const url = new URL(`/api/v1${path}`, apiOrigin());
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(
          key,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        );
      }
    }
  }
  return url.toString();
}

async function requestPayload<T>(
  path: string,
  options: ApiRequestOptions,
): Promise<T | ApiEnvelope<T>> {
  const response = await fetch(endpoint(path, options.query), {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: T;
        meta?: Record<string, unknown>;
        message?: string;
        correlationId?: string;
        error?: { message?: string; correlationId?: string };
      }
    | null;
  if (!response.ok) {
    throw new ApiRequestError(
      payload?.message ?? payload?.error?.message ?? "Não foi possível concluir a operação.",
      response.status,
      payload?.correlationId ?? payload?.error?.correlationId,
    );
  }
  return payload as T | ApiEnvelope<T>;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const payload = await requestPayload<T>(path, options);
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload
  ) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
}

export async function apiEnvelopeRequest<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const payload = await requestPayload<T>(path, options);
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload
  ) {
    return payload as ApiEnvelope<T>;
  }
  return { data: payload as T };
}
