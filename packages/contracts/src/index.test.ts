import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as contracts from "./index";

describe("HTTP contracts", () => {
  it("exports stable v1 data and pagination envelopes", () => {
    assert.equal(contracts.API_VERSION, "v1");
    assert.deepEqual(
      contracts.dataEnvelopeSchema(contracts.errorDetailSchema).parse({
        data: { message: "ok" },
      }),
      { data: { message: "ok" } },
    );
    assert.equal(
      contracts
        .paginatedEnvelopeSchema(contracts.errorDetailSchema)
        .parse({
          data: [{ message: "one" }],
          meta: { page: 1, limit: 20, total: 1, pages: 1 },
        }).meta.limit,
      20,
    );
  });

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
