import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { logger } from "./index";

describe("logger package foundation", () => {
  it("creates a named structured logger", () => {
    assert.equal(logger.bindings().name, "mensaly");
  });
});
