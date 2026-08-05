import { expect, test } from "vitest";

import { parseBrazilianAmountToCents } from "./money";

test("converts a positive Brazilian currency amount to cents", () => {
  expect(parseBrazilianAmountToCents("120,50")).toBe(12_050);
  expect(parseBrazilianAmountToCents("R$ 1.200,00")).toBe(120_000);
});

test("rejects zero and malformed manual custom amounts", () => {
  expect(parseBrazilianAmountToCents("0")).toBeNull();
  expect(parseBrazilianAmountToCents("12,345")).toBeNull();
  expect(parseBrazilianAmountToCents("abc")).toBeNull();
});
