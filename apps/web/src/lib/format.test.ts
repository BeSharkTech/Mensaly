import { describe, expect, it } from "vitest";

import { formatDateOnly } from "./format";

describe("formatDateOnly", () => {
  it("preserves the calendar date returned as a UTC database date", () => {
    expect(formatDateOnly("2014-03-11T00:00:00.000Z")).toBe("11/03/2014");
  });

  it("formats an ISO date without shifting it to the previous day", () => {
    expect(formatDateOnly("2026-07-10")).toBe("10/07/2026");
  });
});
