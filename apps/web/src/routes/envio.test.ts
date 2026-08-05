import { describe, expect, it } from "vitest";

import {
  buildManualBroadcastPayload,
  renderMessageForStudent,
  whatsappManualLink,
} from "./envio";

describe("manual message contract", () => {
  it("cannot persist automatic scheduling in the V1 flow", () => {
    const payload = buildManualBroadcastPayload(
      {
        name: "Cobrança Futsal",
        body: "Olá [aluno], pague em [link]",
        targetType: "PLAN",
        planId: "plan-1",
        productId: "",
        eventId: "",
      },
      null,
    );

    expect(payload).toMatchObject({
      scheduleType: "MANUAL",
      scheduledFor: null,
      dayOfMonth: null,
      weekday: null,
      repeatUntil: null,
    });
  });
});

describe("whatsappManualLink", () => {
  it("adds the Brazilian country code and encodes the message", () => {
    expect(whatsappManualLink("(11) 99999-8888", "Olá, tudo bem?")).toBe(
      "https://wa.me/5511999998888?text=Ol%C3%A1%2C%20tudo%20bem%3F",
    );
  });

  it("keeps a valid number that already includes Brazil's country code", () => {
    expect(whatsappManualLink("+55 11 99999-8888", "Futsal")).toBe(
      "https://wa.me/5511999998888?text=Futsal",
    );
  });

  it("does not create a link for an incomplete phone number", () => {
    expect(whatsappManualLink("11999", "Teste")).toBeNull();
  });
});

describe("renderMessageForStudent", () => {
  it("replaces every supported tag without changing the saved template", () => {
    expect(
      renderMessageForStudent("Olá [aluno]! Fale com [responsavel]: [link]", {
        studentName: "Marcos",
        guardianName: "Patrícia",
        paymentLink: "https://app.mensaly.online/pagar/token",
      }),
    ).toBe(
      "Olá Marcos! Fale com Patrícia: https://app.mensaly.online/pagar/token",
    );
  });
});
