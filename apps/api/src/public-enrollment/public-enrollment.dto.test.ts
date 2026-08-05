import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  publicEnrollmentFieldConfigurationSchema,
  submitPublicEnrollmentSchema,
} from "./public-enrollment.dto";

describe("public enrollment input", () => {
  it("keeps student and guardian additional values separate", () => {
    const parsed = submitPublicEnrollmentSchema.parse({
      student: {
        name: "Aluno de teste",
        document: { value: "12345678901" },
        photoFileId: "11111111-1111-4111-8111-111111111111",
      },
      guardian: {
        name: "Responsável de teste",
        cpf: "12345678901",
        phone: "11999999999",
      },
      planId: "22222222-2222-4222-8222-222222222222",
      studentValues: { "33333333-3333-4333-8333-333333333333": "A+" },
      guardianValues: { "44444444-4444-4444-8444-444444444444": "Manhã" },
      privacyAccepted: true,
      privacyNoticeVersion: "2026-08-01",
      companyWebsite: "",
    });

    assert.equal(parsed.studentValues["33333333-3333-4333-8333-333333333333"], "A+");
    assert.equal(parsed.guardianValues["44444444-4444-4444-8444-444444444444"], "Manhã");
  });

  it("defaults public links to the safe approval mode and accepts automatic mode", () => {
    assert.equal(
      publicEnrollmentFieldConfigurationSchema.parse({}).approvalMode,
      "SAFE",
    );
    assert.equal(
      publicEnrollmentFieldConfigurationSchema.parse({ approvalMode: "AUTOMATIC" }).approvalMode,
      "AUTOMATIC",
    );
  });
});
