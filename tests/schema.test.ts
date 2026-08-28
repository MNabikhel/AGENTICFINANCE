import { describe, expect, it } from "vitest";
import { commandShapeError } from "@aether/runtime";

describe("command shape enums and integer ranges", () => {
  it("rejects a role that is not an agent role", () => {
    expect(commandShapeError("identity.register", { displayName: "X", role: "god" })).toBe("invalid enum: role");
  });

  it("accepts a listed role", () => {
    expect(commandShapeError("identity.register", { displayName: "X", role: "treasury" })).toBeUndefined();
  });

  it("rejects an approval decision that is not approved or rejected", () => {
    expect(commandShapeError("approval.resolve", { approvalId: "apd_x", decision: "maybe" })).toBe(
      "invalid enum: decision",
    );
  });

  it("rejects a ladder rung outside 0–5", () => {
    expect(commandShapeError("ladder.set", { agentId: "aid_x", to: 6 })).toBe("invalid integer: to");
  });

  it("rejects a non-integer ladder rung", () => {
    expect(commandShapeError("ladder.set", { agentId: "aid_x", to: 1.5 })).toBe("invalid integer: to");
  });

  it("rejects autonomyLevel outside 0–5", () => {
    expect(commandShapeError("identity.register", { displayName: "X", role: "procurement", autonomyLevel: 9 })).toBe(
      "invalid integer: autonomyLevel",
    );
  });

  it("rejects an issuer kind that is not a listed adapter label", () => {
    expect(commandShapeError("kya.attest", { delegateId: "aid_x", issuerKind: "nope" })).toBe("invalid enum: issuerKind");
  });

  it("rejects a clearing currency that is not the sim rail", () => {
    expect(commandShapeError("clearing.settle_window", { currency: "EUR" })).toBe("invalid enum: currency");
  });

  it("still reports missing required fields before enum misses", () => {
    expect(commandShapeError("identity.register", { role: "god" })).toContain("displayName");
  });

  it("rejects a numeric agentId as a type miss, not a freeze after yes", () => {
    expect(commandShapeError("identity.freeze", { agentId: 1 })).toBe("invalid type: agentId");
  });

  it("rejects a string where an invite list belongs", () => {
    expect(commandShapeError("market.rfq", { sku: "research.brief", spec: "x", invitedSellerIds: "aid_x" })).toBe(
      "invalid type: invitedSellerIds",
    );
  });

  it("rejects an invite list that is not strings", () => {
    expect(commandShapeError("market.rfq", { sku: "research.brief", spec: "x", invitedSellerIds: [1] })).toBe(
      "invalid type: invitedSellerIds",
    );
  });

  it("rejects an empty cart line list", () => {
    expect(commandShapeError("mandate.issue_cart", { intentId: "mid_x", merchantId: "aid_x", line_items: [] })).toBe(
      "invalid type: line_items",
    );
  });

  it("rejects a cart line with no sku or amount", () => {
    expect(commandShapeError("mandate.issue_cart", { intentId: "mid_x", merchantId: "aid_x", line_items: [{}] })).toBe(
      "invalid nested: line_items[0].sku, line_items[0].description, line_items[0].quantity, line_items[0].unitAmount",
    );
  });

  it("rejects an intent constraint that is not an object with a type", () => {
    expect(commandShapeError("mandate.issue_intent", { subjectId: "aid_x", task: "t", constraints: ["cap"] })).toBe(
      "invalid nested: constraints[0]",
    );
  });

  it("rejects an intent constraint object with no type", () => {
    expect(commandShapeError("mandate.issue_intent", { subjectId: "aid_x", task: "t", constraints: [{}] })).toBe(
      "invalid nested: constraints[0].type",
    );
  });

  it("accepts a cart line with an empty description", () => {
    expect(
      commandShapeError("mandate.issue_cart", {
        intentId: "mid_x",
        merchantId: "aid_x",
        line_items: [{ sku: "x", description: "", quantity: 1, unitAmount: { amount: 1, currency: "USD_SIM" } }],
      }),
    ).toBeUndefined();
  });

  it("rejects a cart line whose cents overflow a safe integer", () => {
    expect(
      commandShapeError("mandate.issue_cart", {
        intentId: "mid_x",
        merchantId: "aid_x",
        line_items: [
          {
            sku: "x",
            description: "x",
            quantity: 2,
            unitAmount: { amount: Number.MAX_SAFE_INTEGER, currency: "USD_SIM" },
          },
        ],
      }),
    ).toBe("invalid integer money: line_items[0].unitAmount.amount");
  });

  it("rejects cart lines that mix USD_SIM and USDC_SIM", () => {
    expect(
      commandShapeError("mandate.issue_cart", {
        intentId: "mid_x",
        merchantId: "aid_x",
        line_items: [
          { sku: "x", description: "usd", quantity: 1, unitAmount: { amount: 1, currency: "USD_SIM" } },
          { sku: "x", description: "usdc", quantity: 1, unitAmount: { amount: 1, currency: "USDC_SIM" } },
        ],
      }),
    ).toBe("invalid integer money: line_items[1].unitAmount.currency");
  });

  it("rejects an FX quote whose rate product overflows a safe integer", () => {
    expect(
      commandShapeError("market.quote", {
        rfqId: "rfq_x",
        price: { amount: Number.MAX_SAFE_INTEGER, currency: "USD_SIM" },
        fx: { from: "USD_SIM", to: "USDC_SIM", rateE6: 1_000_000, validUntil: "2026-08-29T00:00:00.000Z" },
      }),
    ).toBe("invalid integer money: price.amount");
  });

  it("rejects an amount_range with no max", () => {
    expect(
      commandShapeError("mandate.issue_intent", {
        subjectId: "aid_x",
        task: "t",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM" }],
      }),
    ).toBe("invalid nested: constraints[0].max");
  });

  it("rejects an unknown constraint type", () => {
    expect(
      commandShapeError("mandate.issue_intent", {
        subjectId: "aid_x",
        task: "t",
        constraints: [{ type: "payment.cap" }],
      }),
    ).toBe("invalid nested: constraints[0].type");
  });

  it("rejects a payee constraint with no list", () => {
    expect(
      commandShapeError("mandate.issue_intent", {
        subjectId: "aid_x",
        task: "t",
        constraints: [{ type: "payment.allowed_payees" }],
      }),
    ).toBe("invalid nested: constraints[0].allowed");
  });

  it("accepts a listed amount_range with currency and max", () => {
    expect(
      commandShapeError("mandate.issue_intent", {
        subjectId: "aid_x",
        task: "t",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 1 }],
      }),
    ).toBeUndefined();
  });

  it("rejects an FX window with no rate", () => {
    expect(
      commandShapeError("market.quote", {
        rfqId: "rfq_x",
        price: { amount: 1, currency: "USD_SIM" },
        fx: { from: "USD_SIM", to: "USDC_SIM", validUntil: "2026-08-29T00:00:00.000Z" },
      }),
    ).toBe("invalid nested: fx.rateE6");
  });

  it("accepts a complete FX window", () => {
    expect(
      commandShapeError("market.quote", {
        rfqId: "rfq_x",
        price: { amount: 1, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-29T00:00:00.000Z",
        },
      }),
    ).toBeUndefined();
  });
});
