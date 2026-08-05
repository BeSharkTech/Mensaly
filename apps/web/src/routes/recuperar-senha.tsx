import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import logo from "@/assets/mensaly-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth";

export const Route = createFileRoute("/recuperar-senha")({
  head: () => ({
    meta: [
      { title: "Recuperar senha — Mensaly" },
      {
        name: "description",
        content:
          "Receba um link seguro para redefinir a senha da sua conta Mensaly.",
      },
      { property: "og:title", content: "Recuperar senha — Mensaly" },
      {
        property: "og:description",
        content: "Receba um link seguro para redefinir sua senha.",
      },
    ],
  }),
  component: PasswordResetPage,
});

function PasswordResetPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
    } catch (resetError) {
      setLoading(false);
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Não foi possível enviar o link.",
      );
      return;
    }
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <img src={logo.src} alt="Mensaly" className="mb-8 h-8 w-auto" />
      <div className="card-surface w-full max-w-md p-8">
        <h1 className="text-xl font-semibold text-foreground">
          Recuperar senha
        </h1>
        {sent ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Se existir uma conta com{" "}
            <strong className="text-foreground">{email}</strong>, o link de
            redefinição chegará em instantes.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Informe o e-mail da conta e enviaremos um link de redefinição.
            </p>
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Digite seu e-mail"
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? "Enviando..." : "Enviar link"}
              </Button>
            </form>
          </>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            to="/login"
            className="font-medium text-primary hover:underline"
          >
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}
