import { createFileRoute } from "@tanstack/react-router";
import { ImagePlus, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
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
import { useDashboardData, type Product } from "@/lib/data";
import { formatCents } from "@/lib/format";

export const Route = createFileRoute("/estoque")({
  head: () => ({
    meta: [
      { title: "Estoque de produtos — Mensaly" },
      {
        name: "description",
        content:
          "Cadastre uniformes, materiais e outros produtos com foto, preço, descrição e quantidade em estoque.",
      },
      { property: "og:title", content: "Estoque de produtos — Mensaly" },
      {
        property: "og:description",
        content: "Controle os produtos vendidos pela sua operação em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StockPage,
});

const emptyForm = {
  name: "",
  description: "",
  price: "",
  stock: "0",
  status: "ACTIVE",
};

/** Converte reais digitados ("129,90") em centavos inteiros. */
function toCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return -1;
  return Math.round(parsed * 100);
}

function StockPage() {
  const { data, refresh } = useDashboardData();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [image, setImage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const term = query.trim().toLowerCase();
  const products = useMemo(
    () =>
      data.products.filter(
        (product) =>
          !term ||
          product.name.toLowerCase().includes(term) ||
          product.description.toLowerCase().includes(term),
      ),
    [data.products, term],
  );

  const totalValue = data.products.reduce(
    (total, product) => total + product.priceCents * product.stockQuantity,
    0,
  );

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setImage(null);
    setOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      name: product.name,
      description: product.description,
      price: (product.priceCents / 100).toFixed(2).replace(".", ","),
      stock: String(product.stockQuantity),
      status: product.status,
    });
    setImage(product.imageDataUrl);
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
      toast.error("Informe o nome do produto.");
      return;
    }
    const priceCents = toCents(form.price || "0");
    if (priceCents < 0) {
      toast.error("Informe um valor válido.");
      return;
    }
    const stock = Number(form.stock || "0");
    if (!Number.isInteger(stock) || stock < 0) {
      toast.error("Informe uma quantidade válida.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim().slice(0, 120),
        description: form.description.trim().slice(0, 500),
        priceCents,
        stockQuantity: stock,
        imageDataUrl: image,
        status: form.status,
      };
      if (editing) {
        await apiRequest(`/workspace/products/${editing.id}`, {
          method: "PATCH",
          body: payload,
        });
        toast.success("Produto atualizado.");
      } else {
        await apiRequest("/workspace/products", { method: "POST", body: payload });
        toast.success("Produto cadastrado.");
      }
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
      await apiRequest(`/workspace/products/${deleting.id}`, { method: "DELETE" });
      toast.success("Produto excluído.");
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
        title="Estoque"
        description="Cadastre uniformes, materiais e outros produtos vendidos pela sua operação."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Novo produto
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou descrição"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {data.products.length} produto(s) · valor em estoque {formatCents(totalValue)}
        </p>
      </div>

      {products.length === 0 ? (
        <div className="card-surface flex flex-col items-center gap-3 p-12 text-center">
          <Package className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {data.products.length === 0
              ? "Nenhum produto cadastrado ainda."
              : "Nenhum produto encontrado para essa busca."}
          </p>
          {data.products.length === 0 ? (
            <Button variant="outline" onClick={openCreate}>
              <Plus className="size-4" /> Cadastrar primeiro produto
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <article key={product.id} className="card-surface overflow-hidden">
              <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                {product.imageDataUrl ? (
                  <img
                    src={product.imageDataUrl}
                    alt={`Foto do produto ${product.name}`}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <Package className="size-10 text-muted-foreground" />
                )}
              </div>
              <div className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-medium text-foreground">{product.name}</h2>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {product.description || "Sem descrição"}
                    </p>
                  </div>
                  <StatusBadge status={product.status} />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <p className="text-lg font-semibold text-foreground">
                    {formatCents(product.priceCents)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {product.stockQuantity} em estoque
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(product)}>
                    <Pencil className="size-4" /> Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(product)}
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
            <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
            <DialogDescription>
              Informe nome, valor, descrição e a foto que aparece no catálogo.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                {image ? (
                  <img src={image} alt="Pré-visualização do produto" className="size-full object-cover" />
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
                <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
                  <ImagePlus className="size-4" /> {image ? "Trocar foto" : "Adicionar foto"}
                </Button>
                {image ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setImage(null)}
                  >
                    Remover foto
                  </Button>
                ) : null}
                <p className="text-xs text-muted-foreground">PNG ou JPG de até 1,5 MB.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="productName">Nome do produto</Label>
              <Input
                id="productName"
                value={form.name}
                maxLength={120}
                placeholder="Adicione o nome do produto"
                onChange={(event) => set("name", event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="productDescription">Descrição</Label>
              <Textarea
                id="productDescription"
                value={form.description}
                maxLength={500}
                rows={3}
                placeholder="Adicione a descrição"
                onChange={(event) => set("description", event.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="productPrice">Valor (R$)</Label>
                <Input
                  id="productPrice"
                  value={form.price}
                  inputMode="decimal"
                  placeholder="0,00"
                  onChange={(event) => set("price", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="productStock">Quantidade</Label>
                <Input
                  id="productStock"
                  type="number"
                  min={0}
                  value={form.stock}
                  onChange={(event) => set("stock", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="productStatus">Situação</Label>
                <Select value={form.status} onValueChange={(value) => set("status", value)}>
                  <SelectTrigger id="productStatus">
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : editing ? "Salvar alterações" : "Cadastrar produto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(value) => !value && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `${deleting.name} será removido do estoque. Esta ação não pode ser desfeita.`
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
