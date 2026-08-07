import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeCheck,
  ClipboardCheck,
  Download,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  UsersRound,
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
import {
  buildStudentExportRows,
  buildStudentProfileSections,
  downloadCsv,
  downloadStudentListPdf,
  downloadStudentProfilePdf,
  studentExportFilename,
  toStudentCsv,
} from "@/lib/student-export";
import { useAppState } from "@/lib/store";
import {
  formatCents,
  formatDateOnly,
  formatReferenceMonth,
} from "@/lib/format";

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
const ALL_PLANS = "__all__";

export function normalizeCpf(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

/** Allows profile-only edits of students created before CPF became mandatory. */
export function studentCpfWasChanged(
  editing: Pick<Student, "cpf" | "rg"> | null,
  value: string,
) {
  const normalizeDocument = (document: string) => {
    const digits = normalizeCpf(document);
    return digits.length === 11
      ? digits
      : document.toUpperCase().replace(/[^A-Z0-9]/g, "");
  };
  return (
    !editing ||
    normalizeDocument(editing.cpf || editing.rg) !== normalizeDocument(value)
  );
}

const emptyForm = {
  studentName: "",
  studentCpf: "",
  birthDate: "",
  planId: NO_PLAN,
  guardianId: NEW_GUARDIAN,
  guardianName: "",
  guardianCpf: "",
  guardianPhone: "",
  guardianEmail: "",
};

function StudentsPage() {
  const { data, refresh } = useDashboardData();
  const { state } = useAppState();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Student | null>(null);
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [studentPhoto, setStudentPhoto] = useState<File | null>(null);
  const [studentPhotoPreview, setStudentPhotoPreview] = useState<string | null>(
    null,
  );
  const [removeStudentPhoto, setRemoveStudentPhoto] = useState(false);
  const [confirmingCharge, setConfirmingCharge] = useState<{
    charge: Charge;
    student: Student;
  } | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [removingStudent, setRemovingStudent] = useState<Student | null>(null);
  const [removing, setRemoving] = useState(false);
  const [kanbanPlanId, setKanbanPlanId] = useState(ALL_PLANS);
  const [view, setView] = useState<"students" | "payments">("students");
  const [pendingEnrollmentCount, setPendingEnrollmentCount] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"pdf" | "csv">("pdf");
  const [includePaymentStatus, setIncludePaymentStatus] = useState(true);
  const [exporting, setExporting] = useState(false);
  const showRetiredViews = false;

  useEffect(() => {
    const interval = window.setInterval(
      () => void refresh().catch(() => undefined),
      30_000,
    );
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    let mounted = true;
    const loadPending = async () => {
      try {
        const submissions = await apiRequest<Array<{ status: string }>>(
          "/workspace/public-enrollment-form/submissions",
        );
        if (mounted)
          setPendingEnrollmentCount(
            submissions.filter((submission) => submission.status === "PENDING")
              .length,
          );
      } catch {
        if (mounted) setPendingEnrollmentCount(0);
      }
    };
    void loadPending();
    const interval = window.setInterval(() => void loadPending(), 30_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

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
      const payment = await apiRequest<{ id: string }>(
        `/charges/${charge.id}/payments`,
        {
          method: "POST",
          headers: { "Idempotency-Key": `cash:${charge.id}:${Date.now()}` },
          body: {
            amountCents: charge.finalAmountCents,
            method: "CASH",
            paidAt,
          },
        },
      );
      await apiRequest(`/payments/${payment.id}/confirm`, { method: "POST" });
      toast.success("Pagamento em dinheiro confirmado.");
      setConfirmingCharge(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível confirmar o pagamento.",
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
          (kanbanPlanId === ALL_PLANS || student.planId === kanbanPlanId) &&
          (!term ||
            student.name.toLowerCase().includes(term) ||
            student.guardian.toLowerCase().includes(term)),
      ),
    [data.students, kanbanPlanId, term],
  );
  const selectedGuardianIds = useMemo(
    () => new Set(data.students.filter((student) => kanbanPlanId === ALL_PLANS || student.planId === kanbanPlanId).map((student) => student.guardianId).filter(Boolean)),
    [data.students, kanbanPlanId],
  );
  const guardians = useMemo(
    () =>
      data.guardians.filter(
        (guardian) => selectedGuardianIds.has(guardian.id) && (
          !term ||
          guardian.name.toLowerCase().includes(term) ||
          guardian.email.toLowerCase().includes(term) ||
          guardian.phone.toLowerCase().includes(term)),
      ),
    [data.guardians, selectedGuardianIds, term],
  );

  const kanban = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().slice(0, 10);
    const columns = { paid: [] as Student[], open: [] as Student[], overdue: [] as Student[], inactive: [] as Student[] };
    data.students.filter((student) => kanbanPlanId === ALL_PLANS || student.planId === kanbanPlanId).forEach((student) => {
      if (student.status === "INACTIVE") {
        columns.inactive.push(student);
        return;
      }
      const charge = data.charges.find((item) => item.studentId === student.id && item.referenceMonth === currentMonth);
      if (charge?.status === "PAID") columns.paid.push(student);
      else if (charge?.status === "PENDING" && charge.dueDate < today) columns.overdue.push(student);
      else columns.open.push(student);
    });
    return columns;
  }, [data.charges, data.students, kanbanPlanId]);

  const kanbanTotals = useMemo(() => {
    const referenceMonth = new Date().toISOString().slice(0, 7);
    const totalFor = (column: Student[]) =>
      column.reduce((total, student) => {
        const charge = data.charges.find(
          (item) =>
            item.studentId === student.id &&
            item.referenceMonth === referenceMonth,
        );
        return total + (charge?.finalAmountCents ?? 0);
      }, 0);
    return {
      paid: totalFor(kanban.paid),
      open: totalFor(kanban.open),
      overdue: totalFor(kanban.overdue),
      inactive: 0,
    };
  }, [data.charges, kanban]);

  const exportRows = useMemo(
    () =>
      buildStudentExportRows(
        { students, charges: Array.from(chargeByStudent.values()) },
        { includePaymentStatus },
      ),
    [chargeByStudent, includePaymentStatus, students],
  );
  const exportBrand = {
    organizationName: state.business?.name ?? "Mensaly",
    brandColor: state.business?.brandColor,
  };

  async function exportStudents() {
    if (!exportRows.length) return;
    setExporting(true);
    try {
      if (exportFormat === "csv") {
        downloadCsv(studentExportFilename(exportBrand.organizationName, "csv"), toStudentCsv(exportRows));
      } else {
        await downloadStudentListPdf(exportRows, exportBrand, includePaymentStatus);
      }
      toast.success("Exportação iniciada.");
      setExportOpen(false);
    } catch {
      toast.error("Não foi possível gerar a exportação.");
    } finally {
      setExporting(false);
    }
  }

  async function downloadStudentRecord(student: Student) {
    try {
      const guardian = data.guardians.find((item) => item.id === student.guardianId);
      const charge = chargeByStudent.get(student.id);
      await downloadStudentProfilePdf({
        brand: exportBrand,
        student,
        photoUrl: student.photoFileId ? `/api/v1/files/${student.photoFileId}/content` : null,
        sections: buildStudentProfileSections({
          student,
          charge,
          customFields: data.customFields,
          values: data.studentFieldValues[student.id] ?? {},
          guardianValues: student.guardianId ? data.guardianFieldValues[student.guardianId] ?? {} : {},
          guardianDetails: guardian ? [["WhatsApp", guardian.phone], ["E-mail", guardian.email || "—"]] : [],
        }),
      });
      toast.success("Ficha do aluno baixada.");
    } catch {
      toast.error("Não foi possível gerar a ficha do aluno.");
    }
  }

  const newGuardian = !editing || form.guardianId === NEW_GUARDIAN;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setExtras({});
    setStudentPhoto(null);
    setStudentPhotoPreview(null);
    setRemoveStudentPhoto(false);
    setOpen(true);
  }

  function openEdit(student: Student) {
    const guardian = data.guardians.find(
      (item) => item.id === student.guardianId,
    );
    setEditing(student);
    setForm({
      ...emptyForm,
      studentName: student.name,
      studentCpf: student.cpf || student.rg,
      birthDate: student.birthDate ?? "",
      planId: student.planId ?? NO_PLAN,
      guardianId: student.guardianId ?? NEW_GUARDIAN,
      guardianName: guardian?.name ?? "",
      guardianCpf: guardian?.taxId ?? "",
      guardianPhone: guardian?.phone ?? "",
      guardianEmail: guardian?.email ?? "",
    });
    setExtras({
      ...(data.studentFieldValues[student.id] ?? {}),
      ...(student.guardianId
        ? (data.guardianFieldValues[student.guardianId] ?? {})
        : {}),
    });
    setStudentPhoto(null);
    setStudentPhotoPreview(null);
    setRemoveStudentPhoto(false);
    setOpen(true);
  }

  function selectStudentPhoto(file: File | null) {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast.error("Envie uma imagem PNG ou JPEG.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A foto deve ter no mÃ¡ximo 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setStudentPhotoPreview(String(reader.result));
    reader.readAsDataURL(file);
    setStudentPhoto(file);
    setRemoveStudentPhoto(false);
  }

  async function uploadStudentPhoto(file: File) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/v1/files", {
      method: "POST",
      body,
      credentials: "include",
    });
    const payload = (await response.json().catch(() => null)) as {
      data?: { id?: string };
      error?: { message?: string };
      message?: string;
    } | null;
    if (!response.ok || !payload?.data?.id) {
      throw new Error(
        payload?.error?.message ??
          payload?.message ??
          "Não foi possível enviar a foto do aluno.",
      );
    }
    return payload.data.id;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.studentName.trim()) {
      toast.error("Informe o nome do aluno.");
      return;
    }
    const cpfChanged = studentCpfWasChanged(editing, form.studentCpf);
    const studentDocumentDigits = normalizeCpf(form.studentCpf);
    const studentDocumentIsCpf = studentDocumentDigits.length === 11;
    const normalizedStudentRg = form.studentCpf
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (
      cpfChanged &&
      !studentDocumentIsCpf &&
      normalizedStudentRg.length < 5
    ) {
      toast.error("Informe um CPF com 11 dígitos ou um RG válido.");
      return;
    }
    const createGuardian = newGuardian;
    if (!form.guardianName.trim()) {
      toast.error("Informe o nome do responsável.");
      return;
    }
    if (normalizeCpf(form.guardianCpf).length !== 11) {
      toast.error("Informe o CPF do responsável com 11 dígitos.");
      return;
    }
    if (!form.guardianPhone.trim()) {
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
      const photoFileId = studentPhoto
        ? await uploadStudentPhoto(studentPhoto)
        : undefined;
      const photoUpdate = photoFileId
        ? { photoFileId }
        : editing && removeStudentPhoto
          ? { photoFileId: null }
          : {};
      let guardianId = createGuardian
        ? null
        : newGuardian
          ? (editing?.guardianId ?? null)
          : form.guardianId;

      if (createGuardian) {
        const created = await apiRequest<{ id: string }>("/guardians", {
          method: "POST",
          body: {
            name: form.guardianName.trim().slice(0, 120),
            taxId: form.guardianCpf,
            phone: form.guardianPhone.trim().slice(0, 40),
            ...(form.guardianEmail.trim()
              ? { email: form.guardianEmail.trim().slice(0, 255) }
              : {}),
          },
        });
        guardianId = created.id;
      } else if (guardianId) {
        await apiRequest(`/guardians/${guardianId}`, {
          method: "PATCH",
          body: {
            name: form.guardianName.trim().slice(0, 120),
            taxId: form.guardianCpf,
            phone: form.guardianPhone.trim().slice(0, 40),
            email: form.guardianEmail.trim()
              ? form.guardianEmail.trim().slice(0, 255)
              : null,
          },
        });
      }

      let studentId = editing?.id;

      if (editing) {
        await apiRequest(`/students/${editing.id}`, {
          method: "PATCH",
          body: {
            name: form.studentName.trim().slice(0, 120),
            ...(cpfChanged
              ? studentDocumentIsCpf
                ? { cpf: studentDocumentDigits, rg: null }
                : { cpf: null, rg: form.studentCpf }
              : {}),
            ...(form.birthDate ? { birthDate: form.birthDate } : {}),
            ...photoUpdate,
          },
        });
      } else {
        const student = await apiRequest<{ id: string }>("/students", {
          method: "POST",
          body: {
            name: form.studentName.trim().slice(0, 120),
            ...(studentDocumentIsCpf
              ? { cpf: studentDocumentDigits }
              : { rg: form.studentCpf }),
            ...(form.birthDate ? { birthDate: form.birthDate } : {}),
            ...photoUpdate,
          },
        });
        studentId = student.id;
      }

      if (!studentId || !guardianId)
        throw new Error("Aluno ou responsável inválido.");
      await apiRequest(`/students/${studentId}/guardians/${guardianId}`, {
        method: "POST",
        body: { relationship: "Responsável financeiro" },
      });

      const currentPlanId = editing?.planId ?? null;
      const nextPlanId = form.planId === NO_PLAN ? null : form.planId;
      const enrollmentChanged =
        nextPlanId !== currentPlanId ||
        guardianId !== (editing?.guardianId ?? null);

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
              .filter((field) => field.subject !== "GUARDIAN")
              .map((field) => [
                field.id,
                (extras[field.id] ?? "").trim().slice(0, 500),
              ])
              .filter(([, value]) => value.length > 0),
          ),
        },
      });

      if (guardianId) {
        await apiRequest(`/workspace/guardian-field-values/${guardianId}`, {
          method: "PATCH",
          body: {
            values: Object.fromEntries(
              activeFields
                .filter((field) => field.subject === "GUARDIAN")
                .map((field) => [
                  field.id,
                  (extras[field.id] ?? "").trim().slice(0, 500),
                ])
                .filter(([, value]) => value.length > 0),
            ),
          },
        });
      }

      toast.success(editing ? "Aluno atualizado." : "Aluno cadastrado.");
      setForm(emptyForm);
      setExtras({});
      setStudentPhoto(null);
      setStudentPhotoPreview(null);
      setRemoveStudentPhoto(false);

      setEditing(null);
      setOpen(false);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deactivateStudent(student: Student) {
    setSaving(true);
    try {
      await apiRequest(`/students/${student.id}`, {
        method: "PATCH",
        body: { status: "INACTIVE" },
      });
      toast.success("Aluno desativado. Novas cobranças foram interrompidas.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desativar o aluno.");
    } finally {
      setSaving(false);
    }
  }

  async function removeStudent() {
    if (!removingStudent) return;
    setRemoving(true);
    try {
      await apiRequest(`/students/${removingStudent.id}`, { method: "DELETE" });
      toast.success("Aluno removido.");
      setRemovingStudent(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível remover o aluno.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="Alunos" description="Acompanhe os alunos e a situação das mensalidades por plano." />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-full rounded-xl border border-border bg-card p-1 shadow-sm sm:w-auto" role="tablist" aria-label="Visualização dos alunos"><button type="button" role="tab" aria-selected={view === "students"} onClick={() => setView("students")} className={`min-h-11 rounded-lg px-5 text-sm font-medium transition ${view === "students" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>Visão geral</button><button type="button" role="tab" aria-selected={view === "payments"} onClick={() => setView("payments")} className={`min-h-11 rounded-lg px-5 text-sm font-medium transition ${view === "payments" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}>Status de pagamento</button></div>
        {view === "payments" ? <Select value={kanbanPlanId} onValueChange={setKanbanPlanId}><SelectTrigger className="min-h-11 w-full sm:w-64"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL_PLANS}>Todos os planos</SelectItem>{data.plans.filter((plan) => plan.status === "ACTIVE").map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectContent></Select> : null}
      </div>

      {showRetiredViews && view === "payments" && <section className="space-y-4" aria-label="Kanban de pagamentos">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-base font-semibold">Situação dos pagamentos</h2><p className="text-sm text-muted-foreground">Mensalidade do mês atual. Atualiza automaticamente a cada 30 segundos.</p></div>
        </div>
        {!kanbanPlanId ? <div className="card-surface p-8 text-center text-sm text-muted-foreground">Selecione um plano para ver os alunos.</div> : <div className="grid gap-4 lg:grid-cols-3">
          {([
            ["paid", "Pago", "border-emerald-200 bg-emerald-50/40", "text-emerald-700"],
            ["open", "Em aberto", "border-amber-200 bg-amber-50/40", "text-amber-700"],
            ["overdue", "Vencido", "border-red-200 bg-red-50/40", "text-red-700"],
          ] as const).map(([key, title, surface, text]) => <section key={key} className={`min-h-72 rounded-xl border p-3 ${surface}`}><div className="mb-3 flex items-center justify-between"><h3 className={`font-semibold ${text}`}>{title}</h3><span className={`text-sm font-medium ${text}`}>{kanban[key].length}</span></div><div className="space-y-2">{kanban[key].map((student) => <button type="button" key={student.id} onClick={() => openEdit(student)} className="flex w-full items-center gap-3 rounded-lg bg-card p-3 text-left shadow-sm transition hover:ring-2 hover:ring-primary/20"><span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">{student.photoFileId ? <img src={`/api/v1/files/${student.photoFileId}/content`} alt="" className="size-full object-cover" /> : student.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span><span className="min-w-0 truncate font-medium">{student.name}</span></button>)}{kanban[key].length === 0 ? <p className="rounded-lg border border-dashed bg-card/50 p-4 text-center text-sm text-muted-foreground">Nenhum aluno.</p> : null}</div></section>)}
        </div>}
      </section>}

      {view === "payments" && <section className="space-y-5" aria-label="Kanban de pagamentos">
        <div><h2 className="text-xl font-bold tracking-tight">Situação dos pagamentos</h2><p className="mt-1 text-sm text-muted-foreground">Mensalidade do mês atual. Atualiza automaticamente a cada 30 segundos.</p></div>
        <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-4">
          {([
            ["paid", "Pago", "border-t-emerald-600 bg-emerald-50/40", "bg-emerald-600", "bg-emerald-50 text-emerald-700", "Valor recebido"],
            ["open", "Em aberto", "border-t-amber-500 bg-amber-50/40", "bg-amber-500", "bg-amber-50 text-amber-700", "Valor em aberto"],
            ["overdue", "Vencido", "border-t-red-600 bg-red-50/40", "bg-red-600", "bg-red-50 text-red-700", "Valor expirado"],
            ["inactive", "Inativos", "border-t-slate-500 bg-slate-50/60", "bg-slate-500", "bg-slate-100 text-slate-700", "Cobranças pausadas"],
          ] as const).map(([key, title, surface, dot, amountSurface, totalLabel]) => <section key={key} className={`flex min-h-[30rem] flex-col rounded-2xl border border-border border-t-4 p-3 shadow-sm ${surface}`}>
            <div className="mb-3 flex items-center gap-2 px-1"><span className={`size-2.5 rounded-full ${dot}`} /><h3 className="text-base font-medium tracking-tight">{title}</h3><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{kanban[key].length}</span></div>
            <div className="space-y-2">
              {kanban[key].map((student) => {
                const charge = data.charges.find((item) => item.studentId === student.id && item.referenceMonth === new Date().toISOString().slice(0, 7));
                const payment = charge ? data.payments.find((item) => item.chargeId === charge.id) : undefined;
                const dateLabel = key === "inactive" ? ["Cobranças", "pausadas"] : !charge ? ["Sem cobrança", ""] : key === "paid" ? payment ? ["Pago em:", formatDateOnly(payment.paidAt)] : ["Pagamento", "confirmado"] : key === "open" ? ["Expira em:", formatDateOnly(charge.dueDate)] : ["Vencido em:", formatDateOnly(charge.dueDate)];
                return <article key={student.id} className="rounded-xl border border-border/80 bg-card p-3 shadow-sm">
                  <button type="button" onClick={() => openEdit(student)} className="flex w-full items-center gap-2.5 text-left">
                    <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium">{student.photoFileId ? <img src={`/api/v1/files/${student.photoFileId}/content`} alt={`Foto de ${student.name}`} className="size-full object-cover" /> : student.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-normal">{student.name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{student.plan ?? "Sem plano"}</span></span>
                    <span className={`shrink-0 rounded-lg px-2 py-1.5 text-right text-[11px] font-normal ${amountSurface}`}><span className="block whitespace-nowrap">{dateLabel[0]}</span>{dateLabel[1] ? <span className="block whitespace-nowrap font-normal">{dateLabel[1]}</span> : null}</span>
                  </button>
                </article>;
              })}
              {kanban[key].length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/40 px-4 text-center text-muted-foreground"><UsersRound className="mb-3 size-9 opacity-45" /><p className="text-base font-medium">Nenhum aluno.</p></div> : null}
            </div>
            <div className="mt-auto border-t border-border/70 px-1 pt-4"><p className="text-xs text-muted-foreground">{totalLabel}</p><p className="mt-1 text-lg font-medium text-foreground">{formatCents(kanbanTotals[key])}</p></div>
          </section>)}
        </div>
      </section>}

      {view === "students" && <section className="space-y-6"><div className="card-surface grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0"><div className="flex items-center gap-4 p-5"><span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><UsersRound className="size-6" /></span><div><p className="text-sm text-muted-foreground">Total de alunos</p><p className="text-3xl font-semibold tracking-tight">{students.length}</p></div></div><div className="flex items-center gap-4 p-5 sm:pl-7"><span className="flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"><ClipboardCheck className="size-6" /></span><div><p className="text-sm text-muted-foreground">Solicitações pendentes</p><p className="text-3xl font-semibold tracking-tight">{pendingEnrollmentCount}</p></div></div></div><div className="card-surface p-5"><div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="relative w-full lg:max-w-2xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por aluno, responsável, e-mail ou telefone"
          className="pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div><div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row"><Select value={kanbanPlanId} onValueChange={setKanbanPlanId}><SelectTrigger className="min-h-11 w-full sm:w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL_PLANS}>Todos os planos</SelectItem>{data.plans.filter((plan) => plan.status === "ACTIVE").map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" className="min-h-11" onClick={() => setExportOpen(true)} disabled={students.length === 0}><Download className="size-4" /> Exportar</Button></div></div>

      <Tabs defaultValue="alunos">
        <TabsList className="hidden">
          <TabsTrigger value="alunos">
            Alunos ({students.length})
          </TabsTrigger>
          {showRetiredViews && <TabsTrigger value="responsaveis">
            Responsáveis ({guardians.length})
          </TabsTrigger>}
        </TabsList>

        <TabsContent value="alunos" className="mt-4">
          <div className="overflow-x-auto">
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
                    <td
                      colSpan={7}
                      className="px-5 py-12 text-center text-sm text-muted-foreground"
                    >
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
                        <td className="px-5 py-3 font-medium text-foreground">
                          <div className="flex items-center gap-3">
                            {student.photoFileId ? <img src={`/api/v1/files/${student.photoFileId}/content`} alt="" loading="lazy" className="size-9 rounded-full object-cover" /> : <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs">{student.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</span>}
                            {student.name}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {student.birthDate
                            ? formatDateOnly(student.birthDate)
                            : "—"}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {student.guardian}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {student.plan}
                        </td>
                        <td className="px-5 py-3">
                          {charge ? (
                            <div className="flex flex-col gap-1">
                              <StatusBadge
                                status={charge.status}
                                className="w-fit"
                              />
                              <span className="text-xs text-muted-foreground">
                                {formatReferenceMonth(charge.referenceMonth)} ·{" "}
                                {formatCents(charge.finalAmountCents)}
                                {overdue ? " · vencida" : ""}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Sem cobrança
                            </span>
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
                                  onClick={() =>
                                    setConfirmingCharge({ charge, student })
                                  }
                                >
                                  <BadgeCheck className="size-4" /> Validar
                                  pagamento em dinheiro
                                </DropdownMenuItem>
                              ) : null}
                              {student.status === "ACTIVE" ? <DropdownMenuItem onClick={() => void deactivateStudent(student)} disabled={saving}>Desativar aluno</DropdownMenuItem> : null}
                              <DropdownMenuItem
                                onClick={() => openEdit(student)}
                              >
                                <Pencil className="size-4" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setRemovingStudent(student)}
                                disabled={saving || removing}
                              >
                                <Trash2 className="size-4" /> Remover aluno
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

        {showRetiredViews && <TabsContent value="responsaveis" className="mt-4">
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
                      <p className="truncate font-medium text-foreground">
                        {guardian.name}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {guardian.email || "—"}
                      </p>
                    </div>
                    <StatusBadge status={guardian.status} />
                  </div>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">WhatsApp</dt>
                      <dd className="text-foreground">
                        {guardian.phone || "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">
                        Alunos vinculados
                      </dt>
                      <dd className="text-foreground">
                        {guardian.studentsCount}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </TabsContent>}
      </Tabs></div></section>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar aluno" : "Novo aluno"}</DialogTitle>
            <DialogDescription>
              Os dados do responsável são obrigatórios — é ele quem recebe as
              cobranças.
            </DialogDescription>
            {editing ? <Button type="button" variant="outline" className="mt-3 w-fit" onClick={() => void downloadStudentRecord(editing)}><Download className="size-4" /> Baixar ficha PDF</Button> : null}
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
              <div className="space-y-2">
                <Label htmlFor="studentPhoto">Foto do aluno</Label>
                <div className="flex items-center gap-4 rounded-xl border border-border p-3">
                  {studentPhotoPreview ? (
                    <img
                      src={studentPhotoPreview}
                      alt="PrÃ©-visualizaÃ§Ã£o da foto do aluno"
                      className="size-20 rounded-full object-cover"
                    />
                  ) : editing?.photoFileId && !removeStudentPhoto ? (
                    <img
                      src={`/api/v1/files/${editing.photoFileId}/content`}
                      alt={`Foto de ${editing.name}`}
                      className="size-20 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex size-20 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
                      {form.studentName
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part) => part[0])
                        .join("") || "?"}
                    </span>
                  )}
                  <div className="min-w-0 space-y-2">
                    {!editing ? <Input
                      id="studentPhoto"
                      type="file"
                      accept="image/png,image/jpeg"
                      className="max-w-xs"
                      onChange={(event) =>
                        selectStudentPhoto(event.currentTarget.files?.[0] ?? null)
                      }
                    /> : null}
                    <p className="text-xs text-muted-foreground">
                      PNG ou JPEG, atÃ© 5 MB.
                    </p>
                    {editing?.photoFileId && !removeStudentPhoto && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-0 text-muted-foreground"
                        onClick={() => {
                          setStudentPhoto(null);
                          setStudentPhotoPreview(null);
                          setRemoveStudentPhoto(true);
                        }}
                      >
                        Remover foto
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="studentCpf">CPF/RG do aluno</Label>
                <Input
                  id="studentCpf"
                  value={form.studentCpf}
                  inputMode="text"
                  maxLength={30}
                  placeholder="CPF ou RG"
                  onChange={(event) => set("studentCpf", event.target.value)}
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
                    onInput={(event) =>
                      set("birthDate", event.currentTarget.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Plano</Label>
                  <Select
                    value={form.planId}
                    onValueChange={(value) => set("planId", value)}
                  >
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
              <>
                  <div className="space-y-2">
                    <Label htmlFor="guardianName">Nome do responsável</Label>
                    <Input
                      id="guardianName"
                      value={form.guardianName}
                      maxLength={120}
                      onChange={(event) =>
                        set("guardianName", event.target.value)
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="guardianCpf">CPF do responsável</Label>
                    <Input
                      id="guardianCpf"
                      value={form.guardianCpf}
                      inputMode="numeric"
                      maxLength={14}
                      placeholder="000.000.000-00"
                      onChange={(event) =>
                        set("guardianCpf", event.target.value)
                      }
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
                        onChange={(event) =>
                          set("guardianPhone", event.target.value)
                        }
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
                        onChange={(event) =>
                          set("guardianEmail", event.target.value)
                        }
                      />
                    </div>
                  </div>
              </>
            </div>

            {activeFields.length > 0 && (
              <div className="space-y-4 rounded-xl border border-border p-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Dados adicionais
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Campos criados em “Dados adicionais”. Preencha o que fizer
                    sentido.
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
                          onChange={(event) =>
                            setExtra(field.id, event.target.value)
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Salvando..."
                  : editing
                    ? "Salvar alterações"
                    : "Cadastrar aluno"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar alunos</DialogTitle>
            <DialogDescription>
              {kanbanPlanId === ALL_PLANS ? "A lista será organizada por todos os planos." : "A lista usará apenas o plano selecionado."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="export-format">Formato</Label>
              <Select value={exportFormat} onValueChange={(value) => setExportFormat(value as "pdf" | "csv")}>
                <SelectTrigger id="export-format"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="csv">Planilha CSV (Excel)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={includePaymentStatus} onChange={(event) => setIncludePaymentStatus(event.target.checked)} />
              Incluir status da cobrança
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setExportOpen(false)} disabled={exporting}>Cancelar</Button>
            <Button type="button" onClick={() => void exportStudents()} disabled={exporting || exportRows.length === 0}><Download className="size-4" />{exporting ? "Gerando..." : "Exportar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <AlertDialogCancel disabled={confirmingPayment}>
              Cancelar
            </AlertDialogCancel>
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

      <AlertDialog
        open={removingStudent !== null}
        onOpenChange={(value) => !value && !removing && setRemovingStudent(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover aluno?</AlertDialogTitle>
            <AlertDialogDescription>
              {removingStudent
                ? `Você removerá ${removingStudent.name} e seus vínculos sem histórico financeiro. Esta ação não pode ser desfeita.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void removeStudent();
              }}
            >
              {removing ? "Removendo..." : "Remover aluno"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
