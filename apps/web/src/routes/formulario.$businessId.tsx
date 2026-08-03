import { createFileRoute } from "@tanstack/react-router";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { applyBrandColor, DEFAULT_BRAND_COLOR, isValidHexColor } from "@/lib/branding";
import { apiRequest } from "@/lib/api";
import type { StudentFormConfig } from "@/lib/student-form.functions";

export const Route = createFileRoute("/formulario/$businessId")({
  head: () => ({
    meta: [
      { title: "Formulário de dados do aluno — Mensaly" },
      {
        name: "description",
        content:
          "Preencha os dados complementares do aluno. As informações são vinculadas automaticamente ao cadastro pelo nome completo.",
      },
      { property: "og:title", content: "Formulário de dados do aluno" },
      {
        property: "og:description",
        content: "Complete o cadastro do aluno em poucos minutos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudentFormPage,
});

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function StudentFormPage() {
  // This project renders TanStack route components through Next's catch-all
  // page, so dynamic parameters must come from Next's pathname.
  const pathname = usePathname();
  const businessId = decodeURIComponent(pathname.split("/")[2] ?? "");

  const { data, isLoading, error } = useQuery({
    queryKey: ["student-form", businessId],
    queryFn: () =>
      apiRequest<StudentFormConfig>(`/public/forms/${businessId}`),
    retry: false,
  });

  const [studentCpf, setStudentCpf] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const accent = useMemo(() => {
    const color = data?.business.brandColor ?? "";
    return isValidHexColor(color) ? color : DEFAULT_BRAND_COLOR;
  }, [data?.business.brandColor]);

  useEffect(() => {
    applyBrandColor(accent);
  }, [accent]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const cpf = studentCpf.replace(/\D/g, "");
    if (cpf.length !== 11) {
      toast.error("Informe o CPF do aluno com 11 dígitos.");
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<{ studentName: string; saved: number }>(
        `/public/forms/${businessId}/responses`,
        {
          method: "POST",
          body: { cpf, values },
        },
      );
      setDone(result.studentName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar o formulário.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/40 pb-12">
      <div
        className="px-4 py-8"
        style={{
          background: `linear-gradient(135deg, ${accent}, color-mix(in oklab, ${accent} 65%, #000))`,
        }}
      >
        <header className="mx-auto flex w-full max-w-2xl items-center gap-3">
          {data?.business.logoDataUrl ? (
            <img
              src={data.business.logoDataUrl}
              alt={`Logo de ${data.business.name}`}
              className="size-14 shrink-0 rounded-xl bg-white object-contain p-1 shadow-sm"
            />
          ) : (
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg font-semibold text-white ring-1 ring-white/30"
              aria-hidden
            >
              {initialsOf(data?.business.name ?? "") || "•"}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-white">
              {data?.business.name ?? "Formulário do aluno"}
            </h1>
            <p className="truncate text-xs text-white/80">
              {[data?.business.segment, data?.business.city].filter(Boolean).join(" · ") ||
                "Dados complementares do aluno"}
            </p>
          </div>
        </header>
      </div>

      <div className="mx-auto -mt-4 w-full max-w-2xl px-4">
        {isLoading ? (
          <div className="card-surface flex items-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando formulário…
          </div>
        ) : error || !data ? (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            Formulário indisponível. Verifique o link com a secretaria.
          </div>
        ) : done ? (
          <div className="card-surface p-10 text-center">
            <CheckCircle2 className="mx-auto size-10 text-primary" />
            <p className="mt-3 text-base font-semibold text-foreground">Dados enviados!</p>
            <p className="mt-1 text-sm text-muted-foreground">
              As informações de {done} já foram adicionadas ao cadastro.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card-surface space-y-5 p-6">
            <div className="space-y-2">
              <Label htmlFor="studentCpf">CPF do aluno</Label>
              <Input
                id="studentCpf"
                value={studentCpf}
                inputMode="numeric"
                maxLength={14}
                placeholder="000.000.000-00"
                onChange={(event) => setStudentCpf(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Usamos o CPF para vincular as respostas ao cadastro correto.
              </p>
            </div>

            {data.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum campo adicional foi configurado ainda.
              </p>
            ) : (
              data.fields.map((field) => {
                const value = values[field.id] ?? "";
                const setValue = (next: string) =>
                  setValues((prev) => ({ ...prev, [field.id]: next }));
                return (
                  <div key={field.id} className="space-y-2">
                    <Label htmlFor={`field-${field.id}`}>
                      {field.label}
                      {field.required && <span className="text-destructive"> *</span>}
                    </Label>
                    {field.type === "SELECT" ? (
                      <Select value={value} onValueChange={setValue}>
                        <SelectTrigger id={`field-${field.id}`}>
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
                      <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                        <Switch
                          id={`field-${field.id}`}
                          checked={value === "Sim"}
                          onCheckedChange={(checked) => setValue(checked ? "Sim" : "Não")}
                        />
                        <span className="text-sm text-muted-foreground">
                          {value === "Sim" ? "Sim" : "Não"}
                        </span>
                      </div>
                    ) : (
                      <Input
                        id={`field-${field.id}`}
                        type={
                          field.type === "NUMBER"
                            ? "number"
                            : field.type === "DATE"
                              ? "date"
                              : "text"
                        }
                        maxLength={500}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        required={field.required}
                      />
                    )}
                  </div>
                );
              })
            )}

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Enviando…" : "Enviar dados"}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Formulário enviado por {data?.business.name ?? "sua escola"} · Mensaly
        </p>
      </div>
    </main>
  );
}
