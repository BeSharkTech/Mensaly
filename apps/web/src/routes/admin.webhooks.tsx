import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { reprocessWebhook, useDashboardData } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/webhooks")({
  head: () => ({
    meta: [
      { title: "Webhooks — Admin Mensaly" },
      {
        name: "description",
        content: "Caixa de entrada idempotente de webhooks, com tentativas e reprocessamento manual.",
      },
      { property: "og:title", content: "Webhooks — Admin Mensaly" },
      { property: "og:description", content: "Eventos recebidos, tentativas e reprocessamento." },
    ],
  }),
  component: AdminWebhooksPage,
});

function AdminWebhooksPage() {
  const { data } = useDashboardData();
  const events = data.webhookEvents;

  return (
    <AppShell variant="admin">
      <PageHeader
        title="Webhooks"
        description="Eventos são gravados uma única vez por provedor + id externo (idempotência)."
      />

      <div className="card-surface overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Evento</th>
              <th className="px-5 py-3 font-medium">Provedor</th>
              <th className="px-5 py-3 font-medium">Tipo</th>
              <th className="px-5 py-3 font-medium">Recebido em</th>
              <th className="px-5 py-3 font-medium">Tentativas</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  Nenhum evento de webhook recebido ainda.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {event.id.slice(0, 8)}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{event.provider}</td>
                  <td className="px-5 py-3 font-medium text-foreground">{event.eventType}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDateTime(event.receivedAt)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{event.attempts}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={event.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={event.status === "FAILED_PERMANENT" || event.status === "PROCESSED"}
                      onClick={() => {
                        void reprocessWebhook(event.id)
                          .then(() => toast.success("Webhook reprocessado."))
                          .catch((error: unknown) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Não foi possível reprocessar o webhook.",
                            ),
                          );
                      }}
                    >
                      Reprocessar
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
