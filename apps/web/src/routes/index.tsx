import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, GraduationCap, Receipt, Wallet } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useDashboardData } from "@/lib/data";
import {
  formatCents,
  formatDate,
  formatDateTime,
  formatReferenceMonth,
} from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Mensaly" },
      {
        name: "description",
        content:
          "Painel Mensaly: acompanhe mensalidades, pagamentos, matrículas e lembretes de WhatsApp da sua escola em um só lugar.",
      },
      { property: "og:title", content: "Dashboard — Mensaly" },
      {
        property: "og:description",
        content: "Visão geral de faturamento, cobranças em aberto e mensagens da sua escola.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data } = useDashboardData();
  const { overview } = data;
  const pending = data.charges.filter((charge) => charge.status === "PENDING").slice(0, 5);
  const recentPayments = data.payments.slice(0, 4);
  const failures = data.schedules.filter((message) => message.status.startsWith("FAILED"));
  const receivedShare = overview.monthlyBilledCents
    ? Math.round((overview.monthlyReceivedCents / overview.monthlyBilledCents) * 100)
    : 0;

  return (
    <AppShell>
      <PageHeader
        title="Visão geral"
        description={`Referência ${formatReferenceMonth(data.referenceMonth)} — faturamento, recebimentos e comunicação.`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/mensagens">Ver mensagens</Link>
            </Button>
            <Button asChild>
              <Link to="/cobrancas">Gerar cobranças</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Faturado no mês"
          value={formatCents(overview.monthlyBilledCents)}
          icon={<Receipt className="size-4" />}
          hint={formatReferenceMonth(data.referenceMonth)}
        />
        <StatCard
          label="Recebido no mês"
          value={formatCents(overview.monthlyReceivedCents)}
          icon={<Wallet className="size-4" />}
          hint={`${receivedShare}% do faturado`}
        />
        <StatCard
          label="Em aberto"
          value={formatCents(overview.openChargesCents)}
          icon={<AlertTriangle className="size-4" />}
          hint={`${formatCents(overview.overdueChargesCents)} vencido`}
        />
        <StatCard
          label="Alunos ativos"
          value={String(overview.activeStudents)}
          icon={<GraduationCap className="size-4" />}
          hint={`${overview.activeEnrollments} matrículas ativas`}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card-surface p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Evolução mensal</h2>
              <p className="text-sm text-muted-foreground">Faturado x recebido (em R$ mil)</p>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.monthlyEvolution} margin={{ left: -18, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="billed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="received" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-chart-3)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  stroke="var(--color-muted-foreground)"
                  fontSize={12}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.75rem",
                    color: "var(--color-popover-foreground)",
                    fontSize: "0.8rem",
                  }}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="billed"
                  name="Faturado"
                  stroke="var(--color-chart-1)"
                  fill="url(#billed)"
                  strokeWidth={2}
                />
                <Area
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="received"
                  name="Recebido"
                  stroke="var(--color-chart-3)"
                  fill="url(#received)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-surface p-5">
          <h2 className="text-base font-semibold text-foreground">Próximos vencimentos</h2>
          <ul className="mt-4 space-y-3">
            {pending.length === 0 ? (
              <li className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma cobrança em aberto.
              </li>
            ) : (
              pending.map((charge) => (
                <li key={charge.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{charge.student}</p>
                    <span className="text-sm font-semibold text-foreground">
                      {formatCents(charge.finalAmountCents)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {charge.plan} · vence {formatDate(charge.dueDate)}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="card-surface p-5">
          <h2 className="text-base font-semibold text-foreground">Pagamentos recentes</h2>
          <ul className="mt-4 space-y-3">
            {recentPayments.length === 0 ? (
              <li className="py-8 text-center text-sm text-muted-foreground">
                Nenhum pagamento registrado ainda.
              </li>
            ) : (
              recentPayments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{payment.student}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(payment.paidAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {formatCents(payment.amountCents)}
                    </p>
                    <StatusBadge status={payment.status} className="mt-1" />
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="card-surface p-5">
          <h2 className="text-base font-semibold text-foreground">Mensagens com falha</h2>
          <p className="text-sm text-muted-foreground">
            {overview.messagesDelivered} entregues · {overview.messagesQueued} na fila
          </p>
          <ul className="mt-4 space-y-3">
            {failures.length === 0 ? (
              <li className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma falha registrada.
              </li>
            ) : (
              failures.map((message) => (
                <li key={message.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{message.student}</p>
                    <StatusBadge status={message.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {message.recipient} · {message.attempts} tentativas
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </AppShell>
  );
}
