import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { createFileRoute } from "@tanstack/react-router";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Loader2, Lock, ShieldCheck } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/api";
import { applyBrandColor, DEFAULT_BRAND_COLOR, isValidHexColor } from "@/lib/branding";
import { formatCents, formatDateOnly, formatReferenceMonth } from "@/lib/format";

export const Route = createFileRoute("/pagar/$token")({
  head: () => ({
    meta: [
      { title: "Pagamento da mensalidade — Mensaly" },
      {
        name: "description",
        content: "Checkout seguro para pagamento da mensalidade por Pix ou cartão.",
      },
    ],
  }),
  component: CheckoutPage,
});

type PublicCheckout = {
  checkoutId: string;
  status: "CREATING" | "OPEN" | "PROCESSING" | "PAID" | "EXPIRED" | "FAILED";
  amountCents: number;
  currency: string;
  expiresAt: string;
  charge: { dueDate: string; referenceMonth: string; status: string };
  student: { name: string };
  organization: {
    name: string;
    brand: null | {
      logoDataUrl?: string;
      primaryColor?: string;
      segment?: string;
    };
  };
};

type CheckoutSession = {
  clientSecret: string;
  stripeAccountId: string;
  publishableKey: string;
};

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function CheckoutPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stripeReturn = searchParams.get("retorno") === "stripe";
  const token = decodeURIComponent(pathname.split("/")[2] ?? "");
  const [details, setDetails] = useState<PublicCheckout | null>(null);
  const [configuration, setConfiguration] = useState<CheckoutSession | null>(null);
  const [stripe, setStripe] = useState<Promise<Stripe | null> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    const load = async () => {
      const checkout = await apiRequest<PublicCheckout>(
        `/public/checkout/${encodeURIComponent(token)}${stripeReturn ? "/reconcile" : ""}`,
        stripeReturn ? { method: "POST" } : undefined,
      );
      if (checkout.status === "PAID" || checkout.charge.status === "PAID") {
        if (!active) return;
        setDetails(checkout);
        return;
      }
      const session = await apiRequest<CheckoutSession>(
        `/public/checkout/${encodeURIComponent(token)}/session`,
        { method: "POST" },
      );
      if (!active) return;
      setDetails(checkout);
      setConfiguration(session);
      setStripe(loadStripe(session.publishableKey, { stripeAccount: session.stripeAccountId }));
    };
    load()
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Este checkout está indisponível.");
      });
    return () => {
      active = false;
    };
  }, [stripeReturn, token]);

  const brandColor = useMemo(() => {
    const candidate = details?.organization.brand?.primaryColor ?? "";
    return isValidHexColor(candidate) ? candidate : DEFAULT_BRAND_COLOR;
  }, [details]);

  useEffect(() => applyBrandColor(brandColor), [brandColor]);

  if (error) {
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

  const paid = details?.status === "PAID" || details?.charge.status === "PAID";

  if (!details || (!paid && (!configuration || !stripe))) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="Carregando checkout" />
      </main>
    );
  }

  const brand = details.organization.brand;
  return (
    <main className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <header className="flex flex-col items-center gap-3 text-center">
          {brand?.logoDataUrl ? (
            <img
              src={brand.logoDataUrl}
              alt={`Logo de ${details.organization.name}`}
              className="size-20 rounded-2xl bg-card object-contain p-2 shadow-sm ring-1 ring-border"
            />
          ) : (
            <span
              className="flex size-20 items-center justify-center rounded-2xl text-2xl font-semibold text-primary-foreground shadow-sm"
              style={{ backgroundColor: brandColor }}
              aria-hidden
            >
              {initialsOf(details.organization.name) || "M"}
            </span>
          )}
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-foreground">{details.organization.name}</h1>
            <p className="text-xs text-muted-foreground">{brand?.segment || "Pagamento seguro"}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Pagamento processado pelo Stripe
          </span>
        </header>

        <section className="card-surface overflow-hidden p-6 sm:p-7">
          {paid ? (
            <div className="flex flex-col items-center py-10 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-secondary">
                <BadgeCheck className="size-7 text-foreground" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-foreground">Pagamento confirmado</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                O pagamento foi confirmado pelo provedor e registrado pela escola.
              </p>
            </div>
          ) : (
            <EmbeddedCheckoutProvider stripe={stripe} options={{ clientSecret: configuration!.clientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          )}
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" /> Seus dados de pagamento não passam pelos servidores da Mensaly.
          </p>
        </section>

        <aside className="card-surface h-fit p-6 sm:p-7">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-semibold text-foreground">Resumo da cobrança</h2>
            <span className="text-2xl font-semibold text-foreground">
              {formatCents(details.amountCents)}
            </span>
          </div>
          <Separator className="my-4" />
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Aluno</dt>
              <dd className="text-right font-medium text-foreground">{details.student.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Referência</dt>
              <dd className="text-right text-foreground">
                {formatReferenceMonth(details.charge.referenceMonth)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Vencimento</dt>
              <dd className="text-right text-foreground">{formatDateOnly(details.charge.dueDate)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Cobrança</dt>
              <dd className="text-right font-mono text-xs text-muted-foreground">
                {details.checkoutId.slice(0, 8)}
              </dd>
            </div>
          </dl>
        </aside>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Cobrança emitida por {details.organization.name} · Mensaly
        </footer>
      </div>
    </main>
  );
}
