import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "../../app/api/v1/[...path]/route";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MENSALY_API_URL;
});

describe("runtime API proxy", () => {
  it("uses the runtime API origin and preserves the session response", async () => {
    process.env.MENSALY_API_URL = "http://api:3001";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "set-cookie": "mensaly_session=value; HttpOnly; Secure",
          "x-correlation-id": "correlation-1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("https://app.mensaly.online/api/v1/auth/login?source=test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.mensaly.online",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: JSON.stringify({ email: "owner@example.test" }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ path: ["auth", "login"] }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("mensaly_session");
    expect(response.headers.get("x-correlation-id")).toBe("correlation-1");
    const [target, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(target)).toBe("http://api:3001/api/v1/auth/login?source=test");
    expect((init?.headers as Headers).get("x-forwarded-for")).toBe("203.0.113.10");
    expect((init?.headers as Headers).get("origin")).toBe("https://app.mensaly.online");
  });

  it("returns a stable safe error when the internal API is unavailable", async () => {
    process.env.MENSALY_API_URL = "http://api:3001";
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("private detail"))));
    const request = new NextRequest("https://app.mensaly.online/api/v1/health/live");

    const response = await GET(request, {
      params: Promise.resolve({ path: ["health", "live"] }),
    });

    expect(response.status).toBe(502);
    const payload = await response.text();
    expect(JSON.parse(payload)).toMatchObject({
      error: { code: "API_UPSTREAM_UNAVAILABLE" },
    });
    expect(payload).not.toContain("private detail");
  });

  it("forwards Mercado Pago payment signature headers", async () => {
    process.env.MENSALY_API_URL = "http://api:3001";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Headers).get("x-signature")).toBe("ts=1,v1=signature");
      expect((init?.headers as Headers).get("x-request-id")).toBe("mp-request-1");
      return Response.json({ data: { status: "PROCESSED" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(
      "https://app.mensaly.online/api/v1/webhooks/mercadopago?data.id=payment-1",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": "ts=1,v1=signature",
          "x-request-id": "mp-request-1",
        },
        body: JSON.stringify({ type: "payment", data: { id: "payment-1" } }),
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ path: ["webhooks", "mercadopago"] }),
    });

    expect(response.status).toBe(200);
  });

  it("preserves the authenticated cookie and redirect on the Mercado Pago OAuth callback", async () => {
    process.env.MENSALY_API_URL = "http://api:3001";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://api:3001/api/v1/payment-integrations/mercadopago/callback?code=grant-1&state=state-1");
      expect((init?.headers as Headers).get("cookie")).toBe("mensaly_session=session-1");
      return new Response(null, {
        status: 302,
        headers: { location: "https://app.mensaly.online/onboarding?step=payments&mercadopago=connected" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(
      "https://app.mensaly.online/api/v1/payment-integrations/mercadopago/callback?code=grant-1&state=state-1",
      { headers: { cookie: "mensaly_session=session-1" } },
    );

    const response = await GET(request, {
      params: Promise.resolve({ path: ["payment-integrations", "mercadopago", "callback"] }),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("mercadopago=connected");
  });
});
