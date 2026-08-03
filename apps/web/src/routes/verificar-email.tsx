import { createFileRoute, Link } from "@tanstack/react-router";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import logo from "@/assets/mensaly-logo.png";
import { Button } from "@/components/ui/button";
import {
  requestEmailVerification,
  verifyEmail,
} from "@/lib/auth";

export const Route = createFileRoute("/verificar-email")({
  component: VerifyEmailPage,
});

type State = "waiting" | "verifying" | "verified" | "error";

function VerifyEmailPage() {
  const [state, setState] = useState<State>("waiting");
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);
  const attemptedToken = useRef<string | null>(null);
  const search = useSearchParams();
  const token = search.get("token");
  const email = search.get("email") ?? "";

  useEffect(() => {
    if (!token || attemptedToken.current === token) return;
    attemptedToken.current = token;
    setState("verifying");
    void verifyEmail(token)
      .then(() => setState("verified"))
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "O link é inválido ou expirou.",
        );
        setState("error");
      });
  }, [token]);

  async function resend() {
    if (!email || resending) return;
    setResending(true);
    setMessage("");
    try {
      await requestEmailVerification(email);
      setMessage("Se a conta estiver pendente, um novo link será enviado.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível solicitar outro link.",
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <img src={logo.src} alt="Mensaly" className="mb-8 h-8 w-auto" />
      <div className="card-surface w-full max-w-md p-8">
        <h1 className="text-xl font-semibold text-foreground">
          {state === "verified"
            ? "E-mail confirmado"
            : state === "verifying"
              ? "Confirmando e-mail..."
              : "Confirme seu e-mail"}
        </h1>

        {state === "verified" ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Sua conta está ativa. Agora você pode entrar e configurar o negócio.
            </p>
            <Button asChild className="mt-6 w-full">
              <Link to="/login">Entrar</Link>
            </Button>
          </>
        ) : state === "verifying" ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Aguarde enquanto validamos o link.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Enviamos um link seguro para {email || "o e-mail cadastrado"}.
              Ele expira em 24 horas.
            </p>
            {message ? (
              <p
                className={`mt-4 text-sm ${
                  state === "error" ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {message}
              </p>
            ) : null}
            {email ? (
              <Button
                className="mt-6 w-full"
                variant="outline"
                onClick={resend}
                disabled={resending}
              >
                {resending ? "Solicitando..." : "Reenviar link"}
              </Button>
            ) : null}
            <p className="mt-6 text-center text-sm text-muted-foreground">
              <Link to="/login" className="font-medium text-primary hover:underline">
                Voltar para o login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
