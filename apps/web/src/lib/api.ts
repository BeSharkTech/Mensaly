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

function apiOrigin() {
  if (typeof window !== "undefined") {
    // Cookies with SameSite=Lax are not shared between localhost and 127.0.0.1.
    // Keep the API on the same local host used by the page, so a session created
    // during registration is still available when the onboarding page loads.
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return `${window.location.protocol}//${window.location.hostname}:3001`;
    }
    return process.env.NEXT_PUBLIC_MENSALY_API_URL ?? "http://127.0.0.1:3001";
  }
  return process.env.MENSALY_API_URL ?? "http://localhost:3001";
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

export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
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
  return (payload?.data ?? payload) as T;
}
