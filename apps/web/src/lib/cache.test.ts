import { describe, expect, it, vi } from "vitest";

import { createCacheStore } from "./cache";

describe("createCacheStore", () => {
  it("keeps the cache unhydrated when the first load fails", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("API unavailable"));
    const store = createCacheStore(loader, { session: false });

    await expect(store.ensure()).rejects.toThrow("API unavailable");
    expect(store.isLoaded()).toBe(false);
    expect(store.get()).toEqual({ session: false });
    expect(store.getError()?.message).toBe("API unavailable");
  });

  it("preserves the last successful value when revalidation fails", async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ students: 2 })
      .mockRejectedValueOnce(new Error("API unavailable"));
    const store = createCacheStore(loader, { students: 0 });

    await expect(store.ensure()).resolves.toEqual({ students: 2 });
    await expect(store.refresh()).rejects.toThrow("API unavailable");
    expect(store.isLoaded()).toBe(true);
    expect(store.get()).toEqual({ students: 2 });
  });
});
