import * as assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import { createLogger, logger } from "./index";

describe("logger package foundation", () => {
  it("creates a named structured logger", () => {
    assert.equal(logger.bindings().name, "mensaly");
  });

  it("redacts credentials and session material", () => {
    const destination = new PassThrough();
    let output = "";
    destination.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    createLogger(destination).info({
      authorization: "Bearer secret",
      password: "secret-password",
      token: "secret-token",
      payload: { card: "4111111111111111" },
      customer: {
        email: "owner@example.test",
        phone: "5511999999999",
        cpf: "52998224725",
        rg: "12345678X",
        taxId: "12345678901",
      },
    });

    assert.doesNotMatch(
      output,
      /secret-password|secret-token|Bearer secret|4111111111111111|owner@example|5511999999999|52998224725|12345678X|12345678901/,
    );
    assert.match(output, /\[REDACTED\]/);
  });
});
