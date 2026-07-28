import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as contracts from "./index";

describe("HTTP contracts", () => {
  it("validates the global error envelope", () => {
    const result = contracts.errorEnvelopeSchema.safeParse({
      error: { code: "NOT_FOUND", message: "Resource not found" },
      correlationId: "c0a80121-7ac0-4b60-a98f-9c639336a001",
      timestamp: new Date().toISOString(),
      path: "/api/v1/missing",
    });

    assert.equal(result.success, true);
  });

  it("creates a DTO carrying its Zod schema", () => {
    const schema = contracts.errorDetailSchema;
    const Dto = contracts.createZodDto(schema);

    assert.equal(Dto.schema, schema);
  });
});
