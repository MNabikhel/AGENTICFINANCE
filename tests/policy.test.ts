import { describe, expect, it } from "vitest";
import { evaluate, remediationFor } from "@aether/policy";
import { RULE_IDS } from "@aether/policy";
import type { Agent, HireContract, IntentMandate, MandateConstraint, PolicyContext, Signed } from "@aether/types";

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

function hire(over: Partial<HireContract> = {}): HireContract {
  return {
    id: "hid_01J6AETHERHIRE00000000001",
    buyerId: "aid_01J6AETHERAGENT00000000001",
    sellerId: "aid_01J6AETHERAGENT00000000002",
    sku: "research.brief",
    spec: "one pager",
    price: { amount: 80_000, currency: "USD_SIM" },
    state: "offered",
    rfqId: "rfq_01J6AETHERRFQ000000000001",
    quoteId: "qte_01J6AETHERQTE000000000001",
    intentId: "mid_01J6AETHERMAND00000000001",
    escrowAccountId: "acct_01J6AETHERACCT00000000002",
    createdAt: "2026-08-28T00:00:00.000Z",
    ...over,
  };
}

function signedIntent(constraints: MandateConstraint[], over: Partial<IntentMandate> = {}): Signed<IntentMandate> {
  return {
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
      constraints,
      iat: 1,
      exp: 9_999_999_999,
      ...over,
    },
  };
}

describe("policy catalog", () => {
  it("has 55 rules", () => {
    expect(RULE_IDS).toHaveLength(55);
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
    const rem = remediationFor(d);
    expect(rem?.kind).toBe("issue_intent");
    expect(rem?.commandType).toBe("mandate.issue_intent");
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

  it("denies when bilateral exposure would exceed the limit", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 50, currency: "USD_SIM" },
        projectedExposure: 200,
        exposureLimit: 100,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "clearing.bilateral_limit")?.verdict).toBe("deny");
    expect(d.verdict).toBe("deny");
  });

  it("denies spend when KYA path is missing", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        kya: {
          required: true,
          pathOk: false,
          implicit: false,
          depth: 0,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: true,
          hops: [],
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("deny");
    expect(d.verdict).toBe("deny");
  });

  it("denies spend when the principal is frozen", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: true,
          expired: false,
          revoked: false,
          hops: [],
          grantedMaxAutonomy: 5,
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.principal_not_frozen")?.verdict).toBe("deny");
  });

  it("allows L5 to skip the approval threshold while amount_range still denies", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 5 }),
        commandType: "hire.create",
        amount: { amount: 900000, currency: "USD_SIM" },
        circuit: { dailySpend: 0, dailyLimit: 10_000_000, tripped: false },
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
            constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 800000 }],
            iat: 1,
            exp: 9_999_999_999,
          },
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "approval.threshold")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("deny");
    expect(d.verdict).toBe("deny");
  });

  it("denies a sub-intent wider than its parent", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 900000 }],
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.verdict).toBe("deny");
  });

  it("allows a tighter sub-intent", () => {
    const parent = signedIntent([
      { type: "payment.amount_range", currency: "USD_SIM", max: 500000 },
      { type: "payment.budget", currency: "USD_SIM", max: 1000000 },
      { type: "aether.allowed_skus", allowed: ["research.brief", "research.deep"] },
    ]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 200000 },
          { type: "payment.budget", currency: "USD_SIM", max: 300000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
        ],
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
  });

  it("denies a child recurrence that is more frequent than the parent", () => {
    const parent = signedIntent([
      { type: "payment.amount_range", currency: "USD_SIM", max: 500000 },
      { type: "payment.agent_recurrence", frequency: "DAILY", max_occurrences: 4 },
    ]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 200000 },
          { type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 4 },
        ],
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
  });

  it("denies a child execution window that outlives the parent", () => {
    const parent = signedIntent([
      { type: "payment.amount_range", currency: "USD_SIM", max: 500000 },
      {
        type: "payment.execution_date",
        not_before: "2026-08-28T00:00:00.000Z",
        not_after: "2026-08-29T00:00:00.000Z",
      },
    ]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 200000 },
          {
            type: "payment.execution_date",
            not_before: "2026-08-28T00:00:00.000Z",
            not_after: "2026-08-31T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
  });

  it("denies a new hire when the DAILY gap has not elapsed", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        occurrenceCount: 1,
        lastOccurrenceAt: "2026-08-28T00:00:00.000Z",
        clock: "2026-08-28T01:00:00.000Z",
        intent: signedIntent([{ type: "payment.agent_recurrence", frequency: "DAILY", max_occurrences: 8 }]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not treat completing a funded hire as a new occurrence", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.deliver",
        occurrenceCount: 8,
        intent: signedIntent([{ type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 8 }]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("allow");
  });

  it("denies child spend that exhausts the parent budget", () => {
    const parent = signedIntent([{ type: "payment.budget", currency: "USD_SIM", max: 100000 }]);
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 30000, currency: "USD_SIM" },
        parentIntent: parent,
        parentSpent: 80000,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.parent_budget")?.verdict).toBe("deny");
    expect(d.verdict).toBe("deny");
  });

  it("tells an agent to reset the fuse when the daily circuit denies", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 1, currency: "USD_SIM" },
        circuit: { dailySpend: 0, dailyLimit: 10, tripped: true },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "circuit.daily")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("reset_circuit");
  });

  it("tells an agent to wait on the approval ticket when policy escalates", () => {
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
    expect(remediationFor(d)?.kind).toBe("wait_approval");
  });

  it("denies SKUs that are not in the catalog", () => {
    const d = evaluate(ctx({ commandType: "market.rfq", skuListed: false }));
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies hiring on an expired quote", () => {
    const d = evaluate(ctx({ commandType: "hire.create", marketFresh: false, skuListed: true }));
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("deny");
  });

  it("denies a seller who is not on the RFQ invite list", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        sellerInvited: false,
        skuListed: true,
        marketFresh: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a cart that does not match the hire", () => {
    const d = evaluate(ctx({ commandType: "hire.fund", cartMatchesHire: false }));
    expect(d.trace.find((t) => t.ruleId === "hire.cart_matches")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies hiring on a quote that is already used", () => {
    const d = evaluate(ctx({ commandType: "hire.create", quoteUnspent: false, rfqKnown: true, skuListed: true }));
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("hire.quote_unspent");
  });

  it("denies a missing hire as hire.known, not a broken chain", () => {
    const d = evaluate(ctx({ commandType: "hire.fund", hireKnown: false }));
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.known");
  });

  it("denies a missing intent as known_intent, not a missing handshake", () => {
    const d = evaluate(ctx({ commandType: "hire.create", intentKnown: false, rfqKnown: true, skuListed: true }));
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_intent");
  });

  it("denies a missing cart as known_cart, not a mutate throw", () => {
    const d = evaluate(ctx({ commandType: "mandate.issue_payment", cartKnown: false }));
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_cart");
  });

  it("denies a missing approval as approval.known, not a late yes", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "approval.resolve",
        approvalKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "approval.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("approval.known");
  });

  it("denies an expired or resolved ticket as approval.pending", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "approval.resolve",
        approvalKnown: true,
        approvalPending: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "approval.known")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("approval.pending");
  });

  it("denies a non-seller accepting a hire as hire.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "hire.accept",
        hireKnown: true,
        hirePartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.party");
  });

  it("denies a non-buyer refunding a hire as hire.party", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.refund",
        hireKnown: true,
        hirePartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a sub-intent against a missing parent as known_parent, not child_tighter", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        parentKnown: false,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100 }],
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_parent");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies freeze of a missing agent as identity.known, not a mutate throw", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "identity.freeze",
        targetKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a second accept as hire.state, not a mutate throw", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "hire.accept",
        hire: hire({ state: "accepted" }),
        hireKnown: true,
        hirePartyOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.escrow_required")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.state");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a refund after deliver as hire.state, not a missing party", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.refund",
        hire: hire({ state: "delivered" }),
        hireKnown: true,
        hirePartyOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.state");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows an accept from offered", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "hire.accept",
        hire: hire({ state: "offered" }),
        hireKnown: true,
        hirePartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
  });

  it("denies payment-required before deliver as hire.state", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "envelope.require",
        hire: hire({ state: "funded" }),
        hireKnown: true,
        hirePartyOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.escrow_required")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.state");
  });

  it("denies skipping a ladder rung as ladder.legal, not a mutate throw", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "ladder.set",
        targetKnown: true,
        ladderLegal: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.legal")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ladder.legal");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies attesting yourself as kya.not_self, not a missing agent", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.not_self");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a nested handshake against a missing parent hop as kya.known_parent, not a live handshake", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaParentKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.known_parent");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a transfer to a missing book as ledger.known_account, not a mutate throw", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "ledger.transfer",
        accountsKnown: false,
        amount: { amount: 1000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.known_account");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a mixed-currency transfer as ledger.same_currency, not a mutate throw", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "ledger.transfer",
        accountsKnown: true,
        accountsSameCurrency: false,
        amount: { amount: 1000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.same_currency");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies FX settle without a live unused FX quote", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        fxQuoteLive: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_quote");
  });

  it("denies a quote against an unknown RFQ as known_rfq, not known_sku", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
  });

  it("does not freeze a funded hire when the execution window has closed", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.deliver",
        clock: "2026-08-30T00:00:00.000Z",
        intent: signedIntent([
          {
            type: "payment.execution_date",
            not_before: "2026-08-28T00:00:00.000Z",
            not_after: "2026-08-29T00:00:00.000Z",
          },
        ]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.execution_date")?.verdict).toBe("allow");
  });

  it("refuses a new hire after not_after", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        clock: "2026-08-30T00:00:00.000Z",
        intent: signedIntent([
          {
            type: "payment.execution_date",
            not_before: "2026-08-28T00:00:00.000Z",
            not_after: "2026-08-29T00:00:00.000Z",
          },
        ]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.execution_date")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
  });
});
