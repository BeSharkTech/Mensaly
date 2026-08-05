import * as assert from "node:assert/strict";
import { test } from "node:test";

import { customFieldSchema } from "./workspace.dto";

test("custom fields may be optional", () => {
  const field = customFieldSchema.parse({
    label: "Alergias",
    fieldType: "TEXT",
    required: false,
  });

  assert.equal(field.required, false);
});
