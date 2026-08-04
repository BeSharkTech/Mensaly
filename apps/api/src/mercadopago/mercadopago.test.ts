import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MercadoPagoCheckoutStatus } from "@mensaly/database";

import { mercadoPagoAmountCents, mercadoPagoCheckoutStatus } from "./mercadopago-checkout.service";
import { mercadoPagoBrickSubmissionSchema } from "./mercadopago.dto";
import {
  mercadoPagoAuthorizationCodeBody,
  mercadoPagoPaymentToOrder,
  type MercadoPagoOrder,
} from "./mercadopago.gateway";

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
  it("builds the documented OAuth token body without leaking state", () => {
    const body = mercadoPagoAuthorizationCodeBody({
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "authorization-code",
      redirectUri: "https://app.example.test/api/v1/payment-integrations/mercadopago/callback",
      testToken: true,
    });
    assert.deepEqual(body, {
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: "https://app.example.test/api/v1/payment-integrations/mercadopago/callback",
      test_token: "true",
    });
    assert.equal("state" in body, false);
  });

  it("confirms only provider-approved payments", () => {
    assert.equal(
      mercadoPagoCheckoutStatus(order("processed", "accredited")),
      MercadoPagoCheckoutStatus.PAID,
    );
    assert.equal(
      mercadoPagoCheckoutStatus(order("approved", "accredited")),
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
    assert.equal(
      mercadoPagoCheckoutStatus(order("charged_back", "settled")),
      MercadoPagoCheckoutStatus.DISPUTED,
    );
  });

  it("normalizes the Payments API response used by Checkout Bricks", () => {
    const normalized = mercadoPagoPaymentToOrder({
      id: 123,
      external_reference: "00000000-0000-0000-0000-000000000001",
      status: "approved",
      status_detail: "accredited",
      transaction_amount: 125.5,
      payment_method_id: "master",
      payment_type_id: "credit_card",
      transaction_details: { external_resource_url: null },
      date_created: "2026-08-03T12:00:00.000Z",
      date_last_updated: "2026-08-03T12:00:01.000Z",
    });
    assert.equal(normalized?.id, "123");
    assert.equal(normalized?.total_amount, "125.5");
    assert.equal(normalized?.transactions.payments[0]?.payment_method.id, "master");
    assert.equal(normalized?.transactions.payments[0]?.payment_method.type, "credit_card");
    assert.equal(mercadoPagoPaymentToOrder({ status: "approved" }), null);
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
