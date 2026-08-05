import { afterEach, describe, expect, it, vi } from "vitest";

import { apiEnvelopeRequest, apiRequest, ApiRequestError } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API response contracts", () => {
  it("preserves data and pagination metadata when requested as an envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ id: "charge-1" }],
            meta: { page: 1, limit: 100, total: 1, pages: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(
      apiEnvelopeRequest<Array<{ id: string }>>("/charges"),
    ).resolves.toEqual({
      data: [{ id: "charge-1" }],
      meta: { page: 1, limit: 100, total: 1, pages: 1 },
    });
  });

  it("keeps compatibility with legacy direct resources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "plan-1", name: "Mensal" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      apiRequest<{ id: string; name: string }>("/plans/plan-1"),
    ).resolves.toEqual({
      id: "plan-1",
      name: "Mensal",
    });
  });

  it("surfaces the API message and correlation id on errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: "Invalid request data" },
            correlationId: "corr-fase-0",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const error = await apiRequest("/students", {
      method: "POST",
      body: {},
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      message: "Invalid request data",
      status: 400,
      correlationId: "corr-fase-0",
    });
  });
});
