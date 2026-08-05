import { describe, expect, it } from "vitest";

import * as adminFailures from "./admin.falhas";
import * as adminHome from "./admin.index";
import * as adminOrganizations from "./admin.organizacoes";
import * as adminWebhooks from "./admin.webhooks";
import * as students from "./alunos";
import * as registration from "./cadastro";
import * as publicEnrollment from "./cadastro-aluno.$token";
import * as enrollmentPermissions from "./permissoes-cadastro";
import * as charges from "./cobrancas";
import * as settings from "./configuracoes";
import * as customData from "./dados-adicionais";
import * as broadcast from "./envio";
import * as inventory from "./estoque";
import * as events from "./eventos";
import * as publicForm from "./formulario.$businessId";
import * as dashboard from "./index";
import * as login from "./login";
import * as messages from "./mensagens";
import * as onboarding from "./onboarding";
import * as checkout from "./pagar.$token";
import * as plans from "./planos";
import * as forgotPassword from "./recuperar-senha";
import * as resetPassword from "./redefinir-senha";
import * as verifyEmail from "./verificar-email";

const routeModules = [
  adminFailures,
  adminHome,
  adminOrganizations,
  adminWebhooks,
  students,
  registration,
  publicEnrollment,
  enrollmentPermissions,
  charges,
  settings,
  customData,
  broadcast,
  inventory,
  events,
  publicForm,
  dashboard,
  login,
  messages,
  onboarding,
  checkout,
  plans,
  forgotPassword,
  resetPassword,
  verifyEmail,
];

describe("Lovable route modules", () => {
  it("imports every preserved screen without a module-level crash", () => {
    expect(routeModules).toHaveLength(24);
    routeModules.forEach((module) => expect(module).toHaveProperty("Route"));
  });
});
