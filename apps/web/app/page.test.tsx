import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";

import HomePage from "./page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("web foundation", () => {
  it("renders the Mensaly landing page", () => {
    const page = HomePage();

    assert.equal(page.type, "main");
    assert.equal(page.props.children, "Mensaly");
  });
});
