/**
 * Formatadores e tipos de domínio do painel Mensaly.
 * Valores monetários sempre em centavos inteiros; meses de referência em YYYY-MM.
 */

export type ChargeStatus = "PENDING" | "PAID" | "CANCELLED" | "WAIVED";
export type PaymentStatus =
  | "PENDING_RECONCILIATION"
  | "CONFIRMED"
  | "REVERSED"
  | "CANCELLED";
export type PaymentMethod = "CASH" | "PIX" | "BANK_TRANSFER" | "CARD" | "OTHER";
export type MessageScheduleStatus =
  | "SCHEDULED"
  | "QUEUED"
  | "PROCESSING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED_RETRYABLE"
  | "FAILED_PERMANENT"
  | "CANCELLED";

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

export function formatDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

export function formatDateOnly(value: string): string {
  const datePart = value.slice(0, 10);
  const date = new Date(`${datePart}T12:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatReferenceMonth(value: string): string {
  const [year, month] = value.split("-");
  const labels = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${labels[Number(month) - 1]}/${year}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function currentReferenceMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
