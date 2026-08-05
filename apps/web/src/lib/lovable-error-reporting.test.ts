import { expect, test } from "vitest";

import { safeTelemetryPath } from "./lovable-error-reporting";

test("redacts public enrollment bearer tokens from telemetry paths", () => {
  expect(safeTelemetryPath("/cadastro-aluno/secret.token.signature")).toBe(
    "/cadastro-aluno/[REDACTED]",
  );
  expect(safeTelemetryPath("/alunos")).toBe("/alunos");
});
