import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlanSchema,
  createStudentEnrollmentSchema,
  updatePlanSchema,
  updateStudentSchema,
} from "./operational.dto";

test("createStudentEnrollmentSchema validates the atomic manual journey", () => {
  const input = createStudentEnrollmentSchema.parse({
    student: { name: "Aluno Teste", cpf: "52998224725" },
    guardian: {
      name: "Responsável Teste",
      phone: "11999999999",
      taxId: "11144477735",
    },
    planId: "11111111-1111-4111-8111-111111111111",
    startDate: "2026-08-05",
  });
  assert.equal(input.student.name, "Aluno Teste");
});

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

test("updateStudentSchema permits removing a student profile photo", () => {
  assert.deepEqual(updateStudentSchema.parse({ photoFileId: null }), {
    photoFileId: null,
  });
});

test("updateStudentSchema permits switching between CPF and RG", () => {
  assert.deepEqual(updateStudentSchema.parse({ cpf: null, rg: "RG-12345" }), {
    cpf: null,
    rg: "RG-12345",
  });
});
