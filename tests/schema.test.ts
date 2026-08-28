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
});
