import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/api";
import { useDashboardData, type Charge, type Student } from "@/lib/data";
import { formatCents, formatDate, formatReferenceMonth } from "@/lib/format";

export const Route = createFileRoute("/alunos")({
  head: () => ({
    meta: [
      { title: "Alunos e responsáveis — Mensaly" },
      {
        name: "description",
        content:
          "Cadastro de alunos com o responsável financeiro vinculado, plano e situação da matrícula.",
      },
      { property: "og:title", content: "Alunos e responsáveis — Mensaly" },
      {
        property: "og:description",
        content: "Cadastre alunos junto com os dados do responsável.",
      },
    ],
  }),
  component: StudentsPage,
});

const NO_PLAN = "__none__";
const NEW_GUARDIAN = "__new__";

const emptyForm = {
  studentName: "",
  birthDate: "",
  planId: NO_PLAN,
  guardianId: NEW_GUARDIAN,
  guardianName: "",
  guardianPhone: "",
  guardianEmail: "",
};

function StudentsPage() {
  const { data, refresh } = useDashboardData();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [removing, setRemoving] = useState(false);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [confirmingCharge, setConfirmingCharge] = useState<
    { charge: Charge; student: Student } | null
  >(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  const activeFields = useMemo(
    () => data.customFields.filter((field) => field.active),
    [data.customFields],
  );

  /** Cobrança mais relevante por aluno: a pendente mais antiga, senão a mais recente. */
  const chargeByStudent = useMemo(() => {
    const map = new Map<string, Charge>();
    data.charges.forEach((charge) => {
      if (!charge.studentId || charge.status === "CANCELLED") return;
      const current = map.get(charge.studentId);
      if (!current) {
        map.set(charge.studentId, charge);
        return;
      }
      const currentPending = current.status === "PENDING";
      const nextPending = charge.status === "PENDING";
      if (nextPending && !currentPending) {
        map.set(charge.studentId, charge);
      } else if (nextPending === currentPending) {
        const better = nextPending
          ? charge.dueDate < current.dueDate
          : charge.dueDate > current.dueDate;
        if (better) map.set(charge.studentId, charge);
      }
    });
    return map;
  }, [data.charges]);

  async function confirmCashPayment() {
    if (!confirmingCharge) return;
    const { charge } = confirmingCharge;
    setConfirmingPayment(true);
    try {
      const paidAt = new Date().toISOString();
      const payment = await apiRequest<{ id: string }>(`/charges/${charge.id}/payments`, {
        method: "POST",
        headers: { "Idempotency-Key": `cash:${charge.id}:${Date.now()}` },
        body: {
          amountCents: charge.finalAmountCents,
          method: "CASH",
          paidAt,
        },
      });
      await apiRequest(`/payments/${payment.id}/confirm`, { method: "POST" });
      toast.success("Pagamento em dinheiro confirmado.");
      setConfirmingCharge(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível confirmar o pagamento.",
      );
    } finally {
      setConfirmingPayment(false);
    }
  }


  const setExtra = (fieldId: string, value: string) =>
    setExtras((prev) => ({ ...prev, [fieldId]: value }));

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));


  const term = query.trim().toLowerCase();
  const students = useMemo(
    () =>
      data.students.filter(
        (student) =>
          !term ||
          student.name.toLowerCase().includes(term) ||
          student.guardian.toLowerCase().includes(term),
      ),
    [data.students, term],
  );
  const guardians = useMemo(
    () =>
      data.guardians.filter(
        (guardian) =>
          !term ||
          guardian.name.toLowerCase().includes(term) ||
          guardian.email.toLowerCase().includes(term) ||
          guardian.phone.toLowerCase().includes(term),
      ),
    [data.guardians, term],
  );

  const newGuardian = form.guardianId === NEW_GUARDIAN;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setExtras({});
    setOpen(true);
  }

  function openEdit(student: Student) {
    setEditing(student);
    setForm({
      ...emptyForm,
      studentName: student.name,
      birthDate: student.birthDate ?? "",
      planId: student.planId ?? NO_PLAN,
      guardianId: student.guardianId ?? NEW_GUARDIAN,
    });
    setExtras({ ...(data.studentFieldValues[student.id] ?? {}) });
    setOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.studentName.trim()) {
      toast.error("Informe o nome do aluno.");
      return;
    }
    if (newGuardian && !form.guardianName.trim()) {
      toast.error("Informe o nome do responsável.");
      return;
    }
    if (newGuardian && !form.guardianPhone.trim()) {
      toast.error("Informe o WhatsApp do responsável.");
      return;
    }
    const missing = activeFields.find(
      (field) => field.required && !(extras[field.id] ?? "").trim(),
    );
    if (missing) {
      toast.error(`Preencha o campo obrigatório “${missing.label}”.`);
      return;
    }



    setSaving(true);
    try {
      let guardianId = newGuardian ? null : form.guardianId;

      if (newGuardian) {
        const created = await apiRequest<{ id: string }>("/guardians", {
          method: "POST",
          body: {
            name: form.guardianName.trim().slice(0, 120),
            phone: form.guardianPhone.trim().slice(0, 40),
            ...(form.guardianEmail.trim()
              ? { email: form.guardianEmail.trim().slice(0, 255) }
              : {}),
          },
        });
        guardianId = created.id;
      }

      let studentId = editing?.id;

      if (editing) {
        await apiRequest(`/students/${editing.id}`, {
          method: "PATCH",
          body: {
            name: form.studentName.trim().slice(0, 120),
            ...(form.birthDate ? { birthDate: form.birthDate } : {}),
          },
        });
      } else {
        const student = await apiRequest<{ id: string }>("/students", {
          method: "POST",
          body: {
            name: form.studentName.trim().slice(0, 120),
            ...(form.birthDate ? { birthDate: form.birthDate } : {}),
          },
        });
        studentId = student.id;
      }

      if (!studentId || !guardianId) throw new Error("Aluno ou responsável inválido.");
      await apiRequest(`/students/${studentId}/guardians/${guardianId}`, {
        method: "POST",
        body: { relationship: "Responsável financeiro" },
      });

      const currentPlanId = editing?.planId ?? null;
      const nextPlanId = form.planId === NO_PLAN ? null : form.planId;
      const enrollmentChanged =
        nextPlanId !== currentPlanId || guardianId !== (editing?.guardianId ?? null);

      if (enrollmentChanged) {
        if (editing?.enrollmentId) {
          await apiRequest(`/enrollments/${editing.enrollmentId}`, {
            method: "PATCH",
            body: { status: "CANCELLED" },
          });
        }
        if (nextPlanId) {
          await apiRequest("/enrollments", {
            method: "POST",
            body: {
              studentId,
              guardianId,
              planId: nextPlanId,
              startDate: new Date().toISOString().slice(0, 10),
              discountCents: 0,
            },
          });
        }
      }

      await apiRequest(`/workspace/student-field-values/${studentId}`, {
        method: "PATCH",
        body: {
          values: Object.fromEntries(
            activeFields
              .map((field) => [field.id, (extras[field.id] ?? "").trim().slice(0, 500)])
              .filter(([, value]) => value.length > 0),
          ),
        },
      });

      toast.success(editing ? "Aluno atualizado." : "Aluno cadastrado.");
      setForm(emptyForm);
      setExtras({});

      setEditing(null);
      setOpen(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setRemoving(true);
    try {
      if (deleting.enrollmentId) {
        await apiRequest(`/enrollments/${deleting.enrollmentId}`, {
          method: "PATCH",
          body: { status: "CANCELLED" },
        });
      }
      await apiRequest(`/students/${deleting.id}`, {
        method: "PATCH",
        body: { status: "INACTIVE" },
      });
      toast.success("Aluno excluído.");
      setDeleting(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Alunos e responsáveis"
        description="Cadastre o aluno junto com os dados do responsável financeiro."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Novo aluno
          </Button>
        }
      />

      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por aluno, responsável, e-mail ou telefone"
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <Tabs defaultValue="alunos">
        <TabsList>
          <TabsTrigger value="alunos">Alunos ({data.students.length})</TabsTrigger>
          <TabsTrigger value="responsaveis">
            Responsáveis ({data.guardians.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alunos" className="mt-4">
          <div className="card-surface overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Aluno</th>
                  <th className="px-5 py-3 font-medium">Nascimento</th>
                  <th className="px-5 py-3 font-medium">Responsável</th>
                  <th className="px-5 py-3 font-medium">Plano</th>
                  <th className="px-5 py-3 font-medium">Pagamento</th>
                  <th className="px-5 py-3 font-medium">Situação</th>
                  <th className="w-12 px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {students.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">
                      Nenhum aluno cadastrado ainda.
                    </td>
                  </tr>
                ) : (
                  students.map((student) => {
                    const charge = chargeByStudent.get(student.id) ?? null;
                    const overdue =
                      charge?.status === "PENDING" &&
                      charge.dueDate < new Date().toISOString().slice(0, 10);
                    return (
                    <tr
                      key={student.id}
                      className="border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-5 py-3 font-medium text-foreground">{student.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {student.birthDate ? formatDate(student.birthDate) : "—"}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{student.guardian}</td>
                      <td className="px-5 py-3 text-muted-foreground">{student.plan}</td>
                      <td className="px-5 py-3">
                        {charge ? (
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={charge.status} className="w-fit" />
                            <span className="text-xs text-muted-foreground">
                              {formatReferenceMonth(charge.referenceMonth)} ·{" "}
                              {formatCents(charge.finalAmountCents)}
                              {overdue ? " · vencida" : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sem cobrança</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={student.status} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label={`Ações de ${student.name}`}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {charge && charge.status === "PENDING" ? (
                              <DropdownMenuItem
                                onClick={() => setConfirmingCharge({ charge, student })}
                              >
                                <BadgeCheck className="size-4" /> Validar pagamento em dinheiro
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem onClick={() => openEdit(student)}>
                              <Pencil className="size-4" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleting(student)}
                            >
                              <Trash2 className="size-4" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>

                    </tr>
                    );
                  })

                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="responsaveis" className="mt-4">
          {guardians.length === 0 ? (
            <div className="card-surface p-12 text-center text-sm text-muted-foreground">
              Nenhum responsável cadastrado ainda.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {guardians.map((guardian) => (
                <div key={guardian.id} className="card-surface p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{guardian.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {guardian.email || "—"}
                      </p>
                    </div>
                    <StatusBadge status={guardian.status} />
                  </div>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">WhatsApp</dt>
                      <dd className="text-foreground">{guardian.phone || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Alunos vinculados</dt>
                      <dd className="text-foreground">{guardian.studentsCount}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar aluno" : "Novo aluno"}</DialogTitle>
            <DialogDescription>
              Os dados do responsável são obrigatórios — é ele quem recebe as cobranças.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Dados do aluno
              </p>
              <div className="space-y-2">
                <Label htmlFor="studentName">Nome do aluno</Label>
                <Input
                  id="studentName"
                  value={form.studentName}
                  maxLength={120}
                  onChange={(event) => set("studentName", event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="birthDate">Data de nascimento</Label>
                  <Input
                    id="birthDate"
                    type="date"
                    value={form.birthDate}
                    onChange={(event) => set("birthDate", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Plano</Label>
                  <Select value={form.planId} onValueChange={(value) => set("planId", value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sem plano" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PLAN}>Sem plano</SelectItem>
                      {data.plans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t border-border pt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Responsável
              </p>
              {data.guardians.length > 0 && (
                <div className="space-y-2">
                  <Label>Vincular a</Label>
                  <Select
                    value={form.guardianId}
                    onValueChange={(value) => set("guardianId", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NEW_GUARDIAN}>Cadastrar novo responsável</SelectItem>
                      {data.guardians.map((guardian) => (
                        <SelectItem key={guardian.id} value={guardian.id}>
                          {guardian.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {newGuardian && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="guardianName">Nome do responsável</Label>
                    <Input
                      id="guardianName"
                      value={form.guardianName}
                      maxLength={120}
                      onChange={(event) => set("guardianName", event.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="guardianPhone">WhatsApp</Label>
                      <Input
                        id="guardianPhone"
                        value={form.guardianPhone}
                        maxLength={40}
                        placeholder="Digite o telefone"
                        onChange={(event) => set("guardianPhone", event.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="guardianEmail">E-mail (opcional)</Label>
                      <Input
                        id="guardianEmail"
                        type="email"
                        maxLength={255}
                        value={form.guardianEmail}
                        onChange={(event) => set("guardianEmail", event.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {activeFields.length > 0 && (
              <div className="space-y-4 rounded-xl border border-border p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">Dados adicionais</p>
                  <p className="text-xs text-muted-foreground">
                    Campos criados em “Dados adicionais”. Preencha o que fizer sentido.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {activeFields.map((field) => (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={`cf-${field.id}`}>
                        {field.label}
                        {field.required ? " *" : ""}
                      </Label>
                      {field.type === "SELECT" ? (
                        <Select
                          value={extras[field.id] ?? ""}
                          onValueChange={(value) => setExtra(field.id, value)}
                        >
                          <SelectTrigger id={`cf-${field.id}`}>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : field.type === "BOOLEAN" ? (
                        <Select
                          value={extras[field.id] ?? ""}
                          onValueChange={(value) => setExtra(field.id, value)}
                        >
                          <SelectTrigger id={`cf-${field.id}`}>
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Sim">Sim</SelectItem>
                            <SelectItem value="Não">Não</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`cf-${field.id}`}
                          maxLength={200}
                          type={
                            field.type === "NUMBER"
                              ? "number"
                              : field.type === "DATE"
                                ? "date"
                                : "text"
                          }
                          value={extras[field.id] ?? ""}
                          onChange={(event) => setExtra(field.id, event.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}


            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar aluno"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(value) => !value && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir aluno</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `${deleting.name} será removido junto com matrículas, cobranças e mensagens vinculadas. Esta ação não pode ser desfeita.`
                : ""}
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

      <AlertDialog
        open={confirmingCharge !== null}
        onOpenChange={(value) => !value && setConfirmingCharge(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Validar pagamento em dinheiro</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingCharge
                ? `Confirmar o recebimento de ${formatCents(confirmingCharge.charge.finalAmountCents)} de ${confirmingCharge.student.name} referente a ${formatReferenceMonth(confirmingCharge.charge.referenceMonth)}? A cobrança será marcada como paga.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmingPayment}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmCashPayment();
              }}
              disabled={confirmingPayment}
            >
              {confirmingPayment ? "Confirmando..." : "Confirmar pagamento"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );

}
