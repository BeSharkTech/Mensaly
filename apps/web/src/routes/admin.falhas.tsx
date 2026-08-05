import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useDashboardData } from "@/lib/data";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/admin/falhas")({
  head: () => ({
    meta: [
      { title: "Falhas — Admin Mensaly" },
      {
        name: "description",
        content:
          "Central de falhas da plataforma: mensagens, webhooks e uploads que não concluíram.",
      },
      { property: "og:title", content: "Falhas — Admin Mensaly" },
      {
        property: "og:description",
        content: "Mensagens, webhooks e uploads com falha.",
      },
    ],
  }),
  component: AdminFailuresPage,
});

function AdminFailuresPage() {
  const { data } = useDashboardData();
  const failures = data.failures;

  return (
    <AppShell variant="admin">
      <PageHeader
        title="Falhas"
        description="Falhas permanentes nunca são reenviadas automaticamente."
      />

      <div className="card-surface overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Origem</th>
              <th className="px-5 py-3 font-medium">Referência</th>
              <th className="px-5 py-3 font-medium">Organização</th>
              <th className="px-5 py-3 font-medium">Código</th>
              <th className="px-5 py-3 font-medium">Ocorrido em</th>
              <th className="px-5 py-3 font-medium">Classificação</th>
              <th className="px-5 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {failures.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-12 text-center text-sm text-muted-foreground"
                >
                  Nenhuma falha registrada.
                </td>
              </tr>
            ) : (
              failures.map((failure) => (
                <tr
                  key={failure.id}
                  className="border-b border-border last:border-0 hover:bg-muted/50"
                >
                  <td className="px-5 py-3 font-medium text-foreground">
                    {failure.type}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {failure.reference}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {failure.organization}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {failure.code}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {formatDateTime(failure.occurredAt)}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge
                      status={
                        failure.retryable
                          ? "FAILED_RETRYABLE"
                          : "FAILED_PERMANENT"
                      }
                    />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!failure.retryable}
                    >
                      Tentar novamente
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
