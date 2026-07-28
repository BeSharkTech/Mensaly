import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as auth from "./index";

describe("authentication package foundation", () => {
  it("does not expose an unstable authentication API before phase 2", () => {
    assert.deepEqual(Object.keys(auth), []);
  });
});
