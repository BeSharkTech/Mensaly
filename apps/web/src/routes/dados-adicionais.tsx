import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, GripVertical, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { useDashboardData, type CustomField, type CustomFieldType } from "@/lib/data";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/dados-adicionais")({
  head: () => ({
    meta: [
      { title: "Gerenciamento de dados adicionais — Mensaly" },
      {
        name: "description",
        content:
          "Crie os campos opcionais do cadastro de alunos: CPF, RG, tipo sanguíneo, alergias e qualquer dado que o seu nicho precise.",
      },
      { property: "og:title", content: "Gerenciamento de dados adicionais — Mensaly" },
      {
        property: "og:description",
        content: "Configure os campos extras que aparecem no cadastro de cada aluno.",
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
  { label: "CPF", type: "TEXT" as CustomFieldType, options: "" },
  { label: "RG", type: "TEXT" as CustomFieldType, options: "" },
  {
    label: "Tipo sanguíneo",
    type: "SELECT" as CustomFieldType,
    options: "A+\nA-\nB+\nB-\nAB+\nAB-\nO+\nO-",
  },
  { label: "Alergias", type: "TEXT" as CustomFieldType, options: "" },
  { label: "Convênio médico", type: "TEXT" as CustomFieldType, options: "" },
  { label: "Contato de emergência", type: "TEXT" as CustomFieldType, options: "" },
  { label: "Autoriza uso de imagem", type: "BOOLEAN" as CustomFieldType, options: "" },
];

const emptyForm = {
  label: "",
  type: "TEXT" as CustomFieldType,
  options: "",
  required: false,
  active: true,
};

function CustomFieldsPage() {
  const { data, refresh } = useDashboardData();
  const { state } = useAppState();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [deleting, setDeleting] = useState<CustomField | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formLink, setFormLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fields = data.customFields;
  const activeFields = fields.filter((field) => field.active);

  function generateFormLink() {
    const businessId = state.business?.id;
    if (!businessId) {
      toast.error("Sessão inválida. Faça login novamente.");
      return;
    }
    if (activeFields.length === 0) {
      toast.error("Crie ao menos um campo ativo antes de gerar o formulário.");
      return;
    }
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    setFormLink(`${origin}/formulario/${businessId}`);
    setCopied(false);
  }

  async function copyFormLink() {
    if (!formLink) return;
    await navigator.clipboard.writeText(formLink);
    setCopied(true);
    toast.success("Link copiado.");
    setTimeout(() => setCopied(false), 2000);
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
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
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
      await apiRequest(`/workspace/custom-fields/${deleting.id}`, { method: "DELETE" });
    } catch {
      toast.error("Não foi possível excluir o campo.");
      return;
    }
    toast.success("Campo excluído.");
    setDeleting(null);
    await refresh();
  }

  return (
    <AppShell>
      <PageHeader
        title="Gerenciamento de dados adicionais"
        description="Crie os campos opcionais do seu nicho. Tudo o que for criado aqui aparece no cadastro de cada aluno."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={generateFormLink}>
              <Link2 className="size-4" /> Gerar formulário
            </Button>
            <Button onClick={() => openCreate()}>
              <Plus className="size-4" /> Novo campo
            </Button>
          </div>
        }
      />

      {formLink && (
        <div className="card-surface space-y-3 p-5">
          <div>
            <p className="text-sm font-medium text-foreground">Link do formulário do aluno</p>
            <p className="text-xs text-muted-foreground">
              O aluno informa o nome completo e preenche os {activeFields.length} campos ativos. As
              respostas são vinculadas automaticamente ao cadastro dele.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input readOnly value={formLink} className="min-w-[240px] flex-1" />
            <Button variant="outline" onClick={copyFormLink}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copiar
            </Button>
            <Button variant="outline" asChild>
              <a href={formLink} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Abrir
              </a>
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Sugestões rápidas:</span>
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
          <p className="text-sm font-medium text-foreground">Nenhum campo adicional ainda</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie campos como CPF, RG ou tipo sanguíneo e eles ficarão disponíveis no cadastro dos
            alunos.
          </p>
        </div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Campo</th>
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Obrigatório</th>
                <th className="px-5 py-3 font-medium">Ativo</th>
                <th className="w-24 px-5 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <GripVertical className="size-4 text-muted-foreground" aria-hidden />
                      <div>
                        <p className="font-medium text-foreground">{field.label}</p>
                        {field.options.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {field.options.join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{fieldTypeLabels[field.type]}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {field.required ? "Sim" : "Não"}
                  </td>
                  <td className="px-5 py-3">
                    <Switch
                      checked={field.active}
                      onCheckedChange={(checked) => toggleActive(field, checked)}
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
            <DialogTitle>{editing ? "Editar campo" : "Novo campo adicional"}</DialogTitle>
            <DialogDescription>
              Este campo aparecerá na seção "Dados adicionais" do cadastro de alunos.
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
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo de dado</Label>
              <Select
                value={form.type}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, type: value as CustomFieldType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(fieldTypeLabels) as CustomFieldType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {fieldTypeLabels[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
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
                    setForm((prev) => ({ ...prev, options: event.target.value }))
                  }
                  placeholder="Adicione uma opção por linha"
                />
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Obrigatório</p>
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
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, active: checked }))}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : "Salvar campo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(value) => !value && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{deleting?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Os valores já preenchidos desse campo em todos os alunos também serão apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
