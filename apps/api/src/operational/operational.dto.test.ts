import assert from "node:assert/strict";
import test from "node:test";

import { createPlanSchema, updatePlanSchema } from "./operational.dto";

test("updatePlanSchema accepts an audited plan status transition", () => {
  assert.deepEqual(updatePlanSchema.parse({ status: "INACTIVE" }), {
    status: "INACTIVE",
  });
});

test("updatePlanSchema rejects an unknown plan status", () => {
  assert.throws(() => updatePlanSchema.parse({ status: "ARCHIVED" }));
});

test("createPlanSchema defaults the opening day and validates the charge window", () => {
  const plan = createPlanSchema.parse({ name: "Mensal", amountCents: 12000, dueDay: 10 });
  assert.equal(plan.chargeOpenDay, 1);
  assert.equal(plan.chargeOpenTime, "00:00");
  assert.throws(() =>
    createPlanSchema.parse({
      name: "Inválido",
      amountCents: 12000,
      chargeOpenDay: 11,
      dueDay: 10,
    }),
  );
  assert.throws(() =>
    createPlanSchema.parse({
      name: "Horário inválido",
      amountCents: 12000,
      chargeOpenTime: "24:30",
      dueDay: 10,
    }),
  );
});
