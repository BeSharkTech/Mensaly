import { loadConnectAndInitialize } from "@stripe/connect-js/pure";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";
import { AlertCircle, LoaderCircle, RotateCw } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { apiRequest } from "@/lib/api";
import { DEFAULT_BRAND_COLOR } from "@/lib/branding";
import { Button } from "@/components/ui/button";

export type StripeOnboardingSession = {
  clientSecret: string;
  publishableKey: string;
  expiresAt: string;
};

type StripeEmbeddedOnboardingProps = {
  session: StripeOnboardingSession;
  onExit: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
};

export function StripeEmbeddedOnboarding({
  session,
  onExit,
  onRetry,
}: StripeEmbeddedOnboardingProps) {
  const initialClientSecret = useRef<string | null>(session.clientSecret);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchClientSecret = useCallback(async () => {
    if (initialClientSecret.current) {
      const clientSecret = initialClientSecret.current;
      initialClientSecret.current = null;
      return clientSecret;
    }
    const refreshed = await apiRequest<StripeOnboardingSession>(
      "/payment-integrations/stripe/onboarding-session",
      { method: "POST" },
    );
    return refreshed.clientSecret;
  }, []);

  const [connectInstance] = useState(() =>
    loadConnectAndInitialize({
      publishableKey: session.publishableKey,
      fetchClientSecret,
      locale: "pt-BR",
      appearance: {
        overlays: "dialog",
        variables: {
          colorPrimary: DEFAULT_BRAND_COLOR,
          buttonPrimaryColorBackground: DEFAULT_BRAND_COLOR,
          buttonPrimaryColorBorder: DEFAULT_BRAND_COLOR,
          buttonPrimaryColorText: "#ffffff",
          borderRadius: "10px",
          buttonBorderRadius: "8px",
          formBorderRadius: "8px",
          spacingUnit: "12px",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          overlayZIndex: 100,
        },
      },
    }),
  );

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
      >
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Não foi possível carregar a configuração de recebimentos
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Sua conta continua segura. Verifique a conexão e tente novamente.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void onRetry()}
            >
              <RotateCw className="size-4" aria-hidden="true" /> Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-72 overflow-hidden rounded-lg border border-border bg-background p-3 sm:p-4">
      {loading ? (
        <div
          className="absolute inset-0 z-10 flex min-h-72 items-center justify-center bg-background"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Preparando formulário seguro…
          </div>
        </div>
      ) : null}
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding
          collectionOptions={{
            fields: "currently_due",
            futureRequirements: "omit",
            requirements: {
              exclude: ["business_profile.product_description"],
            },
          }}
          onExit={() => void onExit()}
          onLoaderStart={() => setLoading(false)}
          onLoadError={() => {
            setLoading(false);
            setLoadError(true);
          }}
        />
      </ConnectComponentsProvider>
    </div>
  );
}
