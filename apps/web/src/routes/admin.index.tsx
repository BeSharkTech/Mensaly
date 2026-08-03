import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, Server, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

type AdminAnalytics = {
  trends: Array<{
    month: string;
    newOrganizations: number;
    totalOrganizations: number;
    billedCents: number;
    receivedCents: number;
  }>;
  costs: {
    configured: boolean;
    referenceMonth: string;
    totalEstimatedCents: number;
    assumptions: {
      monthlyFixedCostCents: number;
      emailCostPerThousandCents: number;
      storageCostPerGbCents: number;
      activeOrganizations: number;
    };
    organizations: Array<{
      organizationId: string;
      organizationName: string;
      status: "ACTIVE" | "INACTIVE" | "BLOCKED";
      storageBytes: number;
      emailCount: number;
      allocatedFixedCostCents: number;
      storageCostCents: number;
      emailCostCents: number;
      estimatedTotalCents: number;
    }>;
  };
  sentry: {
    status: "ready" | "not_configured" | "unavailable";
    periodDays: number;
    totalErrors: number;
    dailyErrors: Array<{ date: string; errors: number }>;
    unresolvedIssues: Array<{
      id: string;
      title: string;
      culprit: string;
      count: number;
      level: string;
      lastSeen: string;
      permalink: string;
    }>;
    checkedAt: string;
  };
};

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Painel administrativo — Mensaly" },
      { name: "description", content: "Saúde, uso, custos e crescimento da plataforma Mensaly." },
    ],
  }),
  component: AdminOverviewPage,
});

const chartTooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  color: "var(--color-popover-foreground)",
  fontSize: "0.8rem",
};

function formatMonth(value: string) {
  const [year, month] = value.split("-");
  return `${month}/${year?.slice(-2)}`;
}

function formatBytes(value: number) {
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function compactCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

function ChartLoading() {
  return <div className="h-full w-full animate-pulse rounded-lg bg-muted/60 motion-reduce:animate-none" aria-label="Carregando gráfico" />;
}

function AdminOverviewPage() {
  const { data } = useDashboardData();
  const [platformHealth, setPlatformHealth] = useState<{
    status: "ready" | "degraded";
    dependencies: Record<string, "ready" | "unavailable">;
  } | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState(false);

  useEffect(() => {
    void Promise.all([
      apiRequest<{ status: "ready" | "degraded"; dependencies: Record<string, "ready" | "unavailable"> }>("/health/platform")
        .then(setPlatformHealth)
        .catch(() => setPlatformHealth(null)),
      apiRequest<AdminAnalytics>("/admin/analytics", { query: { days: 30, months: 6 } })
        .then((result) => {
          setAnalytics(result);
          setAnalyticsError(false);
        })
        .catch(() => setAnalyticsError(true)),
    ]);
  }, []);

  const { organizations, failures, overview } = data;
  const activeOrgs = organizations.filter((organization) => organization.status === "ACTIVE").length;
  const costRows = useMemo(
    () => [...(analytics?.costs.organizations ?? [])].sort((left, right) => right.estimatedTotalCents - left.estimatedTotalCents),
    [analytics],
  );
  const sentryStatus = analytics?.sentry.status;
  const totalOrganizations = analytics?.trends.at(-1)?.totalOrganizations ?? organizations.length;
  const totalActiveOrganizations = analytics?.costs.assumptions.activeOrganizations ?? activeOrgs;

  return (
    <AppShell variant="admin">
      <PageHeader
        title="Visão geral da plataforma"
        description="Crescimento, operação, custos estimados e erros da Mensaly."
      />

      {analyticsError ? (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Não foi possível carregar os indicadores avançados. Os dados básicos continuam disponíveis.
        </div>
      ) : null}

      <section aria-label="Indicadores principais" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Empresas" value={String(totalOrganizations)} hint={`${totalActiveOrganizations} ativas`} />
        <StatCard label="Alunos ativos" value={String(overview.activeStudents)} />
        <StatCard label="Volume gerado" value={formatCents(overview.monthlyBilledCents)} hint="Cobranças acumuladas" />
        <StatCard
          label="Custo estimado"
          value={!analytics ? "Carregando" : analytics.costs.configured ? formatCents(analytics.costs.totalEstimatedCents) : "Configurar"}
          hint={!analytics ? "Calculando estimativa" : analytics.costs.configured ? analytics.costs.referenceMonth : "Premissas ainda vazias"}
        />
        <StatCard
          label="Erros no Sentry"
          value={sentryStatus === "ready" ? String(analytics?.sentry.totalErrors ?? 0) : "—"}
          hint={!analytics ? "Consultando integração" : sentryStatus === "not_configured" ? "Integração não configurada" : sentryStatus === "unavailable" ? "Sentry indisponível" : "Últimos 30 dias"}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="card-surface p-5">
          <h2 className="text-base font-semibold text-foreground">Crescimento de empresas</h2>
          <p className="text-sm text-muted-foreground">Total acumulado e novos cadastros nos últimos 6 meses.</p>
          <div className="mt-5 h-72 w-full" aria-label="Gráfico de crescimento de empresas">
            {!analytics ? <ChartLoading /> : <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics?.trends ?? []} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={chartTooltipStyle} labelFormatter={(value) => formatMonth(String(value))} />
                <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                <Line isAnimationActive={false} type="monotone" dataKey="totalOrganizations" name="Total" stroke="var(--color-chart-1)" strokeWidth={2.5} dot={false} />
                <Line isAnimationActive={false} type="monotone" dataKey="newOrganizations" name="Novas" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>}
          </div>
        </article>

        <article className="card-surface p-5">
          <h2 className="text-base font-semibold text-foreground">Cobranças processadas</h2>
          <p className="text-sm text-muted-foreground">Valores gerados e confirmados pelas escolas.</p>
          <div className="mt-5 h-72 w-full" aria-label="Gráfico de cobranças processadas">
            {!analytics ? <ChartLoading /> : <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.trends ?? []} margin={{ left: -8, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                <YAxis tickFormatter={(value) => compactCurrency(Number(value))} tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={chartTooltipStyle} labelFormatter={(value) => formatMonth(String(value))} formatter={(value) => formatCents(Number(value))} />
                <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                <Bar isAnimationActive={false} dataKey="billedCents" name="Gerado" radius={[5, 5, 0, 0]} fill="var(--color-chart-3)" />
                <Bar isAnimationActive={false} dataKey="receivedCents" name="Recebido" radius={[5, 5, 0, 0]} fill="var(--color-chart-1)" />
              </BarChart>
            </ResponsiveContainer>}
          </div>
        </article>
      </section>

      {analytics ? (
        <table className="sr-only">
          <caption>Dados mensais dos gráficos de crescimento e cobranças</caption>
          <thead><tr><th>Mês</th><th>Empresas novas</th><th>Total de empresas</th><th>Valor gerado</th><th>Valor recebido</th></tr></thead>
          <tbody>{analytics.trends.map((item) => <tr key={item.month}><td>{item.month}</td><td>{item.newOrganizations}</td><td>{item.totalOrganizations}</td><td>{formatCents(item.billedCents)}</td><td>{formatCents(item.receivedCents)}</td></tr>)}</tbody>
        </table>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-3">
        <article className="card-surface p-5 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Erros monitorados pelo Sentry</h2>
              <p className="text-sm text-muted-foreground">Eventos aceitos por dia e principais problemas não resolvidos.</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              {sentryStatus === "ready" ? <ShieldCheck className="size-3.5 text-success" /> : <AlertTriangle className="size-3.5 text-warning" />}
              {!analytics ? "Consultando" : sentryStatus === "ready" ? "Conectado" : sentryStatus === "not_configured" ? "Configuração pendente" : "Indisponível"}
            </span>
          </div>
          <div className="mt-4 h-52 w-full" aria-label="Gráfico de erros do Sentry">
            {!analytics ? <ChartLoading /> : sentryStatus !== "ready" ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
                {sentryStatus === "not_configured" ? "Configure o acesso de leitura para visualizar os erros." : "O Sentry não respondeu. Uma nova consulta será feita ao recarregar."}
              </div>
            ) : analytics.sentry.dailyErrors.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground">Nenhum erro aceito pelo Sentry neste período.</div>
            ) : <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics?.sentry.dailyErrors ?? []} margin={{ left: -24, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Line isAnimationActive={false} type="monotone" dataKey="errors" name="Erros" stroke="var(--color-destructive)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>}
          </div>
          {analytics?.sentry.dailyErrors.length ? <p className="sr-only">Erros diários no período: {analytics.sentry.dailyErrors.map((item) => `${item.date}: ${item.errors}`).join(", ")}.</p> : null}
          {analytics?.sentry.unresolvedIssues.length ? (
            <ul className="mt-4 divide-y divide-border border-t border-border">
              {analytics.sentry.unresolvedIssues.map((issue) => (
                <li key={issue.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{issue.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{issue.count} eventos · {issue.lastSeen ? formatDateTime(issue.lastSeen) : "sem data"}</p>
                  </div>
                  {issue.permalink ? <a className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={issue.permalink} target="_blank" rel="noreferrer" aria-label={`Abrir ${issue.title} no Sentry`}><ExternalLink className="size-4" /></a> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </article>

        <article className="card-surface p-5">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Saúde da infraestrutura</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Verificação direta dos serviços essenciais.</p>
          <ul className="mt-5 space-y-3">
            {platformHealth ? Object.entries(platformHealth.dependencies).map(([name, status]) => (
              <li key={name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm">
                <span className="capitalize text-foreground">{name}</span>
                <StatusBadge status={status === "ready" ? "ACTIVE" : "FAILED_PERMANENT"} />
              </li>
            )) : <li className="py-8 text-center text-sm text-muted-foreground">Status indisponível.</li>}
          </ul>
        </article>
      </section>

      <section className="card-surface overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">Custo estimado por empresa</h2>
          <p className="text-sm text-muted-foreground">Rateio mensal da infraestrutura, e-mails e armazenamento. Não inclui taxas cobradas diretamente pela Stripe.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-5 py-3">Empresa</th><th className="px-5 py-3">Uso</th><th className="px-5 py-3">Rateio fixo</th><th className="px-5 py-3">Variável</th><th className="px-5 py-3 text-right">Total estimado</th></tr>
            </thead>
            <tbody>
              {!analytics ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">Calculando os custos por empresa...</td></tr>
              ) : !analytics.costs.configured ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">Configure as premissas de custo no ambiente da API para ativar esta estimativa.</td></tr>
              ) : costRows.map((row) => (
                <tr key={row.organizationId} className="border-t border-border hover:bg-muted/30">
                  <td className="px-5 py-3"><p className="font-medium text-foreground">{row.organizationName}</p><StatusBadge status={row.status} /></td>
                  <td className="px-5 py-3 text-muted-foreground">{formatBytes(row.storageBytes)} · {row.emailCount} e-mails</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatCents(row.allocatedFixedCostCents)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatCents(row.storageCostCents + row.emailCostCents)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-foreground">{formatCents(row.estimatedTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-surface p-5">
        <h2 className="text-base font-semibold text-foreground">Falhas internas recentes</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {failures.length === 0 ? <p className="py-6 text-sm text-muted-foreground">Nenhuma falha registrada.</p> : failures.slice(0, 6).map((failure) => (
            <article key={failure.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-muted-foreground">{failure.reference}</span><StatusBadge status={failure.retryable ? "FAILED_RETRYABLE" : "FAILED_PERMANENT"} /></div>
              <p className="mt-1 truncate text-sm font-medium text-foreground">{failure.code}</p>
              <p className="text-xs text-muted-foreground">{failure.organization} · {formatDateTime(failure.occurredAt)}</p>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
