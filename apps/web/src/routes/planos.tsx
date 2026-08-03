import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";
import { useDashboardData, type PlanRow } from "@/lib/data";
import { formatCents } from "@/lib/format";

export const Route = createFileRoute("/planos")({
  head: () => ({
    meta: [
      { title: "Planos — Mensaly" },
      {
        name: "description",
        content: "Planos mensais da escola, valores em reais, dia de vencimento e matrículas ativas.",
      },
      { property: "og:title", content: "Planos — Mensaly" },
      {
        property: "og:description",
        content: "Valores, dia de vencimento e matrículas por plano.",
      },
    ],
  }),
  component: PlansPage,
});

const emptyForm = { name: "", description: "", amount: "", chargeOpenDay: "1", chargeOpenTime: "00:00", dueDay: "5" };

function toCents(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed * 100);
}

function fromCents(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function PlansPage() {
  const { data, refresh } = useDashboardData();
  const plans = data.plans;

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [deleting, setDeleting] = useState<PlanRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(plan: PlanRow) {
    setEditing(plan);
    setForm({
      name: plan.name,
      description: plan.description === "Plano mensal" ? "" : plan.description,
      amount: fromCents(plan.amountCents),
      chargeOpenDay: String(plan.chargeOpenDay),
      chargeOpenTime: plan.chargeOpenTime,
      dueDay: String(plan.dueDay),
    });
    setOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Informe o nome do plano.");
      return;
    }
    const amountCents = toCents(form.amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    const dueDay = Number(form.dueDay);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      toast.error("O dia de vencimento deve ficar entre 1 e 31.");
      return;
    }
    const chargeOpenDay = Number(form.chargeOpenDay);
    if (!Number.isInteger(chargeOpenDay) || chargeOpenDay < 1 || chargeOpenDay > dueDay) {
      toast.error("O dia de abertura deve ficar entre 1 e o dia de vencimento.");
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.chargeOpenTime)) {
      toast.error("Informe o horário de abertura no formato HH:mm.");
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      amountCents,
      chargeOpenDay,
      chargeOpenTime: form.chargeOpenTime,
      dueDay,
    };
    try {
      await apiRequest(editing ? `/plans/${editing.id}` : "/plans", {
        method: editing ? "PATCH" : "POST",
        body: payload,
      });
    } catch {
      setSaving(false);
      toast.error(
        editing ? "Não foi possível atualizar o plano." : "Não foi possível salvar o plano.",
      );
      return;
    }
    setSaving(false);

    toast.success(editing ? "Plano atualizado." : "Plano cadastrado.");
    setForm(emptyForm);
    setEditing(null);
    setOpen(false);
    await refresh();
  }

  async function handleDelete() {
    if (!deleting) return;
    setRemoving(true);
    try {
      await apiRequest(`/plans/${deleting.id}`, {
        method: "PATCH",
        body: { status: "INACTIVE" },
      });
    } catch {
      setRemoving(false);
      toast.error("Não foi possível excluir o plano.");
      return;
    }
    setRemoving(false);
    toast.success("Plano excluído.");
    setDeleting(null);
    await refresh();
  }

  return (
    <AppShell>
      <PageHeader
        title="Planos"
        description="Cada plano define o valor, a abertura e o vencimento mensal das cobranças."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Novo plano
          </Button>
        }
      />

      {plans.length === 0 ? (
        <div className="card-surface p-12 text-center text-sm text-muted-foreground">
          Nenhum plano cadastrado ainda.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="card-surface flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-medium text-foreground">{plan.name}</h2>
                <div className="flex items-center gap-1">
                  <StatusBadge status={plan.status} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8" aria-label="Ações do plano">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(plan)}>
                        <Pencil className="size-4" /> Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleting(plan)}>
                        <Trash2 className="size-4" /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
              <p className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
                {formatCents(plan.amountCents)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/mês</span>
              </p>
              <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Abertura</dt>
                  <dd className="text-foreground">dia {plan.chargeOpenDay}, às {plan.chargeOpenTime}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Vencimento</dt>
                  <dd className="text-foreground">dia {plan.dueDay}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Matrículas</dt>
                  <dd className="text-foreground">{plan.enrollments}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar plano" : "Novo plano"}</DialogTitle>
              <DialogDescription>
                Defina quando a cobrança abre e quando ela vence a cada mês.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="plan-name">Nome do plano</Label>
                <Input
                  id="plan-name"
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="Adicione o nome do plano"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-description">Descrição</Label>
                <Textarea
                  id="plan-description"
                  value={form.description}
                  onChange={(event) => set("description", event.target.value)}
                  placeholder="Adicione a descrição"
                  rows={2}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="plan-amount">Valor mensal (R$)</Label>
                  <Input
                    id="plan-amount"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(event) => set("amount", event.target.value)}
                    placeholder="0,00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-open-day">Dia de abertura</Label>
                  <Input
                    id="plan-open-day"
                    type="number"
                    min={1}
                    max={31}
                    value={form.chargeOpenDay}
                    onChange={(event) => set("chargeOpenDay", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-open-time">Horário de abertura</Label>
                  <Input
                    id="plan-open-time"
                    type="time"
                    value={form.chargeOpenTime}
                    onChange={(event) => set("chargeOpenTime", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plan-due-day">Dia de vencimento</Label>
                  <Input
                    id="plan-due-day"
                    type="number"
                    min={1}
                    max={31}
                    value={form.dueDay}
                    onChange={(event) => set("dueDay", event.target.value)}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar plano"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(value) => !value && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir plano</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.enrollments
                ? `Este plano tem ${deleting.enrollments} matrícula(s) ativa(s). Elas ficarão sem plano vinculado.`
                : "Esta ação não pode ser desfeita."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={removing}
            >
              {removing ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>

      </AlertDialog>
    </AppShell>
  );
}
