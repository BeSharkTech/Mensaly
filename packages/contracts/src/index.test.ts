import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as contracts from "./index";

describe("contracts package foundation", () => {
  it("does not expose unstable API contracts before phase 1", () => {
    assert.deepEqual(Object.keys(contracts), []);
  });
});
