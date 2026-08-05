import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { initialize, apiRequest } = vi.hoisted(() => ({
  initialize: vi.fn(),
  apiRequest: vi.fn(),
}));
const onboardingProps = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("@stripe/connect-js/pure", () => ({
  loadConnectAndInitialize: initialize,
}));

vi.mock("@stripe/react-connect-js", () => ({
  ConnectComponentsProvider: ({ children }: { children: unknown }) => children,
  ConnectAccountOnboarding: (props: {
    collectionOptions: unknown;
    onExit: () => void;
    onLoaderStart: () => void;
    onLoadError: () => void;
  }) => {
    onboardingProps.current = props;
    return createElement(
      "div",
      null,
      createElement("button", { onClick: props.onLoaderStart }, "carregado"),
      createElement("button", { onClick: props.onExit }, "sair"),
      createElement("button", { onClick: props.onLoadError }, "falhar"),
    );
  },
}));

vi.mock("@/lib/api", () => ({ apiRequest }));

import { StripeEmbeddedOnboarding } from "./stripe-embedded-onboarding";

const session = {
  clientSecret: "as_test_initial",
  publishableKey: "pk_test_mensaly",
  expiresAt: "2026-08-01T12:00:00.000Z",
};

describe("StripeEmbeddedOnboarding", () => {
  beforeEach(() => {
    initialize.mockReset();
    apiRequest.mockReset();
    onboardingProps.current = undefined;
    initialize.mockReturnValue({
      create: vi.fn(),
      update: vi.fn(),
      logout: vi.fn(),
    });
  });

  it("uses the initial Account Session once and requests a fresh secret on refresh", async () => {
    apiRequest.mockResolvedValue({
      ...session,
      clientSecret: "as_test_refreshed",
    });
    render(
      <StripeEmbeddedOnboarding
        session={session}
        onExit={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const options = initialize.mock.calls[0]?.[0] as {
      publishableKey: string;
      fetchClientSecret: () => Promise<string>;
    };
    expect(options.publishableKey).toBe("pk_test_mensaly");
    await expect(options.fetchClientSecret()).resolves.toBe("as_test_initial");
    await expect(options.fetchClientSecret()).resolves.toBe(
      "as_test_refreshed",
    );
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith(
      "/payment-integrations/stripe/onboarding-session",
      { method: "POST" },
    );
  });

  it("exposes progress, completion and a recoverable load error", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const onRetry = vi.fn();
    render(
      <StripeEmbeddedOnboarding
        session={session}
        onExit={onExit}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Preparando formulário seguro",
    );
    await user.click(screen.getByRole("button", { name: "carregado" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "sair" }));
    expect(onExit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "falhar" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar a configuração de recebimentos",
    );
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("collects only current requirements and hides the prefilled description", () => {
    render(
      <StripeEmbeddedOnboarding
        session={session}
        onExit={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(
      (onboardingProps.current as { collectionOptions: unknown })
        .collectionOptions,
    ).toEqual({
      fields: "currently_due",
      futureRequirements: "omit",
      requirements: { exclude: ["business_profile.product_description"] },
    });
  });
});
