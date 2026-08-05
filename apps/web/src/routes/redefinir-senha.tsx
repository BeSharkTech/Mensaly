import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import logo from "@/assets/mensaly-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmPasswordReset } from "@/lib/auth";

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({
    meta: [
      { title: "Definir nova senha — Mensaly" },
      {
        name: "description",
        content:
          "Escolha uma nova senha para acessar o painel da sua escola no Mensaly.",
      },
      { property: "og:title", content: "Definir nova senha — Mensaly" },
      {
        property: "og:description",
        content: "Escolha uma nova senha para sua conta Mensaly.",
      },
    ],
  }),
  component: NewPasswordPage,
});

function NewPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!password) {
      setError("Informe a nova senha.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    if (password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setLoading(false);
      setError("O link de redefinição não contém um token válido.");
      return;
    }
    try {
      await confirmPasswordReset(token, password);
    } catch (updateError) {
      setLoading(false);
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Não foi possível salvar a senha.",
      );
      return;
    }
    setLoading(false);
    navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <img src={logo.src} alt="Mensaly" className="mb-8 h-8 w-auto" />
      <div className="card-surface w-full max-w-md p-8">
        <h1 className="text-xl font-semibold text-foreground">
          Definir nova senha
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Escolha uma senha nova para acessar o painel.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite a nova senha"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmar senha</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repita a nova senha"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? "Salvando..." : "Salvar nova senha"}
          </Button>
        </form>
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
