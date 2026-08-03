import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const register = vi.fn();
const login = vi.fn();
const requestEmailVerification = vi.fn();
const verifyEmail = vi.fn();
const loadState = vi.fn();
const getSearchParam = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cadastro",
  useParams: () => ({}),
  useSearchParams: () => ({ get: getSearchParam }),
}));

vi.mock("@/lib/auth", () => ({
  register,
  login,
  requestEmailVerification,
  verifyEmail,
}));

vi.mock("@/lib/store", () => ({
  loadState,
}));

describe("authentication pages", () => {
  beforeEach(() => {
    push.mockReset();
    register.mockReset();
    login.mockReset();
    requestEmailVerification.mockReset();
    verifyEmail.mockReset();
    loadState.mockReset();
    getSearchParam.mockReset();
  });

  it("consumes a local verification token only once under React StrictMode", async () => {
    const { Route } = await import("./verificar-email");
    getSearchParam.mockImplementation((key: string) =>
      key === "token" ? "local-token" : null,
    );
    verifyEmail.mockResolvedValue(undefined);

    render(
      createElement(
        StrictMode,
        null,
        createElement(Route.component),
      ),
    );

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledTimes(1));
    expect(verifyEmail).toHaveBeenCalledWith("local-token");
    expect(
      await screen.findByRole("heading", { name: "E-mail confirmado" }),
    ).toBeInTheDocument();
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
    expect(login).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      "/verificar-email?email=maria%40example.test",
    );
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
