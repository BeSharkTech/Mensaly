import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Barcode,
  Check,
  Copy,
  CreditCard,
  Loader2,
  Lock,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  decodeCheckoutToken,
  fakeBoletoLine,
  fakePixCode,
  methodLabels,
  type CheckoutMethod,
  type CheckoutPayload,
} from "@/lib/checkout";
import { formatCents, formatDate, formatReferenceMonth } from "@/lib/format";
import { apiRequest } from "@/lib/api";
import { applyBrandColor, DEFAULT_BRAND_COLOR, isValidHexColor } from "@/lib/branding";

export const Route = createFileRoute("/pagar/$token")({
  head: () => ({
    meta: [
      { title: "Pagamento da mensalidade — Mensaly" },
      {
        name: "description",
        content:
          "Página de pagamento da mensalidade: escolha entre Pix, boleto ou cartão e conclua em poucos segundos.",
      },
      { property: "og:title", content: "Pagamento da mensalidade — Mensaly" },
      {
        property: "og:description",
        content: "Pague a mensalidade por Pix, boleto ou cartão em poucos segundos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CheckoutPage,
});

const methods: { id: CheckoutMethod; icon: typeof QrCode; hint: string }[] = [
  { id: "PIX", icon: QrCode, hint: "Aprovação imediata" },
  { id: "BOLETO", icon: Barcode, hint: "Compensa em até 3 dias úteis" },
  { id: "CARD", icon: CreditCard, hint: "Em até 12x" },
];

type Branding = {
  name: string;
  logoDataUrl: string | null;
  brandColor: string;
  city: string;
  segment: string;
};

/** Iniciais usadas quando o negócio não tem logo cadastrada. */
function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** Busca nome, logo e cor do negócio para personalizar o checkout. */
function useBranding(payload: CheckoutPayload): Branding {
  const [branding, setBranding] = useState<Branding>({
    name: payload.business,
    logoDataUrl: null,
    brandColor:
      payload.brandColor && isValidHexColor(payload.brandColor)
        ? payload.brandColor
        : DEFAULT_BRAND_COLOR,
    city: "",
    segment: "",
  });

  useEffect(() => {
    let active = true;
    if (!payload.businessId) return;
    apiRequest<{
      business: {
        name: string;
        logoDataUrl: string | null;
        brandColor: string | null;
        city: string;
        segment: string;
      };
    }>(`/public/forms/${payload.businessId}`)
      .then(({ business }) => {
        if (!active) return;
        setBranding((prev) => ({
          name: business.name || prev.name,
          logoDataUrl: business.logoDataUrl,
          brandColor: isValidHexColor(business.brandColor ?? "")
            ? business.brandColor!
            : prev.brandColor,
          city: business.city,
          segment: business.segment,
        }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [payload.businessId]);

  useEffect(() => {
    applyBrandColor(branding.brandColor);
  }, [branding.brandColor]);

  return branding;
}

function CheckoutPage() {
  const { token } = Route.useParams();
  const payload = useMemo(() => decodeCheckoutToken(token), [token]);

  if (!payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <div className="card-surface max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">Link inválido</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este link de pagamento expirou ou está incompleto. Peça um novo link para a escola.
          </p>
        </div>
      </main>
    );
  }

  return <CheckoutContent payload={payload} />;
}

function CheckoutContent({ payload }: { payload: CheckoutPayload }) {
  const [method, setMethod] = useState<CheckoutMethod>("PIX");
  const [processing, setProcessing] = useState(false);
  const [paid, setPaid] = useState(false);
  const branding = useBranding(payload);

  const pixCode = useMemo(() => fakePixCode(payload), [payload]);
  const boletoLine = useMemo(() => fakeBoletoLine(payload), [payload]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("Não foi possível copiar. Selecione manualmente.");
    }
  }

  function pay() {
    setProcessing(true);
    window.setTimeout(() => {
      setProcessing(false);
      setPaid(true);
    }, 1400);
  }

  const accent = branding.brandColor;

  return (
    <main className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <header className="flex flex-col items-center gap-3 text-center">
          {branding.logoDataUrl ? (
            <img
              src={branding.logoDataUrl}
              alt={`Logo de ${branding.name}`}
              className="size-20 rounded-2xl bg-card object-contain p-2 shadow-sm ring-1 ring-border"
            />
          ) : (
            <span
              className="flex size-20 items-center justify-center rounded-2xl text-2xl font-semibold text-primary-foreground shadow-sm"
              style={{ backgroundColor: accent }}
              aria-hidden
            >
              {initialsOf(branding.name) || "•"}
            </span>
          )}
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-foreground">{branding.name}</h1>
            <p className="text-xs text-muted-foreground">
              {[branding.segment, branding.city].filter(Boolean).join(" · ") || "Pagamento seguro"}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Ambiente de teste
          </span>
        </header>

        <div className="flex flex-col gap-6">
          <section className="card-surface p-6 sm:p-7">
            {paid ? (
              <div className="flex flex-col items-center py-10 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-secondary">
                  <BadgeCheck className="size-7 text-foreground" />
                </span>
                <h2 className="mt-4 text-lg font-semibold text-foreground">
                  {method === "BOLETO" ? "Boleto gerado" : "Pagamento confirmado"}
                </h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {method === "BOLETO"
                    ? "Use a linha digitável para pagar no seu banco. A baixa é automática após a compensação."
                    : `Recebemos ${formatCents(payload.amountCents)} via ${methodLabels[method]}. O comprovante foi enviado para a escola.`}
                </p>
                <Button variant="outline" className="mt-6" onClick={() => setPaid(false)}>
                  Fazer outro teste
                </Button>
              </div>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-foreground">Escolha a forma de pagamento</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {methods.map(({ id, icon: Icon, hint }) => {
                    const active = method === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMethod(id)}
                        aria-pressed={active}
                        className={`rounded-lg border p-3 text-left transition ${
                          active
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:bg-muted/60"
                        }`}
                      >
                        <Icon className="size-5 text-muted-foreground" />
                        <p className="mt-2 text-sm font-medium text-foreground">{methodLabels[id]}</p>
                        <p className="text-xs text-muted-foreground">{hint}</p>
                      </button>
                    );
                  })}
                </div>

                <Separator className="my-6" />

                {method === "PIX" ? (
                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6">
                      <QrCode className="size-24 text-muted-foreground" aria-hidden />
                      <p className="text-xs text-muted-foreground">
                        QR Code de demonstração — nenhuma cobrança real é feita.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Input readOnly value={pixCode} className="font-mono text-xs" aria-label="Pix copia e cola" />
                      <Button variant="outline" onClick={() => copy(pixCode, "Código Pix")}>
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}

                {method === "BOLETO" ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-dashed border-border p-6 text-center">
                      <Barcode className="mx-auto size-16 text-muted-foreground" aria-hidden />
                      <p className="mt-2 text-xs text-muted-foreground">
                        Vencimento em {formatDate(payload.dueDate)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={boletoLine}
                        className="font-mono text-xs"
                        aria-label="Linha digitável"
                      />
                      <Button variant="outline" onClick={() => copy(boletoLine, "Linha digitável")}>
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}

                {method === "CARD" ? (
                  <form
                    className="grid gap-4 sm:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      pay();
                    }}
                    id="card-form"
                  >
                    <div className="sm:col-span-2">
                      <Label htmlFor="card-name">Nome impresso no cartão</Label>
                      <Input id="card-name" placeholder="Nome impresso no cartão" autoComplete="cc-name" required />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="card-number">Número do cartão</Label>
                      <Input
                        id="card-number"
                        inputMode="numeric"
                        placeholder="Número do cartão"
                        autoComplete="cc-number"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="card-exp">Validade</Label>
                      <Input id="card-exp" placeholder="MM/AA" autoComplete="cc-exp" required />
                    </div>
                    <div>
                      <Label htmlFor="card-cvc">CVV</Label>
                      <Input id="card-cvc" placeholder="CVV" autoComplete="cc-csc" required />
                    </div>
                  </form>
                ) : null}

                <Button
                  className="mt-6 w-full"
                  disabled={processing}
                  onClick={pay}
                  type={method === "CARD" ? "submit" : "button"}
                  form={method === "CARD" ? "card-form" : undefined}
                  style={accent ? { backgroundColor: accent } : undefined}
                >
                  {processing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Processando…
                    </>
                  ) : method === "BOLETO" ? (
                    "Gerar boleto"
                  ) : (
                    `Pagar ${formatCents(payload.amountCents)}`
                  )}
                </Button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3" /> Simulação de checkout — sem cobrança real.
                </p>
              </>
            )}
          </section>

          <aside className="card-surface order-first h-fit p-6 sm:p-7">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-semibold text-foreground">Resumo da cobrança</h2>
              <span className="text-2xl font-semibold text-foreground">
                {formatCents(payload.amountCents)}
              </span>
            </div>
            <Separator className="my-4" />
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Aluno</dt>
                <dd className="text-right font-medium text-foreground">{payload.student}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Plano</dt>
                <dd className="text-right text-foreground">{payload.plan}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Referência</dt>
                <dd className="text-right text-foreground">
                  {formatReferenceMonth(payload.referenceMonth)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Vencimento</dt>
                <dd className="text-right text-foreground">{formatDate(payload.dueDate)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Cobrança</dt>
                <dd className="text-right font-mono text-xs text-muted-foreground">
                  {payload.chargeId.slice(0, 8)}
                </dd>
              </div>
            </dl>
            <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Check className="mt-0.5 size-3 shrink-0" />
              Pix, boleto e cartão disponíveis neste link.
            </p>
          </aside>
        </div>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Cobrança emitida por {branding.name} · Mensaly
        </footer>
      </div>
    </main>
  );
}
