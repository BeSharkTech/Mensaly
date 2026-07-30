import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, ClipboardList, Clock, Copy, FileText, Megaphone, Package, Pencil, Plus, Repeat, Search, Send, Trash2, Users } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";
import {
  useDashboardData,
  type BroadcastMessage,
  type BroadcastScheduleType,
  type BroadcastTarget,
} from "@/lib/data";
import { formatCents } from "@/lib/format";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/envio")({
  head: () => ({
    meta: [
      { title: "Envio de mensagens — Mensaly" },
      {
        name: "description",
        content:
          "Crie mensagens personalizadas por plano ou produto e escolha quais alunos vão receber cada envio.",
      },
      { property: "og:title", content: "Envio de mensagens — Mensaly" },
      {
        property: "og:description",
        content: "Mensagens personalizadas atribuídas a planos e produtos, enviadas para os alunos escolhidos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SendPage,
});

const emptyForm = {
  name: "",
  body: "",
  targetType: "GENERAL" as BroadcastTarget,
  planId: "",
  productId: "",
  eventId: "",
  scheduledAt: "",
  scheduleType: "MANUAL" as BroadcastScheduleType,
  dayOfMonth: "5",
  weekday: "1",
  sendTime: "09:00",
  repeatUntil: "",
};

/** ISO -> valor aceito pelo input datetime-local (horário local). */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatSchedule(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const weekdayLabels = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

/** Texto amigável da recorrência configurada na mensagem. */
function scheduleSummary(message: BroadcastMessage) {
  const time = message.sendTime?.slice(0, 5) || "09:00";
  const until = message.repeatUntil
    ? ` até ${new Date(`${message.repeatUntil}T00:00:00`).toLocaleDateString("pt-BR")}`
    : "";
  switch (message.scheduleType) {
    case "ONCE":
      return message.scheduledFor
        ? `Uma vez em ${formatSchedule(message.scheduledFor)}`
        : "Uma vez (data não definida)";
    case "DAILY":
      return `Todos os dias às ${time}${until}`;
    case "WEEKLY":
      return `Toda ${weekdayLabels[message.weekday ?? 1].toLowerCase()} às ${time}${until}`;
    case "MONTHLY":
      return `Todo dia ${message.dayOfMonth ?? 5} às ${time}${until}`;
    default:
      return "Envio manual";
  }
}

/** Próxima data/hora em que a mensagem recorrente deve sair. */
function nextOccurrence(message: BroadcastMessage): Date | null {
  const [hour, minute] = (message.sendTime || "09:00").split(":").map(Number);
  const now = new Date();

  const withinLimit = (date: Date) => {
    if (!message.repeatUntil) return date;
    return date <= new Date(`${message.repeatUntil}T23:59:59`) ? date : null;
  };

  if (message.scheduleType === "ONCE") {
    return message.scheduledFor ? new Date(message.scheduledFor) : null;
  }
  if (message.scheduleType === "DAILY") {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    if (date <= now) date.setDate(date.getDate() + 1);
    return withinLimit(date);
  }
  if (message.scheduleType === "WEEKLY") {
    const target = message.weekday ?? 1;
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    let delta = (target - date.getDay() + 7) % 7;
    if (delta === 0 && date <= now) delta = 7;
    date.setDate(date.getDate() + delta);
    return withinLimit(date);
  }
  if (message.scheduleType === "MONTHLY") {
    const day = message.dayOfMonth ?? 5;
    const date = new Date(now.getFullYear(), now.getMonth(), day, hour, minute);
    if (date <= now) date.setMonth(date.getMonth() + 1);
    return withinLimit(date);
  }
  return null;
}

const targetLabels: Record<BroadcastTarget, string> = {
  GENERAL: "Geral",
  PLAN: "Plano",
  PRODUCT: "Produto",
  EVENT: "Evento",
  FORM: "Formulário",
};

function SendPage() {
  const { data, refresh } = useDashboardData();
  const { state } = useAppState();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<BroadcastMessage | null>(null);
  const [deleting, setDeleting] = useState<BroadcastMessage | null>(null);
  const [sending, setSending] = useState<BroadcastMessage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dispatching, setDispatching] = useState(false);

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const businessIdForForm = state.business?.id ?? "";
  const formUrl =
    businessIdForForm && typeof window !== "undefined"
      ? `${window.location.origin}/formulario/${businessIdForForm}`
      : "";

  function insertFormLink() {
    if (!formUrl) {
      toast.error("Conclua o cadastro do negócio para gerar o formulário.");
      return;
    }
    setForm((prev) => ({
      ...prev,
      body: prev.body.includes(formUrl)
        ? prev.body
        : `${prev.body.trim() ? `${prev.body.trim()}\n\n` : ""}${formUrl}`,
    }));
  }

  async function copyFormLink() {
    if (!formUrl) return;
    await navigator.clipboard.writeText(formUrl);
    toast.success("Link do formulário copiado.");
  }

  const planName = (id: string | null) =>
    data.plans.find((plan) => plan.id === id)?.name ?? "Plano removido";
  const product = (id: string | null) => data.products.find((item) => item.id === id) ?? null;
  const eventItem = (id: string | null) => data.events.find((item) => item.id === id) ?? null;

  const term = query.trim().toLowerCase();
  const messages = useMemo(
    () =>
      data.broadcasts.filter(
        (message) =>
          !term ||
          message.name.toLowerCase().includes(term) ||
          message.body.toLowerCase().includes(term),
      ),
    [data.broadcasts, term],
  );

  const guardianPhone = (guardianId: string | null) =>
    data.guardians.find((guardian) => guardian.id === guardianId)?.phone ?? "";

  /** Alunos sugeridos para a mensagem: se for de plano, só quem está nesse plano. */
  const eligibleStudents = useMemo(() => {
    if (!sending) return [];
    if (sending.targetType === "PLAN" && sending.planId) {
      return data.students.filter((student) => student.planId === sending.planId);
    }
    return data.students;
  }, [sending, data.students]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(message: BroadcastMessage) {
    setEditing(message);
    setForm({
      name: message.name,
      body: message.body,
      targetType: message.targetType,
      planId: message.planId ?? "",
      productId: message.productId ?? "",
      eventId: message.eventId ?? "",
      scheduledAt: toLocalInput(message.scheduledFor),
      scheduleType: message.scheduleType ?? "MANUAL",
      dayOfMonth: String(message.dayOfMonth ?? 5),
      weekday: String(message.weekday ?? 1),
      sendTime: (message.sendTime || "09:00").slice(0, 5),
      repeatUntil: message.repeatUntil ?? "",
    });
    setOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!state.business?.id) {
      toast.error("Sessão expirada. Entre novamente.");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Informe um nome para a mensagem.");
      return;
    }
    if (!form.body.trim()) {
      toast.error("Escreva o texto da mensagem.");
      return;
    }
    if (form.targetType === "PLAN" && !form.planId) {
      toast.error("Escolha o plano da mensagem.");
      return;
    }
    if (form.targetType === "PRODUCT" && !form.productId) {
      toast.error("Escolha o produto da mensagem.");
      return;
    }
    if (form.targetType === "EVENT" && !form.eventId) {
      toast.error("Escolha o evento da mensagem.");
      return;
    }
    if (form.scheduleType === "ONCE" && !form.scheduledAt) {
      toast.error("Escolha a data e a hora do envio programado.");
      return;
    }
    if (form.scheduleType === "MONTHLY") {
      const day = Number(form.dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 28) {
        toast.error("Escolha um dia do mês entre 1 e 28.");
        return;
      }
    }

    setSaving(true);
    const bodyText =
      form.targetType === "FORM" && formUrl && !form.body.includes(formUrl)
        ? `${form.body.trim()}\n\n${formUrl}`
        : form.body.trim();
    const payload = {
      name: form.name.trim(),
      body: bodyText,
      targetType: form.targetType,
      planId: form.targetType === "PLAN" ? form.planId : null,
      productId: form.targetType === "PRODUCT" ? form.productId : null,
      eventId: form.targetType === "EVENT" ? form.eventId : null,
      scheduledFor:
        form.scheduleType === "ONCE" && form.scheduledAt
          ? new Date(form.scheduledAt).toISOString()
          : null,
      scheduleType: form.scheduleType,
      dayOfMonth: form.scheduleType === "MONTHLY" ? Number(form.dayOfMonth) : null,
      weekday: form.scheduleType === "WEEKLY" ? Number(form.weekday) : null,
      sendTime: form.scheduleType === "MANUAL" ? "09:00" : form.sendTime,
      repeatUntil:
        form.scheduleType !== "MANUAL" && form.scheduleType !== "ONCE" && form.repeatUntil
          ? form.repeatUntil
          : null,
    };

    try {
      await apiRequest(editing ? `/workspace/broadcasts/${editing.id}` : "/workspace/broadcasts", {
        method: editing ? "PATCH" : "POST",
        body: payload,
      });
    } catch {
      setSaving(false);
      toast.error("Não foi possível salvar a mensagem.");
      return;
    }
    setSaving(false);
    toast.success(editing ? "Mensagem atualizada." : "Mensagem criada.");
    setOpen(false);
    await refresh();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await apiRequest(`/workspace/broadcasts/${deleting.id}`, { method: "DELETE" });
    } catch {
      toast.error("Não foi possível excluir a mensagem.");
      return;
    }
    toast.success("Mensagem excluída.");
    setDeleting(null);
    await refresh();
  }

  function openSend(message: BroadcastMessage) {
    setSending(message);
    setSelected([]);
  }

  async function handleSend() {
    if (!sending) return;
    if (selected.length === 0) {
      toast.error("Selecione ao menos um aluno.");
      return;
    }
    const scheduledDate = sending.scheduleType === "MANUAL" ? null : nextOccurrence(sending);
    if (sending.scheduleType !== "MANUAL" && !scheduledDate) {
      toast.error("A recorrência já terminou. Ajuste a programação da mensagem.");
      return;
    }
    if (!state.business?.id) {
      toast.error("Sessão expirada. Entre novamente.");
      return;
    }

    setDispatching(true);
    try {
      await apiRequest("/workspace/broadcast-sends", {
        method: "POST",
        body: {
          messageId: sending.id,
          studentIds: selected,
          scheduledFor: scheduledDate ? scheduledDate.toISOString() : null,
        },
      });
    } catch {
      setDispatching(false);
      toast.error("Não foi possível registrar o envio.");
      return;
    }
    setDispatching(false);
    toast.success(
      scheduledDate
        ? `Envio programado para ${selected.length} aluno(s) em ${formatSchedule(scheduledDate.toISOString())}.`
        : `Mensagem colocada na fila para ${selected.length} aluno(s).`,
    );
    setSending(null);
    setSelected([]);
    await refresh();
  }

  function sendsOf(messageId: string) {
    return data.broadcastSends.filter(
      (send) => send.messageId === messageId && send.status !== "SCHEDULED",
    ).length;
  }

  function scheduledOf(messageId: string) {
    return data.broadcastSends.filter(
      (send) => send.messageId === messageId && send.status === "SCHEDULED",
    ).length;
  }


  return (
    <AppShell>
      <PageHeader
        title="Envio de mensagens"
        description="Crie mensagens personalizadas por plano ou produto e escolha quem vai receber."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Nova mensagem
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar mensagem"
            className="pl-9"
          />
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Megaphone className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhuma mensagem criada</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie mensagens atribuídas a planos ou produtos para enviar aos alunos.
          </p>
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="size-4" /> Nova mensagem
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {messages.map((message) => {
            const linkedProduct = product(message.productId);
            const linkedEvent = eventItem(message.eventId);
            return (
              <article
                key={message.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-foreground">{message.name}</h2>
                    <Badge variant="secondary" className="mt-1 gap-1">
                      {message.targetType === "PLAN" ? (
                        <ClipboardList className="size-3" />
                      ) : message.targetType === "PRODUCT" ? (
                        <Package className="size-3" />
                      ) : message.targetType === "EVENT" ? (
                        <CalendarDays className="size-3" />
                      ) : message.targetType === "FORM" ? (
                        <FileText className="size-3" />
                      ) : (
                        <Megaphone className="size-3" />
                      )}
                      {message.targetType === "PLAN"
                        ? planName(message.planId)
                        : message.targetType === "PRODUCT"
                          ? (linkedProduct?.name ?? "Produto removido")
                          : message.targetType === "EVENT"
                            ? (linkedEvent?.name ?? "Evento removido")
                            : message.targetType === "FORM"
                              ? targetLabels.FORM
                              : targetLabels.GENERAL}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(message)} aria-label="Editar">
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(message)} aria-label="Excluir">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {linkedProduct ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-2">
                    {linkedProduct.imageDataUrl ? (
                      <img
                        src={linkedProduct.imageDataUrl}
                        alt={linkedProduct.name}
                        className="size-10 rounded-md object-cover"
                      />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-md bg-background">
                        <Package className="size-4 text-muted-foreground" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">{linkedProduct.name}</p>
                      <p className="text-xs text-muted-foreground">{formatCents(linkedProduct.priceCents)}</p>
                    </div>
                  </div>
                ) : null}

                {linkedEvent ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-2">
                    {linkedEvent.imageDataUrl ? (
                      <img
                        src={linkedEvent.imageDataUrl}
                        alt={linkedEvent.name}
                        className="size-10 rounded-md object-cover"
                      />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-md bg-background">
                        <CalendarDays className="size-4 text-muted-foreground" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">{linkedEvent.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatSchedule(linkedEvent.startsAt)}
                        {linkedEvent.location ? ` · ${linkedEvent.location}` : ""}
                      </p>
                    </div>
                  </div>
                ) : null}

                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{message.body}</p>

                {message.scheduleType !== "MANUAL" ? (
                  <Badge variant="outline" className="w-fit gap-1">
                    {message.scheduleType === "ONCE" ? (
                      <Clock className="size-3" />
                    ) : (
                      <Repeat className="size-3" />
                    )}
                    {scheduleSummary(message)}
                  </Badge>
                ) : null}

                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="size-3" /> {sendsOf(message.id)} envio(s)
                    </span>
                    {scheduledOf(message.id) > 0 ? (
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {scheduledOf(message.id)} programado(s)
                      </span>
                    ) : null}
                  </span>

                  <Button size="sm" onClick={() => openSend(message)}>
                    <Send className="size-4" />
                    {message.scheduleType === "MANUAL" ? "Enviar" : "Programar"}
                  </Button>

                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar mensagem" : "Nova mensagem"}</DialogTitle>
              <DialogDescription>
                Personalize o texto e atribua a mensagem a um plano ou produto.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome da mensagem</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="Adicione o título da mensagem"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="target">Atribuir a</Label>
                <Select
                  value={form.targetType}
                  onValueChange={(value) => set("targetType", value as BroadcastTarget)}
                >
                  <SelectTrigger id="target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GENERAL">Mensagem geral</SelectItem>
                    <SelectItem value="PLAN">Plano</SelectItem>
                    <SelectItem value="PRODUCT">Produto</SelectItem>
                    <SelectItem value="EVENT">Evento</SelectItem>
                    <SelectItem value="FORM">Formulário de dados do aluno</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.targetType === "PLAN" ? (
                <div className="space-y-2">
                  <Label htmlFor="plan">Plano</Label>
                  <Select value={form.planId} onValueChange={(value) => set("planId", value)}>
                    <SelectTrigger id="plan">
                      <SelectValue placeholder="Escolha o plano" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.plans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {form.targetType === "PRODUCT" ? (
                <div className="space-y-2">
                  <Label htmlFor="product">Produto</Label>
                  <Select value={form.productId} onValueChange={(value) => set("productId", value)}>
                    <SelectTrigger id="product">
                      <SelectValue placeholder="Escolha o produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.products.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} — {formatCents(item.priceCents)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {form.targetType === "EVENT" ? (
                <div className="space-y-2">
                  <Label htmlFor="event">Evento</Label>
                  <Select value={form.eventId} onValueChange={(value) => set("eventId", value)}>
                    <SelectTrigger id="event">
                      <SelectValue placeholder="Escolha o evento" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.events.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} — {formatSchedule(item.startsAt)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {form.targetType === "FORM" ? (
                <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                  <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <FileText className="size-4" /> Link do formulário de dados do aluno
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {formUrl || "Conclua o cadastro do negócio para gerar o link."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={insertFormLink}>
                      <Plus className="size-4" /> Inserir link na mensagem
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={copyFormLink}>
                      <Copy className="size-4" /> Copiar link
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="body">Mensagem</Label>
                <Textarea
                  id="body"
                  rows={5}
                  value={form.body}
                  onChange={(event) => set("body", event.target.value)}
                  placeholder="Adicione o texto da mensagem"
                />
              </div>

              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="space-y-2">
                  <Label htmlFor="schedule-type">Frequência de envio</Label>
                  <Select
                    value={form.scheduleType}
                    onValueChange={(value) => set("scheduleType", value as BroadcastScheduleType)}
                  >
                    <SelectTrigger id="schedule-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MANUAL">Manual — envio quando eu quiser</SelectItem>
                      <SelectItem value="ONCE">Uma vez — data e hora específicas</SelectItem>
                      <SelectItem value="DAILY">Em loop — todos os dias</SelectItem>
                      <SelectItem value="WEEKLY">Em loop — toda semana</SelectItem>
                      <SelectItem value="MONTHLY">Em loop — todo mês (ex.: dia 5)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Cobranças de plano costumam rodar em loop mensal; mensagens de evento normalmente
                    são enviadas uma única vez.
                  </p>
                </div>

                {form.scheduleType === "ONCE" ? (
                  <div className="space-y-2">
                    <Label htmlFor="scheduled-at">Data e hora do envio</Label>
                    <Input
                      id="scheduled-at"
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={(event) => set("scheduledAt", event.target.value)}
                    />
                  </div>
                ) : null}

                {form.scheduleType === "MONTHLY" ? (
                  <div className="space-y-2">
                    <Label htmlFor="day-of-month">Dia do mês</Label>
                    <Input
                      id="day-of-month"
                      type="number"
                      min={1}
                      max={28}
                      value={form.dayOfMonth}
                      onChange={(event) => set("dayOfMonth", event.target.value)}
                    />
                  </div>
                ) : null}

                {form.scheduleType === "WEEKLY" ? (
                  <div className="space-y-2">
                    <Label htmlFor="weekday">Dia da semana</Label>
                    <Select value={form.weekday} onValueChange={(value) => set("weekday", value)}>
                      <SelectTrigger id="weekday">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {weekdayLabels.map((label, index) => (
                          <SelectItem key={label} value={String(index)}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {form.scheduleType === "DAILY" ||
                form.scheduleType === "WEEKLY" ||
                form.scheduleType === "MONTHLY" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="send-time">Horário</Label>
                      <Input
                        id="send-time"
                        type="time"
                        value={form.sendTime}
                        onChange={(event) => set("sendTime", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="repeat-until">Repetir até (opcional)</Label>
                      <Input
                        id="repeat-until"
                        type="date"
                        value={form.repeatUntil}
                        onChange={(event) => set("repeatUntil", event.target.value)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>


            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar mensagem"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={sending !== null} onOpenChange={(value) => (value ? null : setSending(null))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar mensagem</DialogTitle>
            <DialogDescription>
              Selecione quais alunos vão receber “{sending?.name}”.
              {sending && sending.scheduleType !== "MANUAL"
                ? ` ${scheduleSummary(sending)}. Próximo envio: ${
                    nextOccurrence(sending)
                      ? formatSchedule(nextOccurrence(sending)!.toISOString())
                      : "recorrência encerrada"
                  }.`
                : ""}
            </DialogDescription>

          </DialogHeader>

          <div className="space-y-3 py-2">
            {sending ? (
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                {sending.body}
              </p>
            ) : null}

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                Alunos ({selected.length}/{eligibleStudents.length})
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected(
                    selected.length === eligibleStudents.length
                      ? []
                      : eligibleStudents.map((student) => student.id),
                  )
                }
              >
                {selected.length === eligibleStudents.length && eligibleStudents.length > 0
                  ? "Limpar seleção"
                  : "Selecionar todos"}
              </Button>
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {eligibleStudents.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">Nenhum aluno disponível.</p>
              ) : (
                eligibleStudents.map((student) => {
                  const checked = selected.includes(student.id);
                  return (
                    <label
                      key={student.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          setSelected((prev) =>
                            value ? [...prev, student.id] : prev.filter((id) => id !== student.id),
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">{student.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {student.plan} · {guardianPhone(student.guardianId) || "Sem telefone"}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSending(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSend} disabled={dispatching}>
              {dispatching
                ? "Salvando..."
                : sending && sending.scheduleType !== "MANUAL"
                  ? `Programar para ${selected.length} aluno(s)`
                  : `Enviar para ${selected.length} aluno(s)`}
            </Button>


          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(value) => (value ? null : setDeleting(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir mensagem</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem “{deleting?.name}” e o histórico de envios serão removidos.
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
