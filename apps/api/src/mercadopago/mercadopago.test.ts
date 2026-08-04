import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MercadoPagoCheckoutStatus } from "@mensaly/database";

import { mercadoPagoAmountCents, mercadoPagoCheckoutStatus } from "./mercadopago-checkout.service";
import { mercadoPagoBrickSubmissionSchema } from "./mercadopago.dto";
import type { MercadoPagoOrder } from "./mercadopago.gateway";

function order(status: string, statusDetail: string): MercadoPagoOrder {
  return {
    id: "ORD_TEST",
    external_reference: "00000000-0000-0000-0000-000000000001",
    status,
    status_detail: statusDetail,
    total_amount: "125.50",
    transactions: {
      payments: [{
        id: "PAY_TEST",
        amount: "125.50",
        status,
        status_detail: statusDetail,
        payment_method: { id: "pix", type: "bank_transfer" },
      }],
    },
  };
}

describe("Mercado Pago student payments", () => {
  it("confirms only accredited processed orders", () => {
    assert.equal(
      mercadoPagoCheckoutStatus(order("processed", "accredited")),
      MercadoPagoCheckoutStatus.PAID,
    );
    assert.equal(
      mercadoPagoCheckoutStatus(order("action_required", "waiting_transfer")),
      MercadoPagoCheckoutStatus.PROCESSING,
    );
    assert.equal(
      mercadoPagoCheckoutStatus(order("processed", "pending_review")),
      MercadoPagoCheckoutStatus.PROCESSING,
    );
    assert.equal(
      mercadoPagoCheckoutStatus(order("refunded", "refunded")),
      MercadoPagoCheckoutStatus.REFUNDED,
    );
    assert.equal(
      mercadoPagoCheckoutStatus(order("processed", "in_dispute")),
      MercadoPagoCheckoutStatus.DISPUTED,
    );
  });

  it("converts provider decimal amounts without floating point rounding", () => {
    assert.equal(mercadoPagoAmountCents("125.50"), 12_550);
    assert.equal(mercadoPagoAmountCents("1.2"), 120);
    assert.equal(mercadoPagoAmountCents("1.234"), null);
  });

  it("rejects malformed Brick submissions before provider calls", () => {
    assert.equal(
      mercadoPagoBrickSubmissionSchema.safeParse({
        paymentType: "bank_transfer",
        selectedPaymentMethod: "bank_transfer",
        formData: {
          payment_method_id: "pix",
          transaction_amount: 125.5,
          payer: { email: "payer@example.test" },
        },
      }).success,
      true,
    );
    assert.equal(
      mercadoPagoBrickSubmissionSchema.safeParse({
        paymentType: "credit_card",
        selectedPaymentMethod: "credit_card",
        formData: { payment_method_id: "visa", payer: { email: "not-an-email" } },
      }).success,
      false,
    );
  });
});
