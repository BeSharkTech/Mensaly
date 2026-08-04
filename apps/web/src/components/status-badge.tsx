import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/12 text-destructive border-destructive/25",
  info: "bg-info/12 text-info border-info/25",
  brand: "bg-primary-soft text-primary-soft-foreground border-transparent",
};

const map: Record<string, { label: string; tone: Tone }> = {
  // genéricos
  ACTIVE: { label: "Ativo", tone: "success" },
  INACTIVE: { label: "Inativo", tone: "neutral" },
  BLOCKED: { label: "Bloqueado", tone: "danger" },
  ENDED: { label: "Encerrado", tone: "neutral" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
  // cobranças
  PENDING: { label: "Em aberto", tone: "warning" },
  PAID: { label: "Pago", tone: "success" },
  WAIVED: { label: "Isento", tone: "info" },
  // pagamentos
  PENDING_RECONCILIATION: { label: "A conciliar", tone: "warning" },
  CONFIRMED: { label: "Confirmado", tone: "success" },
  REVERSED: { label: "Estornado", tone: "danger" },
  // mensagens / webhooks
  SCHEDULED: { label: "Agendada", tone: "info" },
  QUEUED: { label: "Na fila", tone: "info" },
  PROCESSING: { label: "Processando", tone: "info" },
  SENT: { label: "Enviada", tone: "brand" },
  DELIVERED: { label: "Entregue", tone: "success" },
  READ: { label: "Lida", tone: "success" },
  FAILED_RETRYABLE: { label: "Falha (retry)", tone: "warning" },
  FAILED_PERMANENT: { label: "Falha permanente", tone: "danger" },
  PROCESSED: { label: "Processado", tone: "success" },
  // arquivos
  UPLOADING: { label: "Enviando", tone: "info" },
  DELETING: { label: "Removendo", tone: "warning" },
  DELETED: { label: "Removido", tone: "neutral" },
  FAILED: { label: "Falhou", tone: "danger" },
  // métodos de pagamento
  PIX: { label: "PIX", tone: "brand" },
  CASH: { label: "Dinheiro", tone: "neutral" },
  BANK_TRANSFER: { label: "Transferência", tone: "info" },
  CARD: { label: "Cartão", tone: "info" },
  OTHER: { label: "Outro", tone: "neutral" },
  // lembretes
  BEFORE_DUE: { label: "Antes do vencimento", tone: "info" },
  ON_DUE: { label: "No vencimento", tone: "brand" },
  AFTER_DUE: { label: "Após vencimento", tone: "warning" },
  // atores
  USER: { label: "Usuário", tone: "brand" },
  SYSTEM: { label: "Sistema", tone: "neutral" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = map[status] ?? { label: status, tone: "neutral" as Tone };
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClass[entry.tone],
        className,
      )}
    >
      {entry.label}
    </span>
  );
}
