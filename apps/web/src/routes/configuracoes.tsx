import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { BrandColorPicker } from "@/components/brand-color-picker";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEFAULT_BRAND_COLOR,
  isValidHexColor,
} from "@/lib/branding";
import { saveBusinessSettings, useAppState } from "@/lib/store";
import { apiRequest } from "@/lib/api";
import type { PublicEnrollmentFormSettings } from "@/lib/public-enrollment";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Personalize sua conta" },
      {
        name: "description",
        content:
          "Dados cadastrais do negócio, logo, cor de destaque e preferências da conta.",
      },
      {
        property: "og:title",
        content: "Configurações — Personalize sua conta",
      },
      {
        property: "og:description",
        content:
          "Perfil da organização, identidade visual e preferências da conta.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { state, refresh } = useAppState();
  const business = state.business;
  const account = state.account;
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [saving, setSaving] = useState(false);
  const [enrollmentForm, setEnrollmentForm] = useState<PublicEnrollmentFormSettings | null>(null);
  const [enrollmentModeSaving, setEnrollmentModeSaving] = useState(false);

  useEffect(() => {
    if (!business) return;
    setName(business.name);
    setSegment(business.segment);
    setPhone(business.phone);
    setCity(business.city);
    setLogoDataUrl(business.logoDataUrl);
    setBrandColor(business.brandColor || DEFAULT_BRAND_COLOR);
  }, [business]);

  useEffect(() => {
    void apiRequest<PublicEnrollmentFormSettings>("/workspace/public-enrollment-form")
      .then(setEnrollmentForm)
      .catch(() => setEnrollmentForm({ configured: false }));
  }, []);

  async function setEnrollmentMode(mode: "OFF" | "SAFE" | "AUTOMATIC") {
    setEnrollmentModeSaving(true);
    try {
      let form = enrollmentForm;
      if (!form?.configured && mode !== "OFF") {
        form = await apiRequest<PublicEnrollmentFormSettings>("/workspace/public-enrollment-form", { method: "POST" });
      }
      if (!form?.configured) return;
      const next = await apiRequest<PublicEnrollmentFormSettings>("/workspace/public-enrollment-form", {
        method: "PATCH",
        body: { active: mode !== "OFF", fieldConfiguration: { approvalMode: mode === "AUTOMATIC" ? "AUTOMATIC" : "SAFE" } },
      });
      setEnrollmentForm(next);
      toast.success("Modo de cadastro atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o modo.");
    } finally {
      setEnrollmentModeSaving(false);
    }
  }

  function handleLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 1024 * 512) {
      toast.error("Imagem muito grande. Envie um arquivo de até 512 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Informe o nome do negócio.");
      return;
    }
    if (!isValidHexColor(brandColor)) {
      toast.error("Cor inválida. Use o formato #RRGGBB.");
      return;
    }
    setSaving(true);
    try {
      await saveBusinessSettings({
        name: name.trim(),
        segment: segment.trim(),
        phone: phone.trim(),
        city: city.trim(),
        logoDataUrl,
        brandColor,
      });
      await refresh();
      toast.success("Configurações salvas.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as alterações.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Configurações"
        description="Perfil da organização, identidade visual e dados da conta."
        actions={
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        }
      />

      <Tabs defaultValue="organizacao">
        <TabsList>
          <TabsTrigger value="organizacao">Organização</TabsTrigger>
          <TabsTrigger value="marca">Identidade visual</TabsTrigger>
          <TabsTrigger value="recebimentos">Recebimentos</TabsTrigger>
          <TabsTrigger value="cadastro">Cadastro de alunos</TabsTrigger>
          <TabsTrigger value="conta">Conta</TabsTrigger>
        </TabsList>

        <TabsContent value="organizacao" className="mt-4">
          <div className="card-surface max-w-2xl space-y-5 p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Situação da organização
              </p>
              <StatusBadge
                status={state.onboardingComplete ? "ACTIVE" : "PENDING"}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Nome do negócio</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="segment">Segmento</Label>
                <Input
                  id="segment"
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Cidade</Label>
                <Input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="marca" className="mt-4">
          <div className="card-surface max-w-2xl space-y-6 p-6">
            <div className="space-y-3">
              <div>
                <Label>Logo do negócio</Label>
                <p className="text-xs text-muted-foreground">
                  Aparece no menu lateral no lugar da marca padrão. PNG ou SVG,
                  até 512 KB.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                  {logoDataUrl ? (
                    <img
                      src={logoDataUrl}
                      alt="Logo do negócio"
                      className="size-full object-contain"
                    />
                  ) : (
                    <ImagePlus className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                  >
                    Enviar imagem
                  </Button>
                  {logoDataUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setLogoDataUrl(null)}
                    >
                      Remover
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleLogo(e.target.files?.[0])}
                />
              </div>
            </div>

            <BrandColorPicker
              value={brandColor}
              onChange={setBrandColor}
              preview
            />
          </div>
        </TabsContent>

        <TabsContent value="recebimentos" className="mt-4">
          <div className="card-surface max-w-2xl space-y-4 p-6">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Recebimentos online
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A conexão com o Mercado Pago é opcional. Configure-a para gerar
                links e receber as mensalidades diretamente na conta da escola.
              </p>
            </div>
            <Button asChild>
              <a href="/onboarding?step=payments">Configurar recebimentos</a>
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="cadastro" className="mt-4">
          <div className="card-surface max-w-3xl space-y-6 p-6">
            <div>
              <h2 className="text-base font-semibold text-foreground">Modo de cadastro</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Defina se os alunos serão cadastrados apenas manualmente ou se o local usará um formulário público.
              </p>
            </div>
            <div className="grid gap-3">
              {([
                ["OFF", "Somente cadastro manual", "O link público, QR Code e solicitações ficam desativados."],
                ["SAFE", "Link com aprovação", "Recomendado: cada cadastro enviado fica pendente até sua confirmação."],
                ["AUTOMATIC", "Link automático", "O aluno é cadastrado imediatamente após o envio do formulário."],
              ] as const).map(([mode, title, description]) => {
                const currentMode = !enrollmentForm?.configured || !enrollmentForm.active
                  ? "OFF"
                  : enrollmentForm.fieldConfiguration.approvalMode;
                const selected = currentMode === mode;
                return <button
                  key={mode}
                  type="button"
                  disabled={enrollmentModeSaving}
                  onClick={() => void setEnrollmentMode(mode)}
                  className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/50"}`}
                >
                  <span className="block text-sm font-semibold text-foreground">{title}{mode === "SAFE" ? " · recomendado" : ""}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
                </button>;
              })}
            </div>
            {enrollmentForm?.configured && enrollmentForm.active && enrollmentForm.fieldConfiguration.approvalMode === "AUTOMATIC" ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                Atenção: no modo automático, dados incorretos ou cadastros mal-intencionados entram no sistema sem revisão. Use por sua conta e risco.
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="conta" className="mt-4">
          <div className="card-surface max-w-2xl space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="user">Nome</Label>
                <Input
                  id="user"
                  defaultValue={account?.name ?? ""}
                  key={account?.name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  defaultValue={account?.email ?? ""}
                  key={account?.email}
                  disabled
                />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
