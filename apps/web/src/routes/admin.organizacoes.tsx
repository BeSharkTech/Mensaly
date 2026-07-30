import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  organizationHistory,
  updateOrganizationStatus,
  useDashboardData,
} from "@/lib/data";
import { formatDate, formatDateTime } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/organizacoes")({
  head: () => ({
    meta: [
      { title: "Organizações — Admin Mensaly" },
      {
        name: "description",
        content: "Lista de escolas na plataforma, com responsável, volume de alunos e situação.",
      },
      { property: "og:title", content: "Organizações — Admin Mensaly" },
      { property: "og:description", content: "Escolas na plataforma e sua situação." },
    ],
  }),
  component: AdminOrganizationsPage,
});

function AdminOrganizationsPage() {
  const { data } = useDashboardData();
  const organizations = data.organizations;

  return (
    <AppShell variant="admin">
      <PageHeader
        title="Organizações"
        description="Ativar, inativar ou bloquear escolas. Toda mudança de status é auditada."
      />

      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou e-mail do responsável" className="pl-9" />
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Organização</th>
              <th className="px-5 py-3 font-medium">Responsável</th>
              <th className="px-5 py-3 font-medium">Alunos</th>
              <th className="px-5 py-3 font-medium">Criada em</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  Nenhuma organização cadastrada ainda.
                </td>
              </tr>
            ) : (
              organizations.map((org) => (
                <tr key={org.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-5 py-3 font-medium text-foreground">{org.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{org.owner}</td>
                  <td className="px-5 py-3 text-muted-foreground">{org.students}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(org.createdAt)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={org.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void organizationHistory(org.id)
                          .then((entries) => {
                            const history = entries
                              .map(
                                (entry) =>
                                  `${formatDateTime(entry.createdAt)} — ${entry.action} — ${entry.actor?.name ?? "Sistema"}`,
                              )
                              .join("\n");
                            window.alert(history || "Nenhum histórico registrado.");
                          })
                          .catch((error: unknown) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Não foi possível carregar o histórico.",
                            ),
                          );
                      }}
                    >
                      Histórico
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const status = window
                          .prompt("Novo status: ACTIVE, INACTIVE ou BLOCKED", org.status)
                          ?.trim()
                          .toUpperCase();
                        if (!status) return;
                        if (!["ACTIVE", "INACTIVE", "BLOCKED"].includes(status)) {
                          toast.error("Use ACTIVE, INACTIVE ou BLOCKED.");
                          return;
                        }
                        void updateOrganizationStatus(
                          org.id,
                          status as "ACTIVE" | "INACTIVE" | "BLOCKED",
                        )
                          .then(() => toast.success("Status atualizado."))
                          .catch((error: unknown) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Não foi possível atualizar o status.",
                            ),
                          );
                      }}
                    >
                      Alterar status
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
