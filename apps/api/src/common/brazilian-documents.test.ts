import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeBrazilianPhone,
  normalizeCpf,
  normalizeRg,
} from "./brazilian-documents";

describe("Brazilian public enrollment identifiers", () => {
  it("normalizes CPF by its 11-digit format while the public form is in relaxed mode", () => {
    assert.equal(normalizeCpf("529.982.247-25"), "52998224725");
    assert.equal(normalizeCpf("529.982.247-24"), "52998224724");
    assert.equal(normalizeCpf("111.111.111-11"), "11111111111");
    assert.equal(normalizeCpf("123.456"), null);
  });

  it("normalizes Brazilian phones without duplicating the country code", () => {
    assert.equal(normalizeBrazilianPhone("(11) 99999-8888"), "5511999998888");
    assert.equal(normalizeBrazilianPhone("+55 11 99999-8888"), "5511999998888");
    assert.equal(normalizeBrazilianPhone("123"), null);
  });

  it("normalizes RG while preserving letters", () => {
    assert.equal(normalizeRg("12.345.678-x"), "12345678X");
    assert.equal(normalizeRg("1-2"), null);
  });
});
