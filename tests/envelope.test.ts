import { describe, expect, it } from "vitest";
import { decodePayload, decodeRequired, encodePayload, encodeRequired, signInner, verifyInner } from "@aether/envelope";
import { generateEd25519 } from "@aether/kernel";
import { SIM_RAIL_ID } from "@aether/types";

describe("x402-shaped envelopes", () => {
  it("round-trips PAYMENT-REQUIRED", () => {
    const body = {
      x402Version: 2 as const,
      resource: { url: "aether://x", description: "d", mimeType: "application/json" as const },
      accepted: [
        {
          scheme: "exact" as const,
          network: SIM_RAIL_ID,
          amount: "80000",
          asset: "USD_SIM" as const,
          payTo: "acct_01J6AETHERACCT00000000001" as const,
          maxTimeoutSeconds: 60,
        },
      ],
    };
    const header = encodeRequired(body);
    expect(decodeRequired(header)).toEqual(body);
  });

  it("signs payment inner payloads", () => {
    const kp = generateEd25519("kid-1");
    const inner = signInner(
      {
        payerAccountId: "acct_01J6AETHERACCT00000000001",
        paymentMandateId: "mid_01J6AETHERMAND00000000001",
        nonce: "n1",
        authorizedAmount: "1",
        asset: "USD_SIM",
        validBefore: "2026-08-28T00:01:00.000Z",
      },
      kp,
    );
    expect(verifyInner(inner, kp)).toBe(true);
    const payload = { x402Version: 2 as const, scheme: "exact" as const, network: SIM_RAIL_ID, payload: inner };
    expect(decodePayload(encodePayload(payload)).payload.nonce).toBe("n1");
  });
});
