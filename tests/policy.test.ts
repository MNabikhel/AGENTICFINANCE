import { describe, expect, it } from "vitest";
import { evaluate } from "@aether/policy";
import { RULE_IDS } from "@aether/policy";
import type { Agent, PolicyContext } from "@aether/types";

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "aid_01J6AETHERAGENT00000000001",
    did: "did:aether:procurement:x",
    displayName: "Proc",
    role: "procurement",
    autonomyLevel: 3,
    keys: [],
    accountId: "acct_01J6AETHERACCT00000000001",
    supervisors: [],
    createdAt: "2026-08-28T00:00:00.000Z",
    frozen: false,
    ...over,
  };
}

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  const actor = over.actor ?? agent();
  return {
    clock: "2026-08-28T00:00:00.000Z",
    actor,
    counterparties: [actor],
    commandType: "ledger.balances",
    spentAgainstIntent: 0,
    occurrenceCount: 0,
    velocity: { windowSeconds: 3600, count: 0, volume: 0 },
    circuit: { dailySpend: 0, dailyLimit: 10_000_000, tripped: false },
    auditHealthy: true,
    ...over,
  };
}

describe("policy catalog", () => {
  it("has 26 rules", () => {
    expect(RULE_IDS).toHaveLength(26);
  });

  it("denies frozen actors", () => {
    const d = evaluate(ctx({ actor: agent({ frozen: true }) }));
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.not_frozen")?.verdict).toBe("deny");
  });

  it("denies auditor spend", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "auditor", autonomyLevel: 0 }),
        commandType: "envelope.submit",
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("deny");
  });

  it("denies amount_range overflow", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 640000, currency: "USD_SIM" },
        intent: {
          issuer: "did:aether:human",
          kid: "k",
          alg: "EdDSA",
          jws: "x",
          payload: {
            vct: "aether.mandate.intent.open.1",
            id: "mid_01J6AETHERMAND00000000001",
            issuerId: "aid_human",
            subjectId: "aid_01J6AETHERAGENT00000000001",
            task: "t",
            constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500000 }],
            iat: 1,
            exp: 9_999_999_999,
          },
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("deny");
  });

  it("escalates procurement above $5,000", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 640000, currency: "USD_SIM" },
        hire: {
          id: "hid_draft",
          buyerId: "aid_01J6AETHERAGENT00000000001",
          sellerId: "aid_01J6AETHERAGENT00000000002",
          sku: "compute.gpu.hours",
          spec: "x",
          price: { amount: 640000, currency: "USD_SIM" },
          state: "offered",
          rfqId: "rfq_01J6AETHERRFQ000000000001",
          quoteId: "qte_01J6AETHERQTE000000000001",
          intentId: "mid_01J6AETHERMAND00000000001",
          escrowAccountId: "acct_01J6AETHERACCT00000000002",
          createdAt: "2026-08-28T00:00:00.000Z",
        },
        intent: {
          issuer: "did:aether:human",
          kid: "k",
          alg: "EdDSA",
          jws: "x",
          payload: {
            vct: "aether.mandate.intent.open.1",
            id: "mid_01J6AETHERMAND00000000001",
            issuerId: "aid_human",
            subjectId: "aid_01J6AETHERAGENT00000000001",
            task: "t",
            constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 700000 }],
            iat: 1,
            exp: 9_999_999_999,
          },
        },
      }),
    );
    expect(d.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "approval.threshold")?.verdict).toBe("escalate");
  });

  it("denies self-deal", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        hire: {
          id: "hid_draft",
          buyerId: "aid_01J6AETHERAGENT00000000001",
          sellerId: "aid_01J6AETHERAGENT00000000001",
          sku: "x",
          spec: "x",
          price: { amount: 1, currency: "USD_SIM" },
          state: "offered",
          rfqId: "rfq_01J6AETHERRFQ000000000001",
          quoteId: "qte_01J6AETHERQTE000000000001",
          intentId: "mid_01J6AETHERMAND00000000001",
          escrowAccountId: "acct_01J6AETHERACCT00000000002",
          createdAt: "2026-08-28T00:00:00.000Z",
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "hire.no_self_deal")?.verdict).toBe("deny");
  });
});
