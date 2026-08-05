import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Check,
  Copy,
  ExternalLink,
  GripVertical,
  Link2,
  ListPlus,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";
import {
  useDashboardData,
  type CustomField,
  type CustomFieldType,
} from "@/lib/data";
import {
  publicEnrollmentLinkForOrigin,
  type PublicEnrollmentFieldConfiguration,
  type PublicEnrollmentFormSettings,
} from "@/lib/public-enrollment";
import { useAppState } from "@/lib/store";
import { parseBrazilianAmountToCents } from "@/lib/money";
import { EnrollmentPermissionsPanel } from "./permissoes-cadastro";

export const Route = createFileRoute("/dados-adicionais")({
  head: () => ({
    meta: [
      { title: "Formulário de cadastro — Mensaly" },
      {
        name: "description",
        content:
          "Crie os campos opcionais do cadastro de alunos: CPF, RG, tipo sanguíneo, alergias e qualquer dado que o seu nicho precise.",
      },
      { property: "og:title", content: "Formulário de cadastro — Mensaly" },
      {
        property: "og:description",
        content:
          "Configure os campos extras que aparecem no cadastro de cada aluno.",
      },
    ],
  }),
  component: CustomFieldsPage,
});

export const fieldTypeLabels: Record<CustomFieldType, string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  DATE: "Data",
  SELECT: "Lista de opções",
  BOOLEAN: "Sim / Não",
};

const suggestions = [
  {
    label: "Tipo sanguíneo",
    type: "SELECT" as CustomFieldType,
    options: "A+\nA-\nB+\nB-\nAB+\nAB-\nO+\nO-",
  },
  { label: "Alergias", type: "TEXT" as CustomFieldType, options: "" },
  { label: "Convênio médico", type: "TEXT" as CustomFieldType, options: "" },
  {
    label: "Contato de emergência",
    type: "TEXT" as CustomFieldType,
    options: "",
  },
  {
    label: "Autoriza uso de imagem",
    type: "BOOLEAN" as CustomFieldType,
    options: "",
  },
];

type FieldForm = {
  label: string;
  type: CustomFieldType;
  options: string;
  subject: "STUDENT" | "GUARDIAN";
  required: boolean;
  active: boolean;
};

const emptyForm: FieldForm = {
  label: "",
  type: "TEXT" as CustomFieldType,
  options: "",
  subject: "STUDENT",
  required: true,
  active: true,
};

const emptyManualStudent = { studentName: "", studentCpf: "", birthDate: "", studentPhone: "", selfResponsible: false, guardianName: "", guardianCpf: "", guardianPhone: "", planId: "", customAmountEnabled: false, customAmount: "" };

const standardFieldSettings: Array<{
  key: Exclude<keyof PublicEnrollmentFieldConfiguration, "approvalMode">;
  label: string;
}> = [
  { key: "studentBirthDateRequired", label: "Nascimento do aluno" },
  { key: "studentPhoneRequired", label: "Telefone do aluno" },
  { key: "relationshipRequired", label: "Relação com o aluno" },
];

function CustomFieldsPage() {
  const { data, refresh } = useDashboardData();
  const { state } = useAppState();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [deleting, setDeleting] = useState<CustomField | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [publicForm, setPublicForm] =
    useState<PublicEnrollmentFormSettings | null>(null);
  const [publicFormSaving, setPublicFormSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [panel, setPanel] = useState<"new" | "fields" | "pending">("new");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualStudent, setManualStudent] = useState(emptyManualStudent);

  const fields = data.customFields;
  const publicLinkEnabled = publicForm?.configured === true && publicForm.active;
  const publicFormLink =
    publicForm?.configured === true
      ? publicEnrollmentLinkForOrigin(
          publicForm.link,
          typeof window === "undefined" ? undefined : window.location.origin,
        )
      : "";
  const approvalQueueEnabled = publicLinkEnabled && publicForm.fieldConfiguration.approvalMode === "SAFE";

  useEffect(() => {
    void apiRequest<PublicEnrollmentFormSettings>(
      "/workspace/public-enrollment-form",
    )
      .then(setPublicForm)
      .catch((error) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o formulário.",
        ),
      );
  }, []);

  useEffect(() => {
    if (!approvalQueueEnabled && panel === "pending") setPanel("new");
  }, [approvalQueueEnabled, panel]);

  async function generateFormLink() {
    setPublicFormSaving(true);
    try {
      const settings = await apiRequest<PublicEnrollmentFormSettings>(
        "/workspace/public-enrollment-form",
        { method: "POST" },
      );
      setPublicForm(settings);
      setCopied(false);
      toast.success("Link de cadastro criado.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o link.",
      );
    } finally {
      setPublicFormSaving(false);
    }
  }

  async function copyFormLink() {
    if (!publicForm?.configured) return;
    await navigator.clipboard.writeText(publicFormLink);
    setCopied(true);
    toast.success("Link copiado.");
    setTimeout(() => setCopied(false), 2000);
  }

  async function updatePublicForm(body: {
    active?: boolean;
    fieldConfiguration?: Partial<PublicEnrollmentFieldConfiguration>;
  }) {
    setPublicFormSaving(true);
    try {
      const settings = await apiRequest<PublicEnrollmentFormSettings>(
        "/workspace/public-enrollment-form",
        { method: "PATCH", body },
      );
      setPublicForm(settings);
      toast.success("Configuração atualizada.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível atualizar.",
      );
    } finally {
      setPublicFormSaving(false);
    }
  }

  async function rotatePublicForm() {
    if (
      !window.confirm(
        "O link atual deixará de funcionar. Deseja gerar um novo link?",
      )
    )
      return;
    setPublicFormSaving(true);
    try {
      const settings = await apiRequest<PublicEnrollmentFormSettings>(
        "/workspace/public-enrollment-form/rotate",
        { method: "POST" },
      );
      setPublicForm(settings);
      setCopied(false);
      toast.success("Novo link gerado. O anterior foi invalidado.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível regenerar o link.",
      );
    } finally {
      setPublicFormSaving(false);
    }
  }

  function openCreate(preset?: (typeof suggestions)[number]) {
    setEditing(null);
    setForm(preset ? { ...emptyForm, ...preset } : emptyForm);
    setOpen(true);
  }

  function openEdit(field: CustomField) {
    setEditing(field);
    setForm({
      label: field.label,
      type: field.type,
      options: field.options.join("\n"),
      subject: field.subject,
      required: field.required,
      active: field.active,
    });
    setOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const businessId = state.business?.id;
    if (!businessId) {
      toast.error("Sessão inválida. Faça login novamente.");
      return;
    }
    const label = form.label.trim().slice(0, 60);
    if (!label) {
      toast.error("Informe o nome do campo.");
      return;
    }
    const options =
      form.type === "SELECT"
        ? form.options
            .split("\n")
            .map((option) => option.trim().slice(0, 60))
            .filter(Boolean)
        : [];
    if (form.type === "SELECT" && options.length === 0) {
      toast.error("Adicione ao menos uma opção para a lista.");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await apiRequest(`/workspace/custom-fields/${editing.id}`, {
          method: "PATCH",
          body: {
            label,
            fieldType: form.type,
            options,
            subject: form.subject,
            required: form.required,
            active: form.active,
          },
        });
      } else {
        await apiRequest("/workspace/custom-fields", {
          method: "POST",
          body: {
            label,
            fieldType: form.type,
            options,
            subject: form.subject,
            required: form.required,
            active: form.active,
            sortOrder: fields.length,
          },
        });
      }
      toast.success(editing ? "Campo atualizado." : "Campo criado.");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(field: CustomField, active: boolean) {
    try {
      await apiRequest(`/workspace/custom-fields/${field.id}`, {
        method: "PATCH",
        body: { active },
      });
    } catch {
      toast.error("Não foi possível atualizar o campo.");
      return;
    }
    await refresh();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiRequest(`/workspace/custom-fields/${deleting.id}`, {
        method: "DELETE",
      });
    } catch {
      toast.error("Não foi possível excluir o campo.");
      return;
    }
    toast.success("Campo excluído.");
    setDeleting(null);
    await refresh();
  }

  async function submitManualStudent(event: React.FormEvent) {
    event.preventDefault();
    if (!manualStudent.planId) return toast.error("Escolha um plano.");
    if (manualStudent.selfResponsible && !manualStudent.studentPhone.trim()) return toast.error("Informe o WhatsApp do aluno.");
    const customAmountCents = manualStudent.customAmountEnabled
      ? parseBrazilianAmountToCents(manualStudent.customAmount)
      : null;
    if (manualStudent.customAmountEnabled && !customAmountCents) {
      return toast.error("Informe um valor personalizado válido maior que R$ 0,00.");
    }
    const studentDocument = manualStudent.studentCpf.trim();
    const studentCpf = studentDocument.replace(/\D/g, "");
    const documentIsCpf = studentCpf.length === 11;
    if (manualStudent.selfResponsible && !documentIsCpf) return toast.error("Para ser o próprio responsável, informe o CPF do aluno.");
    setManualSaving(true);
    try {
      await apiRequest("/enrollments/manual", {
        method: "POST",
        body: {
          student: {
            name: manualStudent.studentName.trim(),
            ...(documentIsCpf ? { cpf: studentCpf } : { rg: studentDocument }),
            ...(manualStudent.birthDate ? { birthDate: manualStudent.birthDate } : {}),
            ...(manualStudent.studentPhone.trim() ? { phone: manualStudent.studentPhone } : {}),
          },
          guardian: manualStudent.selfResponsible
            ? {
                name: manualStudent.studentName.trim(),
                taxId: studentCpf,
                phone: manualStudent.studentPhone,
              }
            : {
                name: manualStudent.guardianName.trim(),
                taxId: manualStudent.guardianCpf,
                phone: manualStudent.guardianPhone,
              },
          relationship: "Responsável financeiro",
          planId: manualStudent.planId,
          startDate: new Date().toISOString().slice(0, 10),
          ...(customAmountCents ? { amountCents: customAmountCents } : {}),
        },
      });
      toast.success("Aluno cadastrado.");
      setManualOpen(false);
      setManualStudent(emptyManualStudent);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cadastrar o aluno.");
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Cadastrar alunos"
        description="Cadastre manualmente e defina os campos obrigatórios. O link público é configurado em Configurações."
        actions={
          panel === "fields" ? <div className="flex flex-wrap gap-2">
            <Button onClick={() => openCreate()}>
              <Plus className="size-4" /> Novo campo
            </Button>
          </div> : undefined
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Operações de cadastro">
        {([
          ["new", "Cadastrar novo aluno", "Manual ou link", UserPlus],
          ["fields", "Campos para cadastro", `${fields.length} campo(s)`, ListPlus],
          ["pending", "Solicitações", "Aprovar ou recusar", ShieldCheck],
        ] as const).filter(([id]) => id !== "pending" || approvalQueueEnabled).map(([id, title, detail, Icon]) => <button key={id} type="button" onClick={() => setPanel(id)} className={`card-surface flex min-h-24 items-center gap-4 p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${panel === id ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}><span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${panel === id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><Icon className="size-5" /></span><span className="min-w-0"><span className="block truncate text-base font-semibold text-foreground">{title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{detail}</span></span></button>)}
      </section>

      {panel === "new" && <section className="card-surface overflow-hidden">
        <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-border">
          <div className="p-6 sm:p-8"><h2 className="text-2xl font-semibold tracking-tight text-foreground">Cadastro manual</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">Preencha os dados do aluno diretamente no sistema.</p><Button className="mt-5" onClick={() => setManualOpen(true)}><Plus className="size-4" /> Cadastrar manualmente</Button><div className="mt-5 max-w-md rounded-xl border border-border bg-muted/20 p-4"><div className="space-y-3"><div><Label>Nome do aluno</Label><Input className="mt-1" placeholder="Digite o nome completo" disabled /></div><div><Label>Nascimento</Label><Input className="mt-1" placeholder="dd/mm/aaaa" disabled /></div><div><Label>Responsável</Label><Input className="mt-1" placeholder="Digite o nome do responsável" disabled /></div></div></div></div>
          {publicLinkEnabled && publicForm.configured ? <div className="border-t border-border p-6 sm:p-8 lg:border-t-0"><h2 className="text-2xl font-semibold tracking-tight text-foreground">Formulário para o responsável</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">{approvalQueueEnabled ? "O responsável envia os dados e você aprova depois." : "O responsável envia os dados e o cadastro é realizado automaticamente."}</p><div className="mt-5 space-y-5"><div><p className="mb-2 text-sm font-medium text-foreground">Link do formulário</p><div className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-muted/20 px-4"><span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{publicFormLink}</span><Button type="button" variant="ghost" size="icon" aria-label="Copiar link" onClick={copyFormLink}><Copy className="size-4" /></Button></div></div><div className="rounded-xl border border-border bg-muted/10 p-4"><p className="mb-3 text-sm font-medium text-foreground">QR Code do formulário</p><div className="flex justify-center rounded-lg bg-card p-4"><QRCodeSVG value={publicFormLink} size={168} level="M" includeMargin /></div></div></div></div> : null}
        </div>
      </section>}

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Cadastrar aluno manualmente</DialogTitle><DialogDescription>Preencha os dados do aluno e do responsável financeiro.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={submitManualStudent}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aluno</p>
            <div className="space-y-2"><Label htmlFor="manual-student-name">Nome do aluno</Label><Input id="manual-student-name" value={manualStudent.studentName} onChange={(event) => setManualStudent((current) => ({ ...current, studentName: event.target.value }))} required /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="manual-student-cpf">CPF/RG do aluno</Label><Input id="manual-student-cpf" value={manualStudent.studentCpf} onChange={(event) => setManualStudent((current) => ({ ...current, studentCpf: event.target.value }))} required /></div><div className="space-y-2"><Label htmlFor="manual-student-birth">Nascimento</Label><Input id="manual-student-birth" type="date" value={manualStudent.birthDate} onChange={(event) => setManualStudent((current) => ({ ...current, birthDate: event.target.value }))} /></div></div>
            <div className="space-y-2"><Label htmlFor="manual-student-phone">WhatsApp do aluno</Label><Input id="manual-student-phone" value={manualStudent.studentPhone} onChange={(event) => setManualStudent((current) => ({ ...current, studentPhone: event.target.value }))} required={manualStudent.selfResponsible} /></div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 text-sm font-medium"><Checkbox checked={manualStudent.selfResponsible} onCheckedChange={(checked) => setManualStudent((current) => ({ ...current, selfResponsible: checked === true }))} /> O aluno é o próprio responsável</label>
            {!manualStudent.selfResponsible ? <><p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Responsável</p>
            <div className="space-y-2"><Label htmlFor="manual-guardian-name">Nome do responsável</Label><Input id="manual-guardian-name" value={manualStudent.guardianName} onChange={(event) => setManualStudent((current) => ({ ...current, guardianName: event.target.value }))} required /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="manual-guardian-cpf">CPF do responsável</Label><Input id="manual-guardian-cpf" value={manualStudent.guardianCpf} onChange={(event) => setManualStudent((current) => ({ ...current, guardianCpf: event.target.value }))} required /></div><div className="space-y-2"><Label htmlFor="manual-guardian-phone">WhatsApp</Label><Input id="manual-guardian-phone" value={manualStudent.guardianPhone} onChange={(event) => setManualStudent((current) => ({ ...current, guardianPhone: event.target.value }))} required /></div></div></> : <p className="text-sm text-muted-foreground">A cobrança será enviada para o WhatsApp do aluno.</p>}
            <div className="space-y-2"><Label>Plano</Label><Select value={manualStudent.planId} onValueChange={(planId) => setManualStudent((current) => ({ ...current, planId }))}><SelectTrigger><SelectValue placeholder="Selecione o plano" /></SelectTrigger><SelectContent>{data.plans.filter((plan) => plan.status === "ACTIVE").map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectContent></Select></div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 text-sm font-medium"><Checkbox checked={manualStudent.customAmountEnabled} onCheckedChange={(checked) => setManualStudent((current) => ({ ...current, customAmountEnabled: checked === true, customAmount: checked === true ? current.customAmount : "" }))} /> Usar valor personalizado</label>
            {manualStudent.customAmountEnabled ? <div className="space-y-2"><Label htmlFor="manual-custom-amount">Valor mensal personalizado</Label><Input id="manual-custom-amount" value={manualStudent.customAmount} inputMode="decimal" placeholder="Ex.: 120,00" onChange={(event) => setManualStudent((current) => ({ ...current, customAmount: event.target.value }))} required /><p className="text-xs text-muted-foreground">O aluno continua no plano escolhido, mas as cobranças usarão este valor.</p></div> : null}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setManualOpen(false)}>Cancelar</Button><Button type="submit" disabled={manualSaving}>{manualSaving ? "Cadastrando…" : "Cadastrar aluno"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {publicForm?.configured && <section hidden
        className="card-surface space-y-5 p-5"
        aria-labelledby="public-form-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="public-form-title"
              className="text-sm font-semibold text-foreground"
            >
              Link de cadastro dos responsáveis
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Cada envio cria o aluno, o responsável e a matrícula no plano
              escolhido. O link não revela o identificador do local.
            </p>
          </div>
          {publicForm?.configured && (
            <div className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3">
              <Label htmlFor="public-form-active">Link ativo</Label>
              <Switch
                id="public-form-active"
                checked={publicForm.active}
                disabled={publicFormSaving}
                onCheckedChange={(active) => void updatePublicForm({ active })}
              />
            </div>
          )}
        </div>

        {!publicForm?.configured ? (
          <Button onClick={generateFormLink} disabled={publicFormSaving}>
            <Link2 className="size-4" /> Criar link de cadastro
          </Button>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                readOnly
                value={publicFormLink}
                className="min-h-11 flex-1"
              />
              <Button
                className="min-h-11"
                variant="outline"
                onClick={copyFormLink}
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}{" "}
                Copiar
              </Button>
              <Button className="min-h-11" variant="outline" asChild>
                <a href={publicFormLink} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> Visualizar
                </a>
              </Button>
              <Button
                className="min-h-11"
                variant="outline"
                disabled={publicFormSaving}
                onClick={() => void rotatePublicForm()}
              >
                Regenerar
              </Button>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Obrigatoriedade dos campos
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Todos os campos aparecem no formulário. Defina quais precisam
                ser preenchidos.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {standardFieldSettings.map(({ key, label }) => (
                  <div
                    key={key}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <Label htmlFor={`required-${key}`}>{label}</Label>
                    <Switch
                      id={`required-${key}`}
                      checked={publicForm.fieldConfiguration[key]}
                      disabled={publicFormSaving}
                      onCheckedChange={(required) =>
                        void updatePublicForm({
                          fieldConfiguration: { [key]: required },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>}

      {panel === "fields" && <div className="mx-auto w-full max-w-5xl space-y-5"><div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Sugestões rápidas:
        </span>
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.label}
            variant="outline"
            size="sm"
            onClick={() => openCreate(suggestion)}
          >
            <Plus className="size-3" /> {suggestion.label}
          </Button>
        ))}
      </div>

      {fields.length === 0 ? (
        <div className="card-surface p-12 text-center">
          <p className="text-sm font-medium text-foreground">
            Nenhum campo adicional ainda
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie campos como CPF, RG ou tipo sanguíneo e eles ficarão
            disponíveis no cadastro dos alunos.
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Campo</th>
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Perfil</th>
                <th className="px-5 py-3 font-medium">Obrigatório</th>
                <th className="px-5 py-3 font-medium">Ativo</th>
                <th className="w-24 px-5 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr
                  key={field.id}
                  className="border-b border-border last:border-0 hover:bg-muted/50"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <GripVertical
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                      <div>
                        <p className="font-medium text-foreground">
                          {field.label}
                        </p>
                        {field.options.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {field.options.join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {fieldTypeLabels[field.type]}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{field.subject === "STUDENT" ? "Aluno" : "Responsável"}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {field.required ? "Sim" : "Não"}
                  </td>
                  <td className="px-5 py-3">
                    <Switch
                      checked={field.active}
                      onCheckedChange={(checked) =>
                        toggleActive(field, checked)
                      }
                      aria-label={`Ativar ${field.label}`}
                    />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Editar ${field.label}`}
                      onClick={() => openEdit(field)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      aria-label={`Excluir ${field.label}`}
                      onClick={() => setDeleting(field)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar campo" : "Novo campo adicional"}
            </DialogTitle>
            <DialogDescription>
              Este campo aparecerá na seção "Dados adicionais" do cadastro de
              alunos.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fieldLabel">Nome do campo</Label>
              <Input
                id="fieldLabel"
                value={form.label}
                maxLength={60}
                placeholder="Adicione o nome do campo"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, label: event.target.value }))
                }
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo de dado</Label>
              <Select
                value={form.type}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    type: value as CustomFieldType,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(fieldTypeLabels) as CustomFieldType[]).map(
                    (type) => (
                      <SelectItem key={type} value={type}>
                        {fieldTypeLabels[type]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            {form.type === "SELECT" && (
              <div className="space-y-2">
                <Label>Perfil do campo</Label>
                <Select value={form.subject} onValueChange={(value) => setForm((prev) => ({ ...prev, subject: value as "STUDENT" | "GUARDIAN" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="STUDENT">Aluno</SelectItem><SelectItem value="GUARDIAN">Responsável</SelectItem></SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Perfil do campo</Label>
              <Select value={form.subject} onValueChange={(value) => setForm((prev) => ({ ...prev, subject: value as "STUDENT" | "GUARDIAN" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="STUDENT">Aluno</SelectItem><SelectItem value="GUARDIAN">Responsável</SelectItem></SelectContent>
              </Select>
            </div>

            {form.type === "SELECT" && (
              <div className="space-y-2">
                <Label htmlFor="fieldOptions">Opções (uma por linha)</Label>
                <Textarea
                  id="fieldOptions"
                  rows={5}
                  value={form.options}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      options: event.target.value,
                    }))
                  }
                  placeholder="Adicione uma opção por linha"
                />
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Obrigatório
                </p>
                <p className="text-xs text-muted-foreground">
                  Exige o preenchimento ao cadastrar um aluno.
                </p>
              </div>
              <Switch
                checked={form.required}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, required: checked }))
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Ativo</p>
                <p className="text-xs text-muted-foreground">
                  Campos inativos deixam de aparecer no cadastro.
                </p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, active: checked }))
                }
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : "Salvar campo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      </div>}

      {approvalQueueEnabled && panel === "pending" && <section className="space-y-4" aria-label="Solicitações pendentes">
        <div><h2 className="text-lg font-semibold">Solicitações pendentes</h2><p className="text-sm text-muted-foreground">Aprove ou recuse os cadastros enviados pelo link.</p></div>
        <EnrollmentPermissionsPanel />
      </section>}

      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(value) => !value && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{deleting?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Os valores já preenchidos desse campo em todos os alunos também
              serão apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
