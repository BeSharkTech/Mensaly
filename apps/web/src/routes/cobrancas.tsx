import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Copy,
  ExternalLink,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import {
  filterBillableStudents,
  toggleVisibleStudentSelection,
} from "@/lib/billing-selection";
import { type Charge, useDashboardData } from "@/lib/data";
import {
  formatCents,
  formatDateOnly,
  formatDateTime,
  formatReferenceMonth,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cobrancas")({
  head: () => ({ meta: [{ title: "Cobranças e pagamentos — Mensaly" }] }),
  component: ChargesPage,
});

type ChargeFilter = "ALL" | "OPEN" | "OVERDUE" | "PAID";
type BillingSource = "PLAN" | "PRODUCT" | "EVENT";
type BillingFrequency = "MONTHLY" | "ONCE";
type BillingRule = {
  id: string;
  name: string;
  sourceType: BillingSource;
  sourceNameSnapshot: string;
  amountCents: number;
  frequency: BillingFrequency;
  opensOn: string;
  expiresOn: string;
  repeatUntil: string | null;
  status: "ACTIVE" | "INACTIVE" | "ENDED";
  targets: Array<{ student: { id: string; name: string } }>;
  _count: { charges: number };
};

type MercadoPagoConnection = {
  status: "CONNECTED" | "NOT_CONNECTED" | "DISCONNECTED" | "ERROR" | string;
};

const todayText = () => new Date().toISOString().slice(0, 10);

function isOverdue(charge: Charge) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return charge.status === "PENDING" && new Date(charge.dueDate) < today;
}

function chargeState(charge: Charge): ChargeFilter | "OTHER" {
  if (charge.status === "PAID") return "PAID";
  if (isOverdue(charge)) return "OVERDUE";
  return charge.status === "PENDING" ? "OPEN" : "OTHER";
}

function ChargesPage() {
  const { data, refresh } = useDashboardData();
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [linkChargeId, setLinkChargeId] = useState<string | null>(null);
  const [payingChargeId, setPayingChargeId] = useState<string | null>(null);
  const [selectedCharge, setSelectedCharge] = useState<Charge | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [billingRules, setBillingRules] = useState<BillingRule[]>([]);
  const [mercadoPagoConnected, setMercadoPagoConnected] = useState(false);
  const [sourceType, setSourceType] = useState<BillingSource>("PLAN");
  const [sourceId, setSourceId] = useState("");
  const [frequency, setFrequency] = useState<BillingFrequency>("MONTHLY");
  const [ruleName, setRuleName] = useState("");
  const [opensOn, setOpensOn] = useState(todayText());
  const [expiresOn, setExpiresOn] = useState(todayText());
  const [repeatUntil, setRepeatUntil] = useState(todayText());
  const [targetPlan, setTargetPlan] = useState("ALL");
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [filter, setFilter] = useState<ChargeFilter>("ALL");
  const [planFilter, setPlanFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const visibleStudents = useMemo(
    () => filterBillableStudents(data.students, targetPlan),
    [data.students, targetPlan],
  );
  const sources = sourceType === "PLAN"
    ? data.plans.map((item) => ({ id: item.id, name: item.name, amountCents: item.amountCents }))
    : sourceType === "PRODUCT"
      ? data.products.filter((item) => item.status === "ACTIVE").map((item) => ({ id: item.id, name: item.name, amountCents: item.priceCents }))
      : data.events.filter((item) => item.status === "ACTIVE").map((item) => ({ id: item.id, name: item.name, amountCents: item.priceCents }));

  async function loadRules() {
    try { setBillingRules(await apiRequest<BillingRule[]>("/billing-rules")); }
    catch { setBillingRules([]); }
  }
  useEffect(() => {
    void loadRules();
    void apiRequest<MercadoPagoConnection>("/payment-integrations/mercadopago")
      .then((connection) => setMercadoPagoConnected(connection.status === "CONNECTED"))
      .catch(() => setMercadoPagoConnected(false));
  }, []);
  const charges = useMemo(
    () => data.charges.filter((charge) => charge.referenceMonth === data.referenceMonth),
    [data.charges, data.referenceMonth],
  );
  const filteredCharges = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return charges.filter((charge) =>
      (filter === "ALL" || chargeState(charge) === filter) &&
      (planFilter === "ALL" || charge.plan === planFilter) &&
      (!query || `${charge.student} ${charge.plan}`.toLocaleLowerCase("pt-BR").includes(query)),
    );
  }, [charges, filter, planFilter, search]);
  const totals = useMemo(() => ({
    billed: charges.filter((charge) => !["CANCELLED", "WAIVED"].includes(charge.status)).reduce((total, charge) => total + charge.finalAmountCents, 0),
    open: charges.filter((charge) => chargeState(charge) === "OPEN").reduce((total, charge) => total + charge.finalAmountCents, 0),
    overdue: charges.filter((charge) => chargeState(charge) === "OVERDUE").reduce((total, charge) => total + charge.finalAmountCents, 0),
    paid: charges.filter((charge) => charge.status === "PAID").reduce((total, charge) => total + charge.finalAmountCents, 0),
  }), [charges]);
  const options: Array<{ value: ChargeFilter; label: string; total: number }> = [
    { value: "ALL", label: "Todas", total: totals.billed },
    { value: "OPEN", label: "Em aberto", total: totals.open },
    { value: "OVERDUE", label: "Vencidas", total: totals.overdue },
    { value: "PAID", label: "Pagas", total: totals.paid },
  ];

  async function generateCharges() {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await apiRequest<{ processed: number }>("/charges/generate", {
        method: "POST",
        body: { referenceMonth: data.referenceMonth },
      });
      await refresh();
      toast.success(`${result.processed} cobrança${result.processed === 1 ? "" : "s"} processada${result.processed === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar as cobranças.");
    } finally {
      setGenerating(false);
    }
  }

  async function createManualCharge() {
    if (!studentId || creating) return;
    setCreating(true);
    try {
      const result = await apiRequest<{ charge: Charge; created: boolean }>("/charges/manual", {
        method: "POST",
        body: { studentId, referenceMonth: data.referenceMonth },
      });
      await refresh();
      setManualOpen(false);
      setStudentId("");
      setSelectedCharge(result.charge);
      toast.success(result.created ? "Cobrança criada." : "A cobrança deste mês já existia.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a cobrança.");
    } finally {
      setCreating(false);
    }
  }

  async function createRule() {
    if (!ruleName.trim() || !sourceId || selectedStudents.length === 0 || savingRule) return;
    setSavingRule(true);
    try {
      await apiRequest("/billing-rules", {
        method: "POST",
        headers: { "Idempotency-Key": `billing-rule:${crypto.randomUUID()}` },
        body: {
          name: ruleName.trim(), sourceType, sourceId, frequency, opensOn, expiresOn,
          repeatUntil: frequency === "MONTHLY" ? repeatUntil : null,
          studentIds: selectedStudents,
        },
      });
      await Promise.all([loadRules(), refresh()]);
      setRuleOpen(false);
      setRuleName(""); setSourceId(""); setSelectedStudents([]);
      toast.success("Regra de cobrança criada para os alunos selecionados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a regra.");
    } finally { setSavingRule(false); }
  }

  async function deactivateRule(id: string) {
    try {
      await apiRequest(`/billing-rules/${id}/deactivate`, { method: "POST" });
      await loadRules();
      toast.success("Regra desativada. Novas cobranças não serão geradas.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível desativar a regra."); }
  }

  async function checkout(charge: Charge, open = false) {
    if (linkChargeId || charge.status !== "PENDING") return;
    const paymentWindow = open ? window.open("about:blank", "_blank") : null;
    if (paymentWindow) paymentWindow.opener = null;
    setLinkChargeId(charge.id);
    try {
      const result = await apiRequest<{ url: string }>(`/charges/${charge.id}/mercadopago-checkout-link`, { method: "POST" });
      if (paymentWindow) paymentWindow.location.href = result.url;
      else {
        await navigator.clipboard.writeText(result.url);
        toast.success("Link de pagamento copiado.");
      }
    } catch (error) {
      paymentWindow?.close();
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o checkout.");
    } finally {
      setLinkChargeId(null);
    }
  }

  async function registerPayment() {
    if (!selectedCharge || payingChargeId) return;
    setPayingChargeId(selectedCharge.id);
    try {
      const payment = await apiRequest<{ id: string }>(`/charges/${selectedCharge.id}/payments`, {
        method: "POST",
        headers: { "Idempotency-Key": `manual:${selectedCharge.id}:${crypto.randomUUID()}` },
        body: { amountCents: selectedCharge.finalAmountCents, method: "CASH", paidAt: new Date().toISOString() },
      });
      await apiRequest(`/payments/${payment.id}/confirm`, { method: "POST" });
      await refresh();
      setSelectedCharge(null);
      setConfirmPaymentOpen(false);
      toast.success("Pagamento confirmado.");
    } catch (error) {
      await refresh();
      toast.error(error instanceof Error ? error.message : "Não foi possível registrar o pagamento.");
    } finally {
      setPayingChargeId(null);
    }
  }

  const payments = selectedCharge ? data.payments.filter((payment) => payment.chargeId === selectedCharge.id) : [];

  return <AppShell>
    <PageHeader
      title="Cobranças"
      description={`Acompanhe ${formatReferenceMonth(data.referenceMonth)} e abra cobranças individuais quando precisar.`}
      actions={<><Button variant="outline" disabled={!mercadoPagoConnected} title={mercadoPagoConnected ? undefined : "Conecte o Mercado Pago para processar cobranças."} onClick={() => void apiRequest<{ created: number }>("/billing-rules/process", { method: "POST" }).then(async (result) => { await refresh(); toast.success(`${result.created} cobrança(s) aberta(s).`); }).catch((error) => toast.error(error instanceof Error ? error.message : "Não foi possível processar as regras."))}><CalendarDays className="size-4" />Processar hoje</Button><Button disabled={!mercadoPagoConnected} title={mercadoPagoConnected ? undefined : "Conecte o Mercado Pago para criar cobranças."} onClick={() => setRuleOpen(true)}><Plus className="size-4" />Nova cobrança</Button></>}
    />
    {!mercadoPagoConnected && <section className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">Conecte sua conta do Mercado Pago em Configurações para criar ou processar cobranças.</section>}
    <section className="card-surface mb-5 p-4 sm:p-5">
      <div className="flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold">Cobranças configuradas</h2><p className="text-sm text-muted-foreground">Mensais e únicas, cada uma com seus alunos e links individuais.</p></div><span className="text-sm text-muted-foreground">{billingRules.length} regra{billingRules.length === 1 ? "" : "s"}</span></div>
      {billingRules.length === 0 ? <p className="mt-4 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Nenhuma regra criada.</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">{billingRules.map((rule) => <div key={rule.id} className="rounded-xl border bg-background p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{rule.name}</p><p className="text-sm text-muted-foreground">{rule.sourceNameSnapshot} · {rule.frequency === "MONTHLY" ? "Mensal" : "Única"}</p></div><StatusBadge status={rule.status} /></div><div className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><p className="text-xs text-muted-foreground">Valor</p>{formatCents(rule.amountCents)}</div><div><p className="text-xs text-muted-foreground">Alunos</p>{rule.targets.length}</div><div><p className="text-xs text-muted-foreground">Geradas</p>{rule._count.charges}</div></div>{rule.status === "ACTIVE" && <Button className="mt-3" size="sm" variant="outline" onClick={() => void deactivateRule(rule.id)}>Desativar</Button>}</div>)}</div>}
    </section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {options.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={cn("card-surface min-h-24 border p-4 text-left transition-colors", filter === item.value ? "border-primary ring-1 ring-primary/20" : "hover:border-primary/40")}><p className="text-sm text-muted-foreground">{item.label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatCents(item.total)}</p></button>)}
    </section>
    <section className="card-surface mt-5 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full flex-wrap gap-1 rounded-lg bg-muted p-1 lg:w-auto">{options.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={cn("min-h-10 rounded-md px-3 text-sm", filter === item.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>{item.label}</button>)}</div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto"><select aria-label="Filtrar por plano" value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="h-11 min-w-48 rounded-md border border-input bg-background px-3 text-sm"><option value="ALL">Todos os planos</option>{data.plans.map((plan) => <option key={plan.id} value={plan.name}>{plan.name}</option>)}</select><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar aluno" className="h-11 min-w-56 pl-9" /></div></div>
      </div>
      <div className="mt-5 flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold">{options.find((item) => item.value === filter)?.label} no mês</h2><p className="text-sm text-muted-foreground">Selecione uma cobrança para ver detalhes e ações.</p></div><span className="text-sm text-muted-foreground">{filteredCharges.length} cobrança{filteredCharges.length === 1 ? "" : "s"}</span></div>
      {filteredCharges.length === 0 ? <div className="mt-5 grid min-h-56 place-items-center rounded-xl border border-dashed p-8 text-center"><CircleDollarSign className="mb-3 size-8 text-muted-foreground" /><div><p className="font-medium">Nenhuma cobrança encontrada</p><p className="mt-1 text-sm text-muted-foreground">Crie uma cobrança manual ou gere as recorrentes deste mês.</p></div></div> : <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredCharges.map((charge) => <ChargeCard key={charge.id} charge={charge} paidAt={data.payments.find((payment) => payment.chargeId === charge.id && payment.status === "CONFIRMED")?.paidAt} onClick={() => setSelectedCharge(charge)} />)}</div>}
    </section>
    <Dialog open={ruleOpen} onOpenChange={setRuleOpen}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Nova cobrança</DialogTitle><DialogDescription>Configure a origem, a agenda e os alunos. Cada aluno terá sua própria cobrança e link de pagamento.</DialogDescription></DialogHeader><div className="grid gap-5 py-2">
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="rule-name">Nome da cobrança</Label><Input id="rule-name" value={ruleName} onChange={(event) => setRuleName(event.target.value)} placeholder="Ex.: Mensalidade de agosto" /></div><div className="space-y-2"><Label htmlFor="frequency">Frequência</Label><select id="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as BillingFrequency)} className="h-11 w-full rounded-md border border-input bg-background px-3"><option value="MONTHLY">Mensal</option><option value="ONCE">Única</option></select></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="source-type">Vincular a</Label><select id="source-type" value={sourceType} onChange={(event) => { setSourceType(event.target.value as BillingSource); setSourceId(""); setTargetPlan("ALL"); setSelectedStudents([]); }} className="h-11 w-full rounded-md border border-input bg-background px-3"><option value="PLAN">Plano</option><option value="PRODUCT">Produto</option><option value="EVENT">Evento</option></select></div><div className="space-y-2"><Label htmlFor="source">{sourceType === "PLAN" ? "Plano" : sourceType === "PRODUCT" ? "Produto" : "Evento"}</Label><select id="source" value={sourceId} onChange={(event) => { setSourceId(event.target.value); if (sourceType === "PLAN") setTargetPlan(event.target.value || "ALL"); setSelectedStudents([]); if (!ruleName) setRuleName(sources.find((item) => item.id === event.target.value)?.name ?? ""); }} className="h-11 w-full rounded-md border border-input bg-background px-3"><option value="">Selecione</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.name} — {formatCents(item.amountCents)}</option>)}</select></div></div>
      <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="opens">{frequency === "MONTHLY" ? "Primeira abertura" : "Data de abertura"}</Label><Input id="opens" type="date" value={opensOn} onChange={(event) => setOpensOn(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="expires">{frequency === "MONTHLY" ? "Primeira expiração" : "Data de expiração"}</Label><Input id="expires" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></div>{frequency === "MONTHLY" && <div className="space-y-2"><Label htmlFor="repeat">Repetir até</Label><Input id="repeat" type="date" value={repeatUntil} onChange={(event) => setRepeatUntil(event.target.value)} /></div>}</div>
      <div className="rounded-xl border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-medium">Selecionar alunos</p><p className="text-sm text-muted-foreground">O botão selecionar todos afeta somente o filtro atual.</p></div><div className="w-full space-y-2 sm:w-64"><Label htmlFor="target-plan">Filtrar por plano</Label><select id="target-plan" value={targetPlan} disabled={sourceType === "PLAN" && Boolean(sourceId)} onChange={(event) => setTargetPlan(event.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 disabled:cursor-not-allowed disabled:opacity-60"><option value="ALL">Todos os planos</option>{data.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div></div><div className="mt-4 flex items-center justify-between border-b pb-3"><label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" checked={visibleStudents.length > 0 && visibleStudents.every((student) => selectedStudents.includes(student.id))} onChange={(event) => setSelectedStudents((current) => toggleVisibleStudentSelection(current, visibleStudents.map((student) => student.id), event.target.checked))} className="size-4 accent-primary" /><span className="text-sm font-medium">Selecionar todos os {visibleStudents.length} alunos filtrados</span></label><span className="text-sm text-muted-foreground">{selectedStudents.length} selecionado(s)</span></div><div className="mt-2 grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">{visibleStudents.map((student) => <label key={student.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted"><input type="checkbox" checked={selectedStudents.includes(student.id)} onChange={(event) => setSelectedStudents((current) => event.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id))} className="size-4 accent-primary" /><span><span className="block text-sm">{student.name}</span><span className="block text-xs text-muted-foreground">{student.plan}</span></span></label>)}</div></div>
    </div><DialogFooter><Button variant="outline" onClick={() => setRuleOpen(false)} disabled={savingRule}>Cancelar</Button><Button onClick={() => void createRule()} disabled={savingRule || !ruleName.trim() || !sourceId || selectedStudents.length === 0}>{savingRule ? "Criando..." : `Criar para ${selectedStudents.length} aluno(s)`}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={selectedCharge !== null} onOpenChange={(open) => !open && !payingChargeId && setSelectedCharge(null)}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><div className="flex items-start justify-between gap-3 pr-7"><div><DialogTitle>{selectedCharge?.student}</DialogTitle><DialogDescription>{selectedCharge?.plan} · {selectedCharge && formatReferenceMonth(selectedCharge.referenceMonth)}</DialogDescription></div>{selectedCharge && <StatusBadge status={selectedCharge.status} />}</div></DialogHeader>{selectedCharge && <><div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-4 text-sm"><div><p className="text-muted-foreground">Valor</p><p className="mt-1 text-lg font-semibold">{formatCents(selectedCharge.finalAmountCents)}</p></div><div><p className="text-muted-foreground">Vencimento</p><p className="mt-1 font-medium">{formatDateOnly(selectedCharge.dueDate)}</p></div></div><div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" disabled={selectedCharge.status !== "PENDING" || linkChargeId === selectedCharge.id} onClick={() => void checkout(selectedCharge)}><Copy className="size-4" />Copiar link</Button><Button variant="outline" disabled={selectedCharge.status !== "PENDING" || linkChargeId === selectedCharge.id} onClick={() => void checkout(selectedCharge, true)}><ExternalLink className="size-4" />Abrir checkout</Button></div>{payments.length > 0 && <div><h3 className="text-sm font-medium">Histórico de pagamentos</h3><div className="mt-2 space-y-2">{payments.map((payment) => <div key={payment.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><div><p className="font-medium">{formatCents(payment.amountCents)}</p><p className="text-xs text-muted-foreground">{formatDateTime(payment.paidAt)}</p></div><StatusBadge status={payment.status} /></div>)}</div></div>}{selectedCharge.status === "PENDING" && <Button onClick={() => setConfirmPaymentOpen(true)} disabled={payingChargeId === selectedCharge.id}><CheckCircle2 className="size-4" />Registrar pagamento manual</Button>}</>}</DialogContent></Dialog>
    <AlertDialog open={confirmPaymentOpen} onOpenChange={(open) => !open && !payingChargeId && setConfirmPaymentOpen(false)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirmar pagamento manual</AlertDialogTitle><AlertDialogDescription>{selectedCharge ? `Confirmar o recebimento de ${formatCents(selectedCharge.finalAmountCents)} de ${selectedCharge.student}?` : ""}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={payingChargeId !== null}>Cancelar</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void registerPayment(); }} disabled={payingChargeId !== null}>{payingChargeId ? "Confirmando..." : "Confirmar pagamento"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AppShell>;
}

function ChargeCard({ charge, paidAt, onClick }: { charge: Charge; paidAt?: string; onClick: () => void }) {
  const state = chargeState(charge);
  const dateLabel = state === "PAID" ? "Pago em" : state === "OVERDUE" ? "Venceu em" : "Vence em";
  return <button type="button" onClick={onClick} className="group flex min-h-32 flex-col justify-between rounded-xl border bg-background p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-foreground">{charge.student}</p><p className="mt-0.5 text-sm text-muted-foreground">{charge.plan}</p></div><StatusBadge status={charge.status} /></div><div className="flex items-end justify-between gap-3"><div><p className="text-xs text-muted-foreground">{dateLabel}</p><p className="mt-0.5 text-sm font-medium">{formatDateOnly(paidAt ?? charge.dueDate)}</p></div><div className="flex items-center gap-2"><p className="font-semibold tabular-nums">{formatCents(charge.finalAmountCents)}</p><ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div></div></button>;
}
