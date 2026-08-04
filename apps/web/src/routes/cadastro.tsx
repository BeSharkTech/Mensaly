import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import logo from "@/assets/mensaly-logo.png";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { register } from "@/lib/auth";

export const Route = createFileRoute("/cadastro")({
  head: () => ({
    meta: [
      { title: "Criar conta — Mensaly" },
      {
        name: "description",
        content:
          "Crie a conta da sua escola no Mensaly e organize mensalidades, matrículas e lembretes.",
      },
      { property: "og:title", content: "Criar conta — Mensaly" },
      { property: "og:description", content: "Crie a conta da sua escola no Mensaly." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim() || !email.trim() || !password) {
      setError("Preencha nome, e-mail e senha.");
      return;
    }
    if (password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const registration = await register({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (registration?.devVerificationToken) {
        navigate({
          to: `/verificar-email?token=${encodeURIComponent(
            registration.devVerificationToken,
          )}`,
        });
        return;
      }
    } catch (signUpError) {
      setLoading(false);
      setError(
        signUpError instanceof Error &&
          (signUpError.message.includes("already") ||
            signUpError.message.includes("already uses"))
          ? "Este e-mail já tem uma conta. Faça login."
          : signUpError instanceof Error
            ? signUpError.message
            : "Não foi possível criar a conta.",
      );
      return;
    }
    setLoading(false);
    navigate({
      to: `/verificar-email?email=${encodeURIComponent(email.trim())}`,
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <img src={logo.src} alt="Mensaly" className="h-8 w-auto" />
          <ThemeToggle />
        </div>

        <div className="card-surface p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Criar conta</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Depois do cadastro você configura o seu negócio e os planos.
          </p>

          <form className="mt-6 space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="name">Seu nome</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Digite seu nome completo"
              />
            </div>
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
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? "Criando conta..." : "Criar conta e continuar"}
            </Button>
          </form>

        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
