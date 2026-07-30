/**
 * Checkout de demonstração — 100% front-end, sem gateway de pagamento.
 * Os dados da cobrança são codificados no próprio token do link, então
 * o link funciona sem backend e serve apenas para testes de fluxo.
 */

export type CheckoutMethod = "PIX" | "BOLETO" | "CARD";

export type CheckoutPayload = {
  /** Nome do negócio/escola */
  business: string;
  /** Id do negócio, usado para buscar logo e cor atualizadas */
  businessId?: string;
  /** Cor da marca (hex) para personalizar o checkout */
  brandColor?: string;
  /** Nome do aluno */
  student: string;
  /** Nome do plano */
  plan: string;
  /** Valor final em centavos */
  amountCents: number;
  /** Vencimento em YYYY-MM-DD */
  dueDate: string;
  /** Mês de referência em YYYY-MM */
  referenceMonth: string;
  /** Identificador curto da cobrança */
  chargeId: string;
};

export const methodLabels: Record<CheckoutMethod, string> = {
  PIX: "Pix",
  BOLETO: "Boleto",
  CARD: "Cartão de crédito",
};

function toBase64Url(value: string) {
  const base64 =
    typeof window === "undefined"
      ? Buffer.from(value, "utf-8").toString("base64")
      : window.btoa(String.fromCharCode(...new TextEncoder().encode(value)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  if (typeof window === "undefined") {
    return Buffer.from(padded, "base64").toString("utf-8");
  }
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCheckoutToken(payload: CheckoutPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeCheckoutToken(token: string): CheckoutPayload | null {
  try {
    const parsed = JSON.parse(fromBase64Url(token)) as CheckoutPayload;
    if (!parsed || typeof parsed.amountCents !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function checkoutUrl(payload: CheckoutPayload): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/pagar/${encodeCheckoutToken(payload)}`;
}

/** Gera um código Pix copia e cola fictício, só para a tela de teste. */
export function fakePixCode(payload: CheckoutPayload): string {
  const key = encodeCheckoutToken(payload).slice(0, 24).toUpperCase();
  const amount = (payload.amountCents / 100).toFixed(2);
  return `00020126580014BR.GOV.BCB.PIX0136${key}5204000053039865802BR5913MENSALY DEMO6009SAO PAULO540${amount.length}${amount}62070503***6304DEMO`;
}

/** Gera uma linha digitável de boleto fictícia. */
export function fakeBoletoLine(payload: CheckoutPayload): string {
  const seed = payload.chargeId.replace(/\D/g, "").padEnd(20, "7");
  const digits = (start: number, length: number) => seed.slice(start, start + length).padEnd(length, "3");
  return `34191.${digits(0, 5)} ${digits(5, 5)}.${digits(10, 6)} ${digits(4, 5)}.${digits(9, 6)} 1 ${String(payload.amountCents).padStart(14, "0")}`;
}
