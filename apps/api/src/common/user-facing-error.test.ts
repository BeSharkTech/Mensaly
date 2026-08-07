import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { userFacingDetails, userFacingMessage } from "./user-facing-error";

describe("userFacingMessage", () => {
  it("never exposes a raw provider error", () => {
    assert.equal(
      userFacingMessage({
        status: 502,
        code: "MERCADOPAGO_CONNECTION_SAVE_FAILED",
      }),
      "Não foi possível salvar a conexão com o Mercado Pago. Tente novamente.",
    );
  });

  it("uses a simple Portuguese fallback for unknown failures", () => {
    assert.equal(
      userFacingMessage({ status: 500, code: "UNEXPECTED_PROVIDER_ERROR" }),
      "Ocorreu um problema temporário. Tente novamente em instantes.",
    );
  });

  it("explains when Mercado Pago must be connected before charging", () => {
    assert.equal(
      userFacingMessage({ status: 409, code: "MERCADOPAGO_ACCOUNT_NOT_CONNECTED" }),
      "Conecte sua conta do Mercado Pago antes de criar cobranças.",
    );
  });

  it("simplifies validation details", () => {
    assert.deepEqual(
      userFacingDetails([{ field: "email", message: "Invalid email" }]),
      [{ field: "email", message: "Informe um e-mail válido." }],
    );
  });

  it("keeps dependency errors understandable", () => {
    assert.deepEqual(
      userFacingDetails([{ field: "database", message: "unavailable" }]),
      [{ field: "database", message: "Indisponível no momento." }],
    );
  });
});
