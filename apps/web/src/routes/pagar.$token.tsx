import { CardPayment, initMercadoPago, Payment } from "@mercadopago/sdk-react";
import { createFileRoute } from "@tanstack/react-router";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Clock3, Copy, CreditCard, Loader2, Lock, QrCode, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/api";
import { applyBrandColor, DEFAULT_BRAND_COLOR, isValidHexColor } from "@/lib/branding";
import { formatCents, formatDateOnly, formatReferenceMonth } from "@/lib/format";

export const Route = createFileRoute("/pagar/$token")({
  head: () => ({
    meta: [
      { title: "Pagamento da mensalidade — Mensaly" },
      { name: "description", content: "Checkout seguro para pagamento da mensalidade por Pix ou cartão." },
    ],
  }),
  component: CheckoutPage,
});

type CheckoutStatus = "OPEN" | "PROCESSING" | "PAID" | "EXPIRED" | "FAILED" | "REFUNDED" | "DISPUTED";

type PublicCheckout = {
  checkoutId: string;
  status: CheckoutStatus;
  amountCents: number;
  currency: string;
  expiresAt: string;
  publicKey: string;
  charge: { dueDate: string; referenceMonth: string; status: string };
  student: { name: string };
  organization: {
    name: string;
    brand: null | { logoDataUrl?: string; primaryColor?: string; segment?: string };
  };
};

type PaymentResult = {
  orderId: string;
  paymentId?: string;
  status: CheckoutStatus;
  statusDetail: string;
  pix?: { qrCode?: string; qrCodeBase64?: string; ticketUrl?: string };
};

type CheckoutMethod = "pix" | "card";

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function CheckoutPage() {
  const pathname = usePathname();
  const token = decodeURIComponent(pathname.split("/")[2] ?? "");
  const [details, setDetails] = useState<PublicCheckout | null>(null);
  const [payment, setPayment] = useState<PaymentResult | null>(null);
  const [brickReady, setBrickReady] = useState(false);
  const [checkoutMethod, setCheckoutMethod] = useState<CheckoutMethod>("pix");
  const [error, setError] = useState("");

  const loadDetails = useCallback(async (reconcile = false) => {
    const checkout = await apiRequest<PublicCheckout>(
      `/public/mercadopago-checkout/${encodeURIComponent(token)}${reconcile ? "/reconcile" : ""}`,
      reconcile ? { method: "POST" } : undefined,
    );
    setDetails(checkout);
    return checkout;
  }, [token]);

  useEffect(() => {
    let active = true;
    setError("");
    apiRequest<PublicCheckout>(`/public/mercadopago-checkout/${encodeURIComponent(token)}`)
      .then((checkout) => {
        if (!active) return;
        initMercadoPago(checkout.publicKey, { locale: "pt-BR" });
        setDetails(checkout);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Este checkout está indisponível.");
      });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (details?.status !== "PROCESSING") return;
    const interval = window.setInterval(() => {
      loadDetails(true).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [details?.status, loadDetails]);

  const brandColor = useMemo(() => {
    const candidate = details?.organization.brand?.primaryColor ?? "";
    return isValidHexColor(candidate) ? candidate : DEFAULT_BRAND_COLOR;
  }, [details]);

  useEffect(() => applyBrandColor(brandColor), [brandColor]);

  async function submitPayment(submission: unknown) {
    setError("");
    try {
      const result = await apiRequest<PaymentResult>(
        `/public/mercadopago-checkout/${encodeURIComponent(token)}/process`,
        { method: "POST", body: submission },
      );
      setPayment(result);
      await loadDetails(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Não foi possível processar o pagamento.";
      setError(message);
      throw reason;
    }
  }

  async function copyPix() {
    if (!payment?.pix?.qrCode) return;
    await navigator.clipboard.writeText(payment.pix.qrCode);
    toast.success("Código Pix copiado.");
  }

  async function submitCardPayment(formData: unknown) {
    await submitPayment({
      paymentType: "credit_card",
      selectedPaymentMethod: "credit_card",
      formData,
    });
  }

  function selectCheckoutMethod(method: CheckoutMethod) {
    setBrickReady(false);
    setError("");
    setCheckoutMethod(method);
  }

  if (error && !details) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
        <div className="card-surface max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold text-foreground">Checkout indisponível</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <p className="mt-2 text-xs text-muted-foreground">Peça um novo link para a escola.</p>
        </div>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="Carregando checkout" />
      </main>
    );
  }

  const paid = details.status === "PAID" || details.charge.status === "PAID";
  const processing = details.status === "PROCESSING";
  const unavailable = ["EXPIRED", "FAILED", "REFUNDED", "DISPUTED"].includes(details.status);
  const brand = details.organization.brand;

  return (
    <main className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <header className="flex flex-col items-center gap-3 text-center">
          {brand?.logoDataUrl ? (
            <img src={brand.logoDataUrl} alt={`Logo de ${details.organization.name}`} className="size-20 rounded-2xl bg-card object-contain p-2 shadow-sm ring-1 ring-border" />
          ) : (
            <span className="flex size-20 items-center justify-center rounded-2xl text-2xl font-semibold text-primary-foreground shadow-sm" style={{ backgroundColor: brandColor }} aria-hidden>
              {initialsOf(details.organization.name) || "M"}
            </span>
          )}
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-foreground">{details.organization.name}</h1>
            <p className="text-xs text-muted-foreground">{brand?.segment || "Pagamento seguro"}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Pagamento seguro
          </span>
        </header>

        <section className="card-surface overflow-hidden p-6 sm:p-7">
          {paid ? (
            <div className="flex flex-col items-center py-10 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-secondary"><BadgeCheck className="size-7 text-foreground" /></span>
              <h2 className="mt-4 text-lg font-semibold text-foreground">Pagamento confirmado</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">O pagamento foi confirmado pelo provedor e registrado pela escola.</p>
            </div>
          ) : unavailable ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Clock3 className="size-10 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold text-foreground">
                {details.status === "REFUNDED" ? "Pagamento devolvido" : details.status === "DISPUTED" ? "Pagamento em análise" : "Link indisponível"}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {details.status === "REFUNDED"
                  ? "O Mercado Pago informou a devolução. Solicite um novo link à escola se a mensalidade continuar em aberto."
                  : details.status === "DISPUTED"
                    ? "O Mercado Pago está analisando este pagamento. Entre em contato com a escola antes de tentar novamente."
                    : "Este link não aceita mais pagamentos. Solicite um novo link à escola."}
              </p>
            </div>
          ) : processing ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Clock3 className="size-10 text-primary" />
              <h2 className="mt-4 text-lg font-semibold text-foreground">Aguardando confirmação</h2>
              <p className="mt-1 text-sm text-muted-foreground">A tela será atualizada automaticamente após a confirmação do Mercado Pago.</p>
              {payment?.pix?.qrCodeBase64 ? (
                <img src={`data:image/png;base64,${payment.pix.qrCodeBase64}`} alt="QR Code Pix" className="mt-5 size-56 rounded-lg border border-border" />
              ) : null}
              {payment?.pix?.qrCode ? (
                <Button type="button" variant="outline" className="mt-4" onClick={copyPix}><Copy className="size-4" /> Copiar Pix</Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mb-6 grid grid-cols-2 gap-3" role="group" aria-label="Escolha o meio de pagamento">
                <Button
                  type="button"
                  variant="outline"
                  className={`h-auto min-h-14 justify-start gap-3 px-4 py-3 text-left transition-none ${
                    checkoutMethod === "pix"
                      ? "border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
                      : "bg-background text-foreground hover:border-input hover:bg-background hover:text-foreground"
                  }`}
                  aria-pressed={checkoutMethod === "pix"}
                  onClick={() => selectCheckoutMethod("pix")}
                >
                  <QrCode className="size-5 shrink-0" />
                  <span className="flex flex-col items-start">
                    <span>Pix</span>
                    <span className="text-xs font-normal opacity-75">Aprovação rápida</span>
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={`h-auto min-h-14 justify-start gap-3 px-4 py-3 text-left transition-none ${
                    checkoutMethod === "card"
                      ? "border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
                      : "bg-background text-foreground hover:border-input hover:bg-background hover:text-foreground"
                  }`}
                  aria-pressed={checkoutMethod === "card"}
                  onClick={() => selectCheckoutMethod("card")}
                >
                  <CreditCard className="size-5 shrink-0" />
                  <span className="flex flex-col items-start">
                    <span>Cartão de crédito</span>
                    <span className="text-xs font-normal opacity-75">À vista ou parcelado</span>
                  </span>
                </Button>
              </div>
              {!brickReady ? <div className="flex justify-center py-8"><Loader2 className="size-6 animate-spin text-primary" /></div> : null}
              {checkoutMethod === "pix" ? (
                <Payment
                  key={`${details.publicKey}:pix`}
                  initialization={{ amount: details.amountCents / 100, payer: {} }}
                  customization={{
                    paymentMethods: { bankTransfer: ["pix"] },
                    visual: { defaultPaymentOption: { bankTransferForm: true }, hideFormTitle: true },
                  }}
                  onReady={() => setBrickReady(true)}
                  onError={() => setError("Não foi possível carregar o formulário seguro do Mercado Pago.")}
                  onSubmit={submitPayment}
                />
              ) : (
                <CardPayment
                  key={`${details.publicKey}:card`}
                  initialization={{ amount: details.amountCents / 100, payer: {} }}
                  customization={{
                    paymentMethods: { types: { excluded: ["debit_card", "prepaid_card"] } },
                    visual: { hideFormTitle: true },
                  }}
                  onReady={() => setBrickReady(true)}
                  onError={() => setError("Não foi possível carregar o formulário seguro do Mercado Pago.")}
                  onSubmit={submitCardPayment}
                />
              )}
            </>
          )}
          {error ? <p className="mt-4 text-sm text-destructive" role="alert">{error}</p> : null}
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" /> Os dados sensíveis do cartão são tokenizados e não ficam armazenados na Mensaly.
          </p>
        </section>

        <aside className="card-surface h-fit p-6 sm:p-7">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold text-foreground">Resumo da cobrança</h2>
            <span className="text-2xl font-semibold text-foreground">{formatCents(details.amountCents)}</span>
          </div>
          <Separator className="my-4" />
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Aluno</dt><dd className="text-right font-medium text-foreground">{details.student.name}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Referência</dt><dd className="text-right text-foreground">{formatReferenceMonth(details.charge.referenceMonth)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Vencimento</dt><dd className="text-right text-foreground">{formatDateOnly(details.charge.dueDate)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Cobrança</dt><dd className="text-right font-mono text-xs text-muted-foreground">{details.checkoutId.slice(0, 8)}</dd></div>
          </dl>
        </aside>

        <footer className="pt-2 text-center text-xs text-muted-foreground">Cobrança emitida por {details.organization.name} · Mensaly</footer>
      </div>
    </main>
  );
}
