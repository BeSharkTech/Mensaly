"use client";

import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import { Route as AdminFailuresRoute } from "@/routes/admin.falhas";
import { Route as AdminRoute } from "@/routes/admin.index";
import { Route as AdminOrganizationsRoute } from "@/routes/admin.organizacoes";
import { Route as AdminWebhooksRoute } from "@/routes/admin.webhooks";
import { Route as StudentsRoute } from "@/routes/alunos";
import { Route as RegisterRoute } from "@/routes/cadastro";
import { Route as PublicEnrollmentRoute } from "@/routes/cadastro-aluno.$token";
import { Route as EnrollmentPermissionsRoute } from "@/routes/permissoes-cadastro";
import { Route as ChargesRoute } from "@/routes/cobrancas";
import { Route as SettingsRoute } from "@/routes/configuracoes";
import { Route as CustomFieldsRoute } from "@/routes/dados-adicionais";
import { Route as BroadcastRoute } from "@/routes/envio";
import { Route as InventoryRoute } from "@/routes/estoque";
import { Route as EventsRoute } from "@/routes/eventos";
import { Route as StudentFormRoute } from "@/routes/formulario.$businessId";
import { Route as DashboardRoute } from "@/routes/index";
import { Route as LoginRoute } from "@/routes/login";
import { Route as OnboardingRoute } from "@/routes/onboarding";
import { Route as CheckoutRoute } from "@/routes/pagar.$token";
import { Route as PlansRoute } from "@/routes/planos";
import { Route as ForgotPasswordRoute } from "@/routes/recuperar-senha";
import { Route as ResetPasswordRoute } from "@/routes/redefinir-senha";
import { Route as VerifyEmailRoute } from "@/routes/verificar-email";

const routes: Record<string, ComponentType> = {
  "/": DashboardRoute.component,
  "/admin": AdminRoute.component,
  "/admin/falhas": AdminFailuresRoute.component,
  "/admin/organizacoes": AdminOrganizationsRoute.component,
  "/admin/webhooks": AdminWebhooksRoute.component,
  "/alunos": StudentsRoute.component,
  "/cadastro": RegisterRoute.component,
  "/cobrancas": ChargesRoute.component,
  "/configuracoes": SettingsRoute.component,
  "/dados-adicionais": CustomFieldsRoute.component,
  "/permissoes-cadastro": EnrollmentPermissionsRoute.component,
  "/envio": BroadcastRoute.component,
  "/estoque": InventoryRoute.component,
  "/eventos": EventsRoute.component,
  "/login": LoginRoute.component,
  // Rota antiga mantida como alias seguro; a antiga tela era apenas uma simulação.
  "/mensagens": BroadcastRoute.component,
  "/onboarding": OnboardingRoute.component,
  "/planos": PlansRoute.component,
  "/recuperar-senha": ForgotPasswordRoute.component,
  "/redefinir-senha": ResetPasswordRoute.component,
  "/verificar-email": VerifyEmailRoute.component,
};

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          PÃƒÂ¡gina nÃƒÂ£o encontrada
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A pÃƒÂ¡gina que vocÃƒÂª procura nÃƒÂ£o existe ou foi movida.
        </p>
      </div>
    </div>
  );
}

export default function Page() {
  const pathname = usePathname();
  const dynamicRoute = pathname.startsWith("/formulario/")
    ? StudentFormRoute.component
    : pathname.startsWith("/cadastro-aluno/")
      ? PublicEnrollmentRoute.component
      : pathname.startsWith("/pagar/")
        ? CheckoutRoute.component
        : undefined;
  const Component = routes[pathname] ?? dynamicRoute;
  return Component ? <Component /> : <NotFound />;
}
