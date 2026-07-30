import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const register = vi.fn();
const login = vi.fn();
const loadState = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cadastro",
  useParams: () => ({}),
}));

vi.mock("@/lib/auth", () => ({
  register,
  login,
}));

vi.mock("@/lib/store", () => ({
  loadState,
}));

describe("authentication pages", () => {
  beforeEach(() => {
    push.mockReset();
    register.mockReset();
    login.mockReset();
    loadState.mockReset();
  });

  it("accepts typing in every registration field and submits the account", async () => {
    const { Route } = await import("./cadastro");
    const user = userEvent.setup();
    render(createElement(Route.component));

    const name = screen.getByLabelText("Seu nome");
    const email = screen.getByLabelText("E-mail");
    const password = screen.getByLabelText("Senha");

    await user.type(name, "Maria da Silva");
    await user.type(email, "maria@example.test");
    await user.type(password, "Senha-Segura-2026!");

    expect(name).toHaveValue("Maria da Silva");
    expect(email).toHaveValue("maria@example.test");
    expect(password).toHaveValue("Senha-Segura-2026!");

    await user.click(screen.getByRole("button", { name: "Criar conta e continuar" }));

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        name: "Maria da Silva",
        email: "maria@example.test",
        password: "Senha-Segura-2026!",
      }),
    );
    expect(login).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/onboarding");
  });

  it("accepts login credentials and routes an onboarded account", async () => {
    const { Route } = await import("./login");
    const user = userEvent.setup();
    login.mockResolvedValue({});
    loadState.mockResolvedValue({ onboardingComplete: true });
    render(createElement(Route.component));

    await user.type(screen.getByLabelText("E-mail"), "owner@example.test");
    await user.type(screen.getByLabelText("Senha"), "Senha-Segura-2026!");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        email: "owner@example.test",
        password: "Senha-Segura-2026!",
      }),
    );
    expect(push).toHaveBeenCalledWith("/");
  });
});
