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
});
