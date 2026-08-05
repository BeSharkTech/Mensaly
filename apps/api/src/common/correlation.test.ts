import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeRequestPath } from "./correlation";

describe("request path redaction", () => {
  it("removes public enrollment tokens and keeps the route shape", () => {
    assert.equal(
      safeRequestPath(
        "/api/v1/public/enrollment/secret.token/signatures/submissions?x=1",
      ),
      "/api/v1/public/enrollment/[REDACTED]/signatures/submissions",
    );
    assert.equal(
      safeRequestPath("/api/v1/public/mercadopago-checkout/payment-token?code=secret"),
      "/api/v1/public/mercadopago-checkout/[REDACTED]",
    );
    assert.equal(
      safeRequestPath("/api/v1/payment-integrations/mercadopago/callback?code=secret&state=secret"),
      "/api/v1/payment-integrations/mercadopago/callback",
    );
    assert.equal(safeRequestPath("/api/v1/students"), "/api/v1/students");
  });
});
