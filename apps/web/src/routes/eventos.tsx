import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarDays,
  ImagePlus,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";
import { useDashboardData, type EventItem } from "@/lib/data";
import { formatCents } from "@/lib/format";

export const Route = createFileRoute("/eventos")({
  head: () => ({
    meta: [
      { title: "Eventos e torneios — Mensaly" },
      {
        name: "description",
        content:
          "Cadastre campeonatos, torneios e outros eventos com data, local, valor de inscrição e imagem.",
      },
      { property: "og:title", content: "Eventos e torneios — Mensaly" },
      {
        property: "og:description",
        content:
          "Organize os eventos da sua operação e divulgue-os para os alunos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventsPage,
});

const emptyForm = {
  name: "",
  description: "",
  location: "",
  startsAt: "",
  endsAt: "",
  price: "",
  status: "ACTIVE",
};

/** Converte reais digitados ("129,90") em centavos inteiros. */
function toCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return -1;
  return Math.round(parsed * 100);
}

/** ISO -> valor aceito pelo input datetime-local (horário local). */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function EventsPage() {
  const { data, refresh } = useDashboardData();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [image, setImage] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [deleting, setDeleting] = useState<EventItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const term = query.trim().toLowerCase();
  const events = useMemo(
    () =>
      data.events.filter(
        (item) =>
          !term ||
          item.name.toLowerCase().includes(term) ||
          item.description.toLowerCase().includes(term) ||
          item.location.toLowerCase().includes(term),
      ),
    [data.events, term],
  );

  const upcoming = data.events.filter(
    (item) => new Date(item.startsAt) >= new Date(),
  ).length;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setImage(null);
    setOpen(true);
  }

  function openEdit(item: EventItem) {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description,
      location: item.location,
      startsAt: toLocalInput(item.startsAt),
      endsAt: toLocalInput(item.endsAt),
      price: (item.priceCents / 100).toFixed(2).replace(".", ","),
      status: item.status,
    });
    setImage(item.imageDataUrl);
    setOpen(true);
  }

  function handleImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > 1_500_000) {
      toast.error("A imagem deve ter no máximo 1,5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.onerror = () => toast.error("Não foi possível ler a imagem.");
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Informe o nome do evento.");
      return;
    }
    if (!form.startsAt) {
      toast.error("Informe a data e a hora de início.");
      return;
    }
    if (form.endsAt && new Date(form.endsAt) < new Date(form.startsAt)) {
      toast.error("O término não pode ser antes do início.");
      return;
    }
    const priceCents = toCents(form.price || "0");
    if (priceCents < 0) {
      toast.error("Informe um valor de inscrição válido.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim().slice(0, 120),
        description: form.description.trim().slice(0, 500),
        location: form.location.trim().slice(0, 160),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        priceCents,
        imageDataUrl: image,
        status: form.status,
      };
      if (editing) {
        await apiRequest(`/workspace/events/${editing.id}`, {
          method: "PATCH",
          body: payload,
        });
        toast.success("Evento atualizado.");
      } else {
        await apiRequest("/workspace/events", {
          method: "POST",
          body: payload,
        });
        toast.success("Evento cadastrado.");
      }
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

  async function handleDelete() {
    if (!deleting) return;
    setRemoving(true);
    try {
      await apiRequest(`/workspace/events/${deleting.id}`, {
        method: "DELETE",
      });
      toast.success("Evento excluído.");
      setDeleting(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível excluir.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Eventos"
        description="Cadastre campeonatos, torneios e outras atividades da sua operação."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Novo evento
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, descrição ou local"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {data.events.length} evento(s) · {upcoming} próximo(s)
        </p>
      </div>

      {events.length === 0 ? (
        <div className="card-surface flex flex-col items-center gap-3 p-12 text-center">
          <CalendarDays className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {data.events.length === 0
              ? "Nenhum evento cadastrado ainda."
              : "Nenhum evento encontrado para essa busca."}
          </p>
          {data.events.length === 0 ? (
            <Button variant="outline" onClick={openCreate}>
              <Plus className="size-4" /> Cadastrar primeiro evento
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((item) => (
            <article key={item.id} className="card-surface overflow-hidden">
              <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                {item.imageDataUrl ? (
                  <img
                    src={item.imageDataUrl}
                    alt={`Imagem do evento ${item.name}`}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <CalendarDays className="size-10 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium text-foreground">
                      {item.name}
                    </h2>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {item.description || "Sem descrição"}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <CalendarDays className="size-4 shrink-0" />
                    {formatDateTime(item.startsAt)}
                    {item.endsAt ? ` até ${formatDateTime(item.endsAt)}` : ""}
                  </p>
                  {item.location ? (
                    <p className="flex items-center gap-2">
                      <MapPin className="size-4 shrink-0" />
                      <span className="truncate">{item.location}</span>
                    </p>
                  ) : null}
                </div>
                <p className="text-lg font-semibold text-foreground">
                  {item.priceCents > 0
                    ? formatCents(item.priceCents)
                    : "Gratuito"}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(item)}
                  >
                    <Pencil className="size-4" /> Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 className="size-4" /> Excluir
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar evento" : "Novo evento"}
            </DialogTitle>
            <DialogDescription>
              Informe nome, data, local, valor de inscrição e a imagem de
              divulgação.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                {image ? (
                  <img
                    src={image}
                    alt="Pré-visualização do evento"
                    className="size-full object-cover"
                  />
                ) : (
                  <ImagePlus className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImage}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus className="size-4" />{" "}
                  {image ? "Trocar imagem" : "Adicionar imagem"}
                </Button>
                {image ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setImage(null)}
                  >
                    Remover imagem
                  </Button>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  PNG ou JPG de até 1,5 MB.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventName">Nome do evento</Label>
              <Input
                id="eventName"
                value={form.name}
                maxLength={120}
                placeholder="Adicione o nome do evento"
                onChange={(event) => set("name", event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventDescription">Descrição</Label>
              <Textarea
                id="eventDescription"
                value={form.description}
                maxLength={500}
                rows={3}
                placeholder="Adicione a descrição"
                onChange={(event) => set("description", event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventLocation">Local</Label>
              <Input
                id="eventLocation"
                value={form.location}
                maxLength={160}
                placeholder="Adicione o local"
                onChange={(event) => set("location", event.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="eventStart">Início</Label>
                <Input
                  id="eventStart"
                  type="datetime-local"
                  value={form.startsAt}
                  onInput={(event) =>
                    set("startsAt", event.currentTarget.value)
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eventEnd">Término (opcional)</Label>
                <Input
                  id="eventEnd"
                  type="datetime-local"
                  value={form.endsAt}
                  onInput={(event) => set("endsAt", event.currentTarget.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="eventPrice">Inscrição (R$)</Label>
                <Input
                  id="eventPrice"
                  value={form.price}
                  inputMode="decimal"
                  placeholder="0,00"
                  onChange={(event) => set("price", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eventStatus">Situação</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => set("status", value)}
                >
                  <SelectTrigger id="eventStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Ativo</SelectItem>
                    <SelectItem value="INACTIVE">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Salvando..."
                  : editing
                    ? "Salvar alterações"
                    : "Cadastrar evento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(value) => !value && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir evento</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `${deleting.name} será removido da agenda. Esta ação não pode ser desfeita.`
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
    </AppShell>
  );
}
