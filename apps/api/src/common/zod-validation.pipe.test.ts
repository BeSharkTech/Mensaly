import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createZodDto } from "@mensaly/contracts";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

import { ZodValidationPipe } from "./zod-validation.pipe";

const BodyDto = createZodDto(
  z.object({
    name: z.string().trim().min(2),
  }).strict(),
);

describe("ZodValidationPipe", () => {
  const pipe = new ZodValidationPipe();
  const metadata = { type: "body" as const, metatype: BodyDto };

  it("returns parsed and normalized input", () => {
    assert.deepEqual(pipe.transform({ name: "  Mensaly  " }, metadata), {
      name: "Mensaly",
    });
  });

  it("rejects invalid and unknown input", () => {
    assert.throws(
      () => pipe.transform({ name: "Mensaly", unexpected: true }, metadata),
      BadRequestException,
    );
  });
});
