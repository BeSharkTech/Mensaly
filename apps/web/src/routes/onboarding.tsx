import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Plus, Trash2, WalletCards } from "lucide-react";

import logo from "@/assets/mensaly-logo.png";
import { BrandColorPicker } from "@/components/brand-color-picker";
import {
  StripeEmbeddedOnboarding,
  type StripeOnboardingSession,
} from "@/components/stripe-embedded-onboarding";
import { DEFAULT_BRAND_COLOR } from "@/lib/branding";
import { ThemeToggle } from "@/components/theme-toggle";
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
import { formatCents } from "@/lib/format";
import { apiRequest } from "@/lib/api";
import { saveOnboarding, segments, useAppState, type Plan } from "@/lib/store";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Configurar seu negócio — Mensaly" },
      {
        name: "description",
        content:
          "Cadastre os dados do seu negócio, a logo, o segmento e os planos com o dia de cobrança.",
      },
      { property: "og:title", content: "Configurar seu negócio — Mensaly" },
      {
        property: "og:description",
        content: "Dados do negócio, logo, segmento e planos com dia de cobrança.",
      },
    ],
  }),
  component: OnboardingPage,
});

const steps = ["Seu negócio", "Identidade visual", "Planos", "Recebimentos (opcional)"];

type StripeConnection = {
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  accountType?: "STANDARD" | "EXPRESS";
};

function OnboardingPage() {
  const navigate = useNavigate();
  const searchParams = useSearchParams();
  const stripeReturn = searchParams.get("stripe");
  const openPayments = searchParams.get("step") === "payments";
  const { state, hydrated, refresh } = useAppState();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [draft, setDraft] = useState({ name: "", description: "", amount: "", chargeOpenDay: "1", chargeOpenTime: "00:00", dueDay: "5" });
  const [error, setError] = useState("");
  const [stripeConnection, setStripeConnection] = useState<StripeConnection | null>(null);
  const [stripeSession, setStripeSession] = useState<StripeOnboardingSession | null>(null);
  const [stripeSessionKey, setStripeSessionKey] = useState(0);

  useEffect(() => {
    if (!hydrated) return;
    if (!state.account) {
      navigate({ to: "/cadastro" });
      return;
    }
    if (state.business) {
      setName(state.business.name);
      setSegment(state.business.segment);
      setPhone(state.business.phone);
      setCity(state.business.city);
      setLogoDataUrl(state.business.logoDataUrl);
      setBrandColor(state.business.brandColor || DEFAULT_BRAND_COLOR);
    }
    if (state.plans.length) setPlans(state.plans);
  }, [hydrated, state.account, state.business, state.plans, navigate]);

  useEffect(() => {
    if (!hydrated || (!stripeReturn && !openPayments)) return;
    setStep(3);
    if (!stripeReturn) return;
    setSaving(true);
    apiRequest<StripeConnection>("/payment-integrations/stripe/refresh", { method: "POST" })
      .then(setStripeConnection)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o Stripe."),
      )
      .finally(() => setSaving(false));
  }, [hydrated, stripeReturn, openPayments]);

  function handleLogo(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  function addPlan() {
    const cents = Math.round(Number(draft.amount.replace(/\./g, "").replace(",", ".")) * 100);
    if (!draft.name.trim() || !Number.isFinite(cents) || cents <= 0) {
      setError("Informe o nome do plano e um valor válido.");
      return;
    }
    const day = Math.min(31, Math.max(1, Number(draft.dueDay) || 5));
    const chargeOpenDay = Math.min(day, Math.max(1, Number(draft.chargeOpenDay) || 1));
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.chargeOpenTime)) {
      setError("Informe o horário de abertura no formato HH:mm.");
      return;
    }
    setPlans((current) => [
      ...current,
      {
        id: `pln_${Date.now()}`,
        name: draft.name.trim(),
        description: draft.description.trim(),
        amountCents: cents,
        chargeOpenDay,
        chargeOpenTime: draft.chargeOpenTime,
        dueDay: day,
        status: "ACTIVE",
      },
    ]);
    setDraft({ name: "", description: "", amount: "", chargeOpenDay: "1", chargeOpenTime: "00:00", dueDay: "5" });
    setError("");
  }

  function next() {
    setError("");
    if (step === 0) {
      if (!name.trim() || !segment) {
        setError("Informe o nome do negócio e o segmento.");
        return;
      }
    }
    setStep((s) => s + 1);
  }

  const [saving, setSaving] = useState(false);

  async function prepareStripeOnboarding() {
    setSaving(true);
    setError("");
    try {
      const session = await apiRequest<StripeOnboardingSession>(
        "/payment-integrations/stripe/onboarding-session",
        { method: "POST" },
      );
      if (!session.clientSecret || !session.publishableKey) {
        throw new Error("A configuração segura de recebimentos está indisponível.");
      }
      setStripeSession(session);
      setStripeSessionKey((current) => current + 1);
    } catch (reason) {
      setStripeSession(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível abrir a configuração de recebimentos.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function refreshStripeAfterExit() {
    setSaving(true);
    setError("");
    try {
      const connection = await apiRequest<StripeConnection>(
        "/payment-integrations/stripe/refresh",
        { method: "POST" },
      );
      setStripeConnection(connection);
      if (connection.status !== "ENABLED") {
        setError(
          "Ainda existem dados obrigatórios pendentes. Revise o formulário para liberar cobranças e repasses.",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível confirmar o status dos recebimentos.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function connectStripe() {
    if (!plans.length) {
      setError("Cadastre pelo menos um plano para continuar.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveOnboarding({
        business: { name: name.trim(), segment, phone, city, logoDataUrl, brandColor },
        plans,
        onboardingComplete: false,
      });
      const connection = await apiRequest<StripeConnection>(
        stripeConnection?.accountType === "STANDARD"
          ? "/payment-integrations/stripe/reconnect"
          : "/payment-integrations/stripe/account",
        { method: "POST" },
      );
      setStripeConnection(connection);
      setStep(3);
      if (connection.status !== "ENABLED") {
        const session = await apiRequest<StripeOnboardingSession>(
          "/payment-integrations/stripe/onboarding-session",
          { method: "POST" },
        );
        if (!session.clientSecret || !session.publishableKey) {
          throw new Error("A configuração segura de recebimentos está indisponível.");
        }
        setStripeSession(session);
        setStripeSessionKey((current) => current + 1);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível conectar os recebimentos.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    if (!plans.length) {
      setError("Cadastre pelo menos um plano para continuar.");
      return;
    }
    setSaving(true);
    try {
      await saveOnboarding({
        business: { name: name.trim(), segment, phone, city, logoDataUrl, brandColor },
        plans,
        onboardingComplete: true,
      });
      await refresh();
      navigate({ to: "/" });
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Não foi possível salvar. Tente de novo.",
      );
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <img src={logo.src} alt="Mensaly" className="h-8 w-auto" />
          <ThemeToggle />
        </div>

        <ol className="mb-6 flex items-start gap-2 text-xs font-medium">
          {steps.map((label, index) => (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={
                  index <= step
                    ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    : "flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
                }
              >
                {index < step ? <Check className="size-3" /> : index + 1}
              </span>
              <span
                className={`${index <= step ? "text-foreground" : "text-muted-foreground"} min-w-0 break-words text-[11px] leading-tight sm:text-xs`}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>

        <div className="card-surface p-6 sm:p-8">
          {step === 0 ? (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold text-foreground">Sobre o seu negócio</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Esses dados aparecem no painel e nas mensagens enviadas aos responsáveis.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="biz-name">Nome do negócio</Label>
                <Input
                  id="biz-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Adicione o nome do negócio"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="biz-segment">Segmento</Label>
                <Select value={segment} onValueChange={setSegment}>
                  <SelectTrigger id="biz-segment">
                    <SelectValue placeholder="Selecione o segmento" />
                  </SelectTrigger>
                  <SelectContent>
                    {segments.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="biz-phone">Telefone / WhatsApp</Label>
                  <Input
                    id="biz-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Digite o telefone"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="biz-city">Cidade</Label>
                  <Input
                    id="biz-city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Adicione a cidade"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-semibold text-foreground">Identidade visual</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Opcional. A imagem fica salva localmente no seu navegador.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                  {logoDataUrl ? (
                    <img src={logoDataUrl} alt="Logo do negócio" className="size-full object-contain" />
                  ) : (
                    <ImagePlus className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                    Enviar imagem
                  </Button>
                  {logoDataUrl ? (
                    <Button type="button" variant="ghost" onClick={() => setLogoDataUrl(null)}>
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
              <BrandColorPicker value={brandColor} onChange={setBrandColor} preview />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold text-foreground">Planos e cobrança</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Defina o valor mensal, o dia de abertura e o vencimento de cada plano.
                </p>
              </div>

              {plans.length ? (
                <ul className="space-y-2">
                  {plans.map((plan) => (
                    <li
                      key={plan.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{plan.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCents(plan.amountCents)}/mês · abre dia {plan.chargeOpenDay}, às {plan.chargeOpenTime} · vence dia {plan.dueDay}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remover ${plan.name}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPlans((c) => c.filter((p) => p.id !== plan.id))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="plan-name">Nome do plano</Label>
                    <Input
                      id="plan-name"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="Adicione o nome do plano"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plan-desc">Descrição</Label>
                    <Input
                      id="plan-desc"
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      placeholder="Adicione a descrição"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plan-amount">Valor mensal (R$)</Label>
                    <Input
                      id="plan-amount"
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
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
                      value={draft.chargeOpenDay}
                      onChange={(e) => setDraft({ ...draft, chargeOpenDay: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plan-open-time">Horário de abertura</Label>
                    <Input
                      id="plan-open-time"
                      type="time"
                      value={draft.chargeOpenTime}
                      onChange={(e) => setDraft({ ...draft, chargeOpenTime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plan-day">Dia de vencimento</Label>
                    <Input
                      id="plan-day"
                      type="number"
                      min={1}
                      max={31}
                      value={draft.dueDay}
                      onChange={(e) => setDraft({ ...draft, dueDay: e.target.value })}
                    />
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={addPlan}>
                  <Plus className="size-4" /> Adicionar plano
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-semibold text-foreground">Receba suas mensalidades</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Esta etapa é opcional. Conecte o Stripe agora ou continue usando o painel e configure os recebimentos quando precisar gerar cobranças online.
                </p>
              </div>
              <div className="flex gap-4 rounded-lg border border-border p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <WalletCards className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {stripeConnection?.status === "ENABLED"
                      ? "Conta pronta para receber"
                      : "Conecte sua conta de recebimentos"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    CPF/CNPJ, documentos e dados bancários são solicitados somente ao conectar o Stripe; esses dados não ficam salvos na Mensaly.
                  </p>
                </div>
              </div>
              {stripeConnection && stripeConnection.status !== "ENABLED" ? (
                <p className="text-sm text-muted-foreground">
                  Status: {stripeConnection.status}. Se o Stripe pediu uma correção, continue o cadastro para concluir.
                </p>
              ) : null}
              {stripeSession && stripeConnection?.status !== "ENABLED" ? (
                <StripeEmbeddedOnboarding
                  key={stripeSessionKey}
                  session={stripeSession}
                  onExit={refreshStripeAfterExit}
                  onRetry={prepareStripeOnboarding}
                />
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 text-sm text-destructive" role="alert" aria-live="polite">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              <ArrowLeft className="size-4" /> Voltar
            </Button>
            {step < steps.length - 1 ? (
              <Button type="button" onClick={next} disabled={saving}>
                {saving ? "Salvando..." : "Continuar"}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={stripeSession ? refreshStripeAfterExit : stripeConnection ? prepareStripeOnboarding : connectStripe}
                  disabled={saving || stripeConnection?.status === "ENABLED"}
                >
                  {saving
                    ? "Verificando..."
                    : stripeSession
                      ? "Verificar conclusão"
                      : stripeConnection?.status === "ENABLED"
                        ? "Recebimentos conectados"
                        : stripeConnection
                          ? "Continuar configuração"
                          : "Conectar Stripe agora"}{" "}
                  <ArrowRight className="size-4" />
                </Button>
                <Button type="button" onClick={finish} disabled={saving}>
                  {saving ? "Salvando..." : "Concluir e abrir o painel"} <Check className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
