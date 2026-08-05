import { describe, expect, it } from "vitest";

import { publicEnrollmentLinkForOrigin } from "./public-enrollment";

describe("publicEnrollmentLinkForOrigin", () => {
  it("uses the active local frontend origin instead of a stale local port", () => {
    expect(
      publicEnrollmentLinkForOrigin(
        "http://localhost:5174/cadastro-aluno/signed.token",
        "http://localhost:5173",
      ),
    ).toBe("http://localhost:5173/cadastro-aluno/signed.token");
  });

  it("keeps the configured production origin", () => {
    expect(
      publicEnrollmentLinkForOrigin(
        "https://app.mensaly.online/cadastro-aluno/signed.token",
        "https://preview.example.test",
      ),
    ).toBe("https://app.mensaly.online/cadastro-aluno/signed.token");
  });
});
