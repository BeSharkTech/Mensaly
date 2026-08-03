import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { apiRequest } from "@/lib/api";
import { useDashboardData } from "@/lib/data";
import { formatCents, formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Painel administrativo — Mensaly" },
      {
        name: "description",
        content:
          "Visão da plataforma Mensaly: organizações ativas, receita recorrente, volume de mensagens e falhas.",
      },
      { property: "og:title", content: "Painel administrativo — Mensaly" },
      {
        property: "og:description",
        content: "Métricas da plataforma: organizações, receita e falhas.",
      },
    ],
  }),
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  const { data } = useDashboardData();
  const [platformHealth, setPlatformHealth] = useState<{
    status: "ready" | "degraded";
    dependencies: Record<string, "ready" | "unavailable">;
  } | null>(null);

  useEffect(() => {
    void apiRequest<{
      status: "ready" | "degraded";
      dependencies: Record<string, "ready" | "unavailable">;
    }>("/health/platform")
      .then(setPlatformHealth)
      .catch(() => setPlatformHealth(null));
  }, []);
  const { organizations, failures, overview, schedules } = data;
  const activeOrgs = organizations.filter((org) => org.status === "ACTIVE").length;
  const totalMessages = schedules.length;
  const failureRate = totalMessages
    ? Math.round((overview.messageFailures / totalMessages) * 1000) / 10
    : 0;

  return (
    <AppShell variant="admin">
      <PageHeader
        title="Visão geral da plataforma"
        description="Indicadores agregados das organizações."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organizações"
          value={String(organizations.length)}
          hint={`${activeOrgs} ativas`}
        />
        <StatCard label="Faturado no mês" value={formatCents(overview.monthlyBilledCents)} />
        <StatCard label="Mensagens" value={String(totalMessages)} />
        <StatCard label="Taxa de falha" value={`${failureRate}%`} hint={`${overview.messageFailures} falhas`} />
        <StatCard
          label="Infraestrutura"
          value={platformHealth?.status === "ready" ? "Operacional" : "Verificar"}
          hint={platformHealth ? Object.values(platformHealth.dependencies).every((value) => value === "ready") ? "Banco, fila e arquivos prontos" : "Há dependência indisponível" : "Status indisponível"}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card-surface p-5 lg:col-span-2">
          <h2 className="text-base font-semibold text-foreground">Volume faturado por mês</h2>
          <p className="text-sm text-muted-foreground">Somatório das cobranças (R$ mil)</p>
          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthlyEvolution} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.75rem",
                    color: "var(--color-popover-foreground)",
                    fontSize: "0.8rem",
                  }}
                />
                <Bar isAnimationActive={false} dataKey="billed" name="Faturado" radius={[6, 6, 0, 0]} fill="var(--color-chart-1)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-surface p-5">
          <h2 className="text-base font-semibold text-foreground">Falhas recentes</h2>
          <ul className="mt-4 space-y-3">
            {failures.length === 0 ? (
              <li className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma falha registrada.
              </li>
            ) : (
              failures.slice(0, 6).map((failure) => (
                <li key={failure.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{failure.reference}</span>
                    <StatusBadge status={failure.retryable ? "FAILED_RETRYABLE" : "FAILED_PERMANENT"} />
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-foreground">{failure.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {failure.organization} · {formatDateTime(failure.occurredAt)}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>

      <section className="card-surface overflow-x-auto">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">Organizações recentes</h2>
        </div>
        <table className="w-full min-w-[760px] text-sm">
          <tbody>
            {organizations.length === 0 ? (
              <tr>
                <td className="px-5 py-12 text-center text-sm text-muted-foreground">
                  Nenhuma organização cadastrada ainda.
                </td>
              </tr>
            ) : (
              organizations.map((org) => (
                <tr key={org.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-foreground">{org.name}</p>
                    <p className="text-xs text-muted-foreground">{org.owner}</p>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{org.students} alunos</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={org.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
