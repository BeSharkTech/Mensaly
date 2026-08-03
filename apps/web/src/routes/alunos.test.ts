import { describe, expect, it } from "vitest";

import { studentCpfWasChanged } from "./alunos";

describe("studentCpfWasChanged", () => {
  it("allows a legacy student name edit without resubmitting an empty CPF", () => {
    expect(studentCpfWasChanged({ cpf: "" }, "")).toBe(false);
  });

  it("does not resend an unchanged CPF with formatting differences", () => {
    expect(studentCpfWasChanged({ cpf: "12345678901" }, "123.456.789-01")).toBe(false);
  });

  it("requires validation when a CPF is added or modified", () => {
    expect(studentCpfWasChanged({ cpf: "" }, "123.456.789-01")).toBe(true);
    expect(studentCpfWasChanged(null, "123.456.789-01")).toBe(true);
  });
});
