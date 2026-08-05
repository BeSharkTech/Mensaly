import { describe, expect, it } from "vitest";

import {
  buildStudentProfileSections,
  buildStudentExportRows,
  studentExportFilename,
  toStudentCsv,
} from "./student-export";

const base = {
  students: [
    {
      id: "student-1",
      name: "=SUM(A1:A2)",
      cpf: "12345678901",
      rg: "MG123",
      birthDate: "2012-04-03",
      guardian: "Paulo Silva",
      guardianId: "guardian-1",
      plan: "Futebol",
      planId: "plan-1",
      enrollmentId: "enrollment-1",
      status: "ACTIVE" as const,
    },
    {
      id: "student-2",
      name: "Bruno Lima",
      cpf: "",
      rg: "SP456",
      birthDate: null,
      guardian: "—",
      guardianId: null,
      plan: "Natação",
      planId: "plan-2",
      enrollmentId: "enrollment-2",
      status: "INACTIVE" as const,
    },
  ],
  charges: [
    {
      id: "charge-1",
      studentId: "student-1",
      student: "Ana",
      plan: "Futebol",
      referenceMonth: "2026-08",
      dueDate: "2026-08-10",
      amountCents: 12000,
      discountCents: 0,
      finalAmountCents: 12000,
      status: "PENDING" as const,
    },
  ],
};

describe("student exports", () => {
  it("groups the selected students by plan and includes payment only when requested", () => {
    const rows = buildStudentExportRows(base, { includePaymentStatus: false });

    expect(rows.map((row) => row.plan)).toEqual(["Futebol", "Natação"]);
    expect(rows[0]).not.toHaveProperty("paymentStatus");

    const rowsWithPayment = buildStudentExportRows(base, {
      includePaymentStatus: true,
    });
    expect(rowsWithPayment[0]).toMatchObject({
      paymentStatus: "Em aberto",
      paymentDueDate: "10/08/2026",
    });
  });

  it("creates an Excel-safe semicolon CSV", () => {
    const csv = toStudentCsv(buildStudentExportRows(base, { includePaymentStatus: true }));

    expect(csv).toContain("Plano;Aluno;CPF/RG");
    expect(csv).toContain("\"Futebol\";\"'=SUM(A1:A2)\"");
  });

  it("uses a safe filename for the chosen format", () => {
    expect(studentExportFilename("Escola São João", "csv")).toBe(
      "alunos-escola-sao-joao.csv",
    );
  });

  it("builds a complete individual record with additional fields", () => {
    const profile = buildStudentProfileSections({
      student: base.students[0],
      charge: base.charges[0],
      customFields: [
        { id: "field-1", label: "Alergias", subject: "STUDENT" as const },
      ],
      values: { "field-1": "Lactose" },
    });

    expect(profile.student).toContainEqual(["CPF/RG", "12345678901 / MG123"]);
    expect(profile.payment).toContainEqual(["Situação", "Em aberto"]);
    expect(profile.additional).toEqual([["Alergias", "Lactose"]]);
  });
});
