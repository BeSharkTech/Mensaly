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
    });

    assert.doesNotMatch(output, /secret-password|secret-token|Bearer secret/);
    assert.match(output, /\[REDACTED\]/);
  });
});
