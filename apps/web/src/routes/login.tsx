import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import logo from "@/assets/mensaly-logo.png";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/auth";
import { loadState } from "@/lib/store";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Mensaly" },
      {
        name: "description",
        content: "Acesse o painel Mensaly para gerenciar mensalidades, matrículas e lembretes.",
      },
      { property: "og:title", content: "Entrar — Mensaly" },
      { property: "og:description", content: "Acesse o painel da sua escola no Mensaly." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login({ email: email.trim(), password });
      const state = await loadState();
      setLoading(false);
      navigate({
        to:
          user.role === "PLATFORM_ADMIN"
            ? "/admin"
            : state.onboardingComplete
              ? "/"
              : "/onboarding",
      });
    } catch (signInError) {
      if (
        signInError instanceof Error &&
        signInError.message ===
          "Email verification is required before login"
      ) {
        setLoading(false);
        navigate({
          to: `/verificar-email?email=${encodeURIComponent(email.trim())}`,
        });
        return;
      }
      setLoading(false);
      setError(
        signInError instanceof Error &&
          (signInError.message === "Invalid login credentials" ||
            signInError.message === "Invalid email or password")
          ? "E-mail ou senha inválidos."
          : signInError instanceof Error
            ? signInError.message
            : "Não foi possível entrar.",
      );
      return;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-lg sm:p-12">
          <div className="mb-8 flex items-center justify-between">
            <img src={logo.src} alt="Mensaly" className="h-10 w-auto" />
            <ThemeToggle />
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Entrar na sua conta
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Use o e-mail cadastrado na sua escola.
          </p>

          <form className="mt-8 space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                className="h-12 text-base"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Digite seu e-mail"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <Link to="/recuperar-senha" className="text-xs font-medium text-primary hover:underline">
                  Esqueci minha senha
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                className="h-12 text-base"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="h-12 w-full text-base" type="submit" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            Ainda não tem conta?{" "}
            <Link to="/cadastro" className="font-medium text-primary hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
