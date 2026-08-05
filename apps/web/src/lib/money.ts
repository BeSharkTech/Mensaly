const MAX_MONEY_CENTS = 2_000_000_000;

/** Converts a positive pt-BR currency value to the integer cents used by the API. */
export function parseBrazilianAmountToCents(value: string): number | null {
  const normalized = value.replace(/^\s*R\$\s*/i, "").trim();
  if (!normalized || !/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const [wholePart, decimalPart = ""] = normalized.split(",");
  const whole = Number(wholePart.replace(/\./g, ""));
  const decimal = Number(decimalPart.padEnd(2, "0") || "0");
  const cents = whole * 100 + decimal;
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_MONEY_CENTS
    ? cents
    : null;
}
