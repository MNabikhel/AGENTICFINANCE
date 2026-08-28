import { describe, expect, it } from "vitest";
import { generateEd25519 } from "@aether/kernel";
import { cartHash, intentHash, signMandate, verifyChain } from "@aether/mandate";
import type { CartMandate, IntentMandate, PaymentMandate } from "@aether/types";

describe("mandate chain", () => {
  it("rejects a swapped payee", () => {
    const issuer = generateEd25519("i");
    const merchant = generateEd25519("m");
    const payer = generateEd25519("p");
    const intentPayload: IntentMandate = {
      vct: "aether.mandate.intent.open.1",
      id: "mid_01J6AETHERMAND00000000001",
      issuerId: "aid_human",
      subjectId: "aid_proc",
      task: "t",
      constraints: [],
      iat: 1,
      exp: 9_999_999_999,
    };
    const intent = signMandate(intentPayload, "did:aether:human", issuer);
    const cartPayload: CartMandate = {
      vct: "aether.mandate.cart.1",
      id: "mid_01J6AETHERMAND00000000002",
      intentId: intentPayload.id,
      intentHash: intentHash(intentPayload),
      merchant: { id: "aid_vendor", name: "V", website: "https://v.test" },
      line_items: [{ sku: "x", description: "x", quantity: 1, unitAmount: { amount: 1, currency: "USD_SIM" } }],
      total: { amount: 1, currency: "USD_SIM" },
      expiresAt: "2099-01-01T00:00:00.000Z",
      userConfirmationRequired: false,
    };
    const cart = signMandate(cartPayload, "did:aether:vendor", merchant);
    const paymentPayload: PaymentMandate = {
      vct: "aether.mandate.payment.1",
      id: "mid_01J6AETHERMAND00000000003",
      transaction_id: cartHash(cartPayload),
      payee: { id: "aid_other", name: "Nope", website: "https://n.test" },
      payment_amount: { amount: 1, currency: "USD_SIM" },
      payment_instrument: { id: "sim", type: "sim_ledger", description: "s" },
      iat: 1,
      exp: 9_999_999_999,
    };
    const payment = signMandate(paymentPayload, "did:aether:proc", payer);
    const result = verifyChain({
      intent,
      cart,
      payment,
      intentKey: issuer,
      cartKey: merchant,
      paymentKey: payer,
      nowIso: "2026-08-28T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });
});
