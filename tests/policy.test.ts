import { describe, expect, it } from "vitest";
import { evaluate, remediationFor } from "@aether/policy";
import { RULE_IDS } from "@aether/policy";
import type { Agent, CartMandate, HireContract, IntentMandate, MandateConstraint, PaymentMandate, PolicyContext, Signed } from "@aether/types";

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

const HASH = "0".repeat(64);
const MERCHANT = {
  id: "aid_01J6AETHERAGENT00000000002" as const,
  name: "Vendor",
  website: "https://data_vendor.aether.test",
};

function signedCart(over: Partial<CartMandate> = {}): Signed<CartMandate> {
  return {
    issuer: "did:aether:vendor",
    kid: "k",
    alg: "EdDSA",
    jws: "x",
    payload: {
      vct: "aether.mandate.cart.1",
      id: "mid_01J6AETHERCART00000000001",
      intentId: "mid_01J6AETHERMAND00000000001",
      intentHash: HASH,
      merchant: MERCHANT,
      line_items: [],
      total: { amount: 80_000, currency: "USD_SIM" },
      expiresAt: "2026-08-29T00:00:00.000Z",
      userConfirmationRequired: false,
      ...over,
    },
  };
}

function signedPayment(over: Partial<PaymentMandate> = {}): Signed<PaymentMandate> {
  return {
    issuer: "did:aether:proc",
    kid: "k",
    alg: "EdDSA",
    jws: "x",
    payload: {
      vct: "aether.mandate.payment.1",
      id: "mid_01J6AETHERPAY000000000001",
      transaction_id: HASH,
      payee: MERCHANT,
      payment_amount: { amount: 80_000, currency: "USD_SIM" },
      payment_instrument: { id: "sim-ledger", type: "sim_ledger", description: "sim" },
      iat: 1,
      exp: 9_999_999_999,
      ...over,
    },
  };
}

describe("policy catalog", () => {
  it("has 87 rules", () => {
    expect(RULE_IDS).toHaveLength(87);
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

  it("denies amount_range with no max, not an open checkbook", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 80_000, currency: "USD_SIM" },
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM" } as MandateConstraint]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("deny");
  });

  it("denies a payee constraint with no list, not a throw", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        payeeId: MERCHANT.id,
        intent: signedIntent([{ type: "payment.allowed_payees" } as MandateConstraint]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.allowed_payees")?.verdict).toBe("deny");
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
    expect(d.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("allow");
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
    expect(d.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("allow");
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
    expect(d.trace.find((t) => t.ruleId === "approval.replay")?.verdict).toBe("allow");
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

  it("denies an RFQ that invites a missing agent as identity.known", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "market.rfq",
        skuListed: true,
        targetKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("still names market.known_sku first when the SKU is missing on a ghost invite", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "market.rfq",
        skuListed: false,
        targetKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.known_sku");
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

  it("denies revoking a missing handshake as kya.known_attestation, not a silent tombstone", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.revoke",
        kyaAttestationKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.known_attestation")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.known_attestation");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies minting a handshake in someone else’s name as kya.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies tombstoning someone else’s handshake as kya.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.revoke",
        kyaPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.known_attestation")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies an L4 grant of L5 as kya.capability_subset, not a standing-mandate handshake", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 0,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          proposedMaxAutonomy: 5,
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.capability_subset");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.capability_subset when the grant is within the actor’s rung", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 0,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          proposedMaxAutonomy: 4,
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
  });

  it("does not name kya.capability_subset when a human grants L5", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kya: {
          required: false,
          pathOk: true,
          implicit: false,
          depth: 0,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          proposedMaxAutonomy: 5,
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
  });

  it("denies a reused register alias as identity.unique_key", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "identity.register",
        aliasFree: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("identity.unique_key");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a missing receipt as receipt.known", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "receipt.get",
        receiptKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "receipt.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("receipt.known");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies unfreeze of a live unfrozen agent as identity.freeze_state", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "identity.unfreeze",
        targetKnown: true,
        freezeStateOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.freeze_state")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("identity.freeze_state");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies freeze of an already-frozen agent as identity.freeze_state", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "identity.freeze",
        targetKnown: true,
        freezeStateOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.freeze_state")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("identity.freeze_state");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a second live handshake for the same pair as kya.unique_live", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
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

  it("denies an FX settle without a USDC book as ledger.known_account, not a journal throw", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "compute_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        fxQuoteLive: true,
        mmInventoryOk: true,
        accountsKnown: false,
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mm.inventory")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("allow");
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

  it("denies an overdraft as ledger.sufficient, not a negative book", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "ledger.transfer",
        accountsKnown: true,
        accountsSameCurrency: true,
        fundsOk: false,
        amount: { amount: 5_000_001, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.sufficient");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies funding escrow that would overdraw the buyer as ledger.sufficient, not a negative book", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.fund",
        hire: hire({ state: "accepted" }),
        hireKnown: true,
        fundsOk: false,
        intent: signedIntent([]),
        cart: signedCart(),
        payment: signedPayment(),
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.sufficient");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies an FX settle that would overdraw the vendor as ledger.sufficient, not MM inventory", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        fxQuoteLive: true,
        mmInventoryOk: true,
        fundsOk: false,
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.inventory")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.sufficient");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a dest that cannot hold the cents as ledger.safe_balance, not silent IEEE rounding", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "ledger.transfer",
        accountsKnown: true,
        accountsSameCurrency: true,
        fundsOk: true,
        balancesSafe: false,
        operatingBooksOk: true,
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.safe_balance");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("still names ledger.sufficient first when the source cannot cover, even if dest would also overflow", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "ledger.transfer",
        accountsKnown: true,
        accountsSameCurrency: true,
        fundsOk: false,
        amount: { amount: 5_000_001, currency: "USD_SIM" },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.sufficient");
  });

  it("denies funding escrow that would overflow a dest as ledger.safe_balance", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.fund",
        hire: hire({ state: "accepted" }),
        hireKnown: true,
        fundsOk: true,
        accountsSameCurrency: true,
        balancesSafe: false,
        intent: signedIntent([]),
        cart: signedCart(),
        payment: signedPayment(),
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.safe_balance");
  });

  it("denies a refund whose buyer book cannot hold the cents as ledger.safe_balance", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "hire.refund",
        hire: hire({ state: "funded" }),
        hireKnown: true,
        hirePartyOk: true,
        balancesSafe: false,
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.safe_balance");
  });

  it("denies an FX settle whose dest cannot hold the cents as ledger.safe_balance, not MM inventory", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        fxQuoteLive: true,
        mmKnown: true,
        mmInventoryOk: true,
        accountsKnown: true,
        fundsOk: true,
        balancesSafe: false,
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.inventory")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.safe_balance");
  });

  it("does not name ledger.safe_balance when the quote itself is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        fxQuoteLive: false,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_quote");
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
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
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
    expect(d.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
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

  it("denies a second cart on a hire that already has one", () => {
    const d = evaluate(
      ctx({
        commandType: "mandate.issue_cart",
        hire: hire({ cartId: "mid_01J6AETHERCART00000000001" }),
        cartUnbound: false,
        cartMatchesHire: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.unique_cart")?.verdict).toBe("deny");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies a second payment on a cart that already has one", () => {
    const d = evaluate(
      ctx({
        commandType: "mandate.issue_payment",
        cartKnown: true,
        paymentUnbound: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name unique_payment when the cart itself is missing", () => {
    const d = evaluate(ctx({ commandType: "mandate.issue_payment", cartKnown: false }));
    expect(d.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_cart");
  });

  it("denies a listed SKU priced in a currency the catalog does not list", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: false,
        sellerInvited: true,
        marketFresh: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.sku_currency");
  });

  it("does not name sku_currency when the SKU itself is missing", () => {
    const d = evaluate(ctx({ commandType: "market.rfq", skuListed: false }));
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.known_sku");
  });

  it("denies funding a USDC hire from USD cash as ledger.same_currency, not a journal throw", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.fund",
        hire: hire({ state: "accepted", price: { amount: 80_000, currency: "USDC_SIM" } }),
        hireKnown: true,
        accountsSameCurrency: false,
        intent: signedIntent([]),
        cart: signedCart({ total: { amount: 80_000, currency: "USDC_SIM" } }),
        payment: signedPayment({ payment_amount: { amount: 80_000, currency: "USDC_SIM" } }),
        amount: { amount: 80_000, currency: "USDC_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ledger.same_currency");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies an FX window that is not this rail's USD_SIM to USDC_SIM pair", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: true,
        fxPairOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_pair");
  });

  it("does not name fx_pair when the SKU itself is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: false,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.known_sku");
  });

  it("denies hiring an FX window as a good", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: true,
        quoteUnspent: true,
        hireNotFx: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("hire.not_fx");
  });

  it("does not name hire.not_fx when the quote itself is missing", () => {
    const d = evaluate(ctx({ commandType: "hire.create", rfqKnown: false }));
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
  });

  it("denies approving a ticket whose paused command is no longer legal", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "approval.resolve",
        approvalKnown: true,
        approvalPending: true,
        replayOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "approval.replay")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "approval.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("approval.replay");
  });

  it("does not name approval.replay when the ticket itself is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "approval.resolve",
        approvalKnown: false,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "approval.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "approval.replay")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("approval.known");
  });

  it("denies quoting an FX SKU without a window", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: true,
        fxWindowOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_window");
  });

  it("does not name fx_window when the SKU itself is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: false,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.known_sku");
  });

  it("denies funding a hire that has not bound a cart", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.fund",
        hire: hire({ state: "accepted" }),
        hireKnown: true,
        cartBound: false,
        intent: signedIntent([]),
        cart: signedCart(),
        payment: signedPayment(),
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.bound_cart")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.unique_cart")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("hire.bound_cart");
  });

  it("does not name bound_cart when the hire itself is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.fund",
        hireKnown: false,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.bound_cart")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.known");
  });

  it("denies an FX settle with no market maker", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        fxQuoteLive: true,
        fxPairOk: true,
        accountsKnown: true,
        fundsOk: true,
        mmKnown: false,
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.inventory")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("mm.known");
  });

  it("does not name mm.known when the quote itself is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        fxQuoteLive: false,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_quote");
  });

  it("denies a command whose speaker is not in this world", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances", actorKnown: false }));
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.not_frozen")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("actor.known");
  });

  it("does not name actor.known when the speaker is registered", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "actor.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("allow");
  });

  it("denies system spending as actor.system_scope, not a treasurer costume", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 5 }),
        commandType: "ledger.transfer",
        accountsKnown: true,
        accountsSameCurrency: true,
        fundsOk: true,
        balancesSafe: true,
        systemOk: false,
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("actor.system_scope");
  });

  it("allows system to read the catalog", () => {
    const d = evaluate(ctx({ commandType: "market.catalog", systemOk: true }));
    expect(d.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
  });

  it("does not name actor.system_scope when the speaker is a registered agent", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
  });

  it("denies a transfer against equity as ledger.operating_book, not a mint", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "ledger.transfer",
        accountsKnown: true,
        accountsSameCurrency: true,
        fundsOk: true,
        balancesSafe: true,
        operatingBooksOk: false,
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("ledger.operating_book");
  });

  it("does not name ledger.operating_book when the books are operating cash", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "ledger.transfer",
        accountsKnown: true,
        accountsSameCurrency: true,
        fundsOk: true,
        balancesSafe: true,
        operatingBooksOk: true,
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("allow");
  });

  it("does not name ledger.operating_book when the speaker is not transferring", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("allow");
  });

  it("denies minting L5 at register as ladder.birth_rung, not a freeze skip", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "identity.register",
        aliasFree: true,
        birthRungOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.birth_rung")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ladder.legal")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("ladder.birth_rung");
  });

  it("does not name ladder.birth_rung when the birth rung is L3", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "identity.register",
        aliasFree: true,
        birthRungOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "ladder.birth_rung")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("allow");
  });

  it("does not name ladder.birth_rung when the speaker is not registering", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "ladder.birth_rung")?.verdict).toBe("allow");
  });

  it("still names identity.unique_key first when L5 would also be a birth refuse", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "identity.register",
        aliasFree: false,
        birthRungOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.birth_rung")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("identity.unique_key");
  });

  it("escalates L1 hire.create as ladder.min_level", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 1 }),
        commandType: "hire.create",
        intentKnown: true,
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        hireNotFx: true,
        quoteUnspent: true,
        marketFresh: true,
        sellerInvited: true,
      }),
    );
    expect(d.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "approval.threshold")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("wait_approval");
    expect(remediationFor(d)?.ruleId).toBe("ladder.min_level");
  });

  it("allows L1 hire.create when a ticket waived the hire rung", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 1 }),
        commandType: "hire.create",
        thresholdWaived: true,
        intentKnown: true,
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        hireNotFx: true,
        quoteUnspent: true,
        marketFresh: true,
        sellerInvited: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("allow");
  });

  it("does not let a waived ticket mint a sub-intent below L4", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 3 }),
        commandType: "mandate.issue_intent",
        thresholdWaived: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("ladder.min_level");
  });

  it("denies a reused envelope nonce as idempotency.nonce", () => {
    const d = evaluate(
      ctx({
        commandType: "envelope.submit",
        nonceSeen: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "idempotency.nonce")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("idempotency.nonce");
  });

  it("does not name idempotency.nonce when a transfer carries a leftover nonce flag", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "treasury", autonomyLevel: 3 }),
        commandType: "ledger.transfer",
        nonceSeen: true,
        accountsKnown: true,
        accountsSameCurrency: true,
        fundsOk: true,
        balancesSafe: true,
        operatingBooksOk: true,
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "idempotency.nonce")?.verdict).toBe("allow");
    expect(d.verdict).not.toBe("deny");
  });

  it("denies a handshake born expired as kya.mint_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.mint_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.mint_fresh when the hop expires after now", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
  });

  it("does not name kya.mint_fresh when the speaker is not attesting", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
  });

  it("still names kya.unique_live first when a second hop would also be born dead", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
        kyaMintFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
  });

  it("denies a handshake that outlives one year as kya.mint_window", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaMintWindowOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.mint_window");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.mint_window when the hop expires within one year", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaMintWindowOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
  });

  it("does not name kya.mint_window when the speaker is not attesting", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
  });

  it("still names kya.mint_fresh first when a corpse would also fail the year ceiling", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: false,
        kyaMintWindowOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.mint_fresh");
  });

  it("still names kya.unique_live first when a second hop would also outlive one year", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
        kyaMintFresh: true,
        kyaMintWindowOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
  });

  it("denies a slip born with a closed calendar as mandate.window_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        windowMintFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.execution_date")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.window_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.window_fresh when the window can still open", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        windowMintFresh: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.window_fresh when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("allow");
  });

  it("still names identity.known first when a ghost subject is also born closed", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: false,
        windowMintFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
  });

  it("still names mandate.known_parent first when a ghost parent is also born closed", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: false,
        windowMintFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_parent");
  });

  it("still names mandate.child_tighter first when a wider child is also born closed", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        proposedConstraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 200_000 },
          { type: "payment.execution_date", not_after: "2020-01-01T00:00:00.000Z" },
        ],
        windowMintFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_tighter");
  });

  it("denies a window that opens after the slip dies as mandate.window_reach", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        windowMintFresh: true,
        windowReachOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_reach")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "payment.execution_date")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.window_reach");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.window_reach when the window opens while the slip lives", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        windowMintFresh: true,
        windowReachOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.window_reach")?.verdict).toBe("allow");
  });

  it("does not name mandate.window_reach when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.window_reach")?.verdict).toBe("allow");
  });

  it("still names mandate.window_fresh first when a corpse would also open too late", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        windowMintFresh: false,
        windowReachOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_reach")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.window_fresh");
  });

  it("still names identity.known first when a ghost subject would also open too late", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: false,
        windowMintFresh: true,
        windowReachOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_reach")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
  });

  it("still names mandate.known_parent first when a ghost parent would also open too late", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: false,
        windowMintFresh: true,
        windowReachOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_reach")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_parent");
  });

  it("denies a slip born with no slots as mandate.occurrence_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        occurrenceMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.occurrence_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.occurrence_fresh when the cadence still has a first slot", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        occurrenceMintOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.occurrence_fresh when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
  });

  it("still names identity.known first when a ghost subject is also born with no slots", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: false,
        occurrenceMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
  });

  it("still names mandate.known_parent first when a ghost parent is also born with no slots", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: false,
        occurrenceMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_parent");
  });

  it("still names mandate.child_tighter first when a wider child is also born with no slots", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        proposedConstraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 200_000 },
          { type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 0 },
        ],
        occurrenceMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_tighter");
  });

  it("denies minting under an expired parent as mandate.parent_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }], { exp: 1 }),
        parentFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.parent_fresh");
    expect(remediationFor(d)?.kind).toBe("issue_intent");
  });

  it("does not name mandate.parent_fresh when the parent still lives", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        parentFresh: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.parent_fresh when the speaker is not minting or starting a spend", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.parent_fresh when completing a funded hire", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.deliver",
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }], { exp: 1 }),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
  });

  it("still names mandate.known_parent first when the parent is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_parent");
  });

  it("still names mandate.child_tighter first when a wider child is also under a dead parent", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }], { exp: 1 }),
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 200_000 }],
        parentFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_tighter");
  });

  it("still names mandate.not_expired first when the child itself is dead", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }], { exp: 1 }),
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 200_000 }], { exp: 1 }),
        parentFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.not_expired");
  });

  it("does not name mandate.not_expired on deliver after the cart window", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.deliver",
        hire: hire({ state: "funded" }),
        cart: signedCart({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        payment: signedPayment({ exp: 1 }),
        intent: signedIntent([]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
  });

  it("does not name mandate.not_expired on refund, release, or submit after the cart window", () => {
    for (const commandType of ["hire.refund", "hire.release", "envelope.submit", "envelope.require"] as const) {
      const d = evaluate(
        ctx({
          commandType,
          hire: hire({ state: commandType === "hire.refund" ? "funded" : "delivered" }),
          cart: signedCart({ expiresAt: "2020-01-01T00:00:00.000Z" }),
          payment: signedPayment({ exp: 1 }),
          intent: signedIntent([]),
        }),
      );
      expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    }
  });

  it("still names mandate.not_expired on fund of a stale cart", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.fund",
        hire: hire({ state: "accepted" }),
        cart: signedCart({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        payment: signedPayment({ exp: 1 }),
        intent: signedIntent([]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("deny");
  });

  it("still names mandate.not_expired on a first payment for a stale unpaid cart", () => {
    const d = evaluate(
      ctx({
        commandType: "mandate.issue_payment",
        cart: signedCart({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        cartKnown: true,
        paymentUnbound: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.not_expired");
  });

  it("denies a new hire against a live child of a dead parent as mandate.parent_fresh", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 200_000 }], { exp: 1 }),
        parentFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.parent_fresh");
  });

  it("denies a nested handshake under an expired parent hop as kya.parent_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaParentKnown: true,
        kyaParentFresh: false,
        kyaMintFresh: true,
        kyaMintWindowOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.parent_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.parent_fresh when the parent hop still lives", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        kyaMintFresh: true,
        kyaMintWindowOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
  });

  it("does not name kya.parent_fresh when the speaker is not nesting", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
  });

  it("still names kya.known_parent first when the parent hop is missing", () => {
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
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.known_parent");
  });

  it("still names kya.unique_live first when the pair is also occupied under a dead parent", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
        kyaParentKnown: true,
        kyaParentFresh: false,
        kyaMintFresh: true,
        kyaMintWindowOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
  });

  it("still names kya.mint_fresh first when the child hop is also born dead", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaParentKnown: true,
        kyaParentFresh: false,
        kyaMintFresh: false,
        kyaMintWindowOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.mint_fresh");
  });

  it("still names kya.mint_window first when the child hop would also outlive one year", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaParentKnown: true,
        kyaParentFresh: false,
        kyaMintFresh: true,
        kyaMintWindowOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.mint_window");
  });

  it("still names kya.not_self first when the grantor would also nest under a dead parent", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: false,
        kyaParentKnown: true,
        kyaParentFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.not_self");
  });

  it("still names kya.capability_subset first when L4 omit would also write L5 under a dead parent", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaParentKnown: true,
        kyaParentFresh: false,
        kyaMintFresh: true,
        kyaMintWindowOk: true,
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 0,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          proposedMaxAutonomy: 5,
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.capability_subset");
  });

  it("denies a hire against a nested hop whose parent died as kya.parent_fresh", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        kyaParentFresh: false,
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.parent_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.parent_fresh when completing a funded hire", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.deliver",
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
  });

  it("does not name kya.parent_fresh on a hire whose path has no nested hop", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        kya: {
          required: true,
          pathOk: true,
          implicit: true,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
  });

  it("does not name kya.attestation_fresh on release after the hop dies", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.release",
        hire: hire({ state: "delivered" }),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: true,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.message).toBe("handshake checked at fund");
  });

  it("does not name kya.attestation_fresh on refund, submit, require, or deliver after the hop dies", () => {
    for (const commandType of ["hire.refund", "envelope.submit", "envelope.require", "hire.deliver"] as const) {
      const d = evaluate(
        ctx({
          commandType,
          hire: hire({ state: commandType === "hire.refund" ? "funded" : "delivered" }),
          kya: {
            required: true,
            pathOk: true,
            implicit: false,
            depth: 1,
            maxDepth: 3,
            principalFrozen: false,
            expired: true,
            revoked: false,
            hops: [],
          },
        }),
      );
      expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    }
  });

  it("still names kya.attestation_fresh on a new hire after the hop dies", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: true,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.attestation_fresh");
  });

  it("still names kya.attestation_fresh on fund after the hop dies", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.fund",
        hire: hire({ state: "accepted" }),
        cart: signedCart(),
        payment: signedPayment(),
        intent: signedIntent([]),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: true,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.attestation_fresh");
  });

  it("still names kya.chain_intact first on release when the hop is revoked", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.release",
        hire: hire({ state: "delivered" }),
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
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.chain_intact");
  });

  it("still names kya.principal_not_frozen first on release when the principal is frozen", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.release",
        hire: hire({ state: "delivered" }),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: true,
          expired: true,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.principal_not_frozen")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.principal_not_frozen");
  });

  it("does not name kya.capability_subset on release after a climb above the grant", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "hire.release",
        hire: hire({ state: "delivered" }),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          grantedMaxAutonomy: 3,
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.message).toBe("grant checked at fund");
  });

  it("does not name kya.capability_subset on refund, submit, require, or deliver after a climb above the grant", () => {
    for (const commandType of ["hire.refund", "envelope.submit", "envelope.require", "hire.deliver"] as const) {
      const d = evaluate(
        ctx({
          actor: agent({ autonomyLevel: 4 }),
          commandType,
          hire: hire({ state: commandType === "hire.refund" ? "funded" : "delivered" }),
          kya: {
            required: true,
            pathOk: true,
            implicit: false,
            depth: 1,
            maxDepth: 3,
            principalFrozen: false,
            expired: false,
            revoked: false,
            hops: [],
            grantedMaxAutonomy: 3,
          },
        }),
      );
      expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    }
  });

  it("still names kya.capability_subset on a new hire after a climb above the grant", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          grantedMaxAutonomy: 3,
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.capability_subset");
  });

  it("still names kya.capability_subset on fund after a climb above the grant", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "hire.fund",
        hire: hire({ state: "accepted" }),
        cart: signedCart(),
        payment: signedPayment(),
        intent: signedIntent([]),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          grantedMaxAutonomy: 3,
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.capability_subset");
  });

  it("still names kya.attestation_fresh first when the hop also died after the climb", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: true,
          revoked: false,
          hops: [],
          grantedMaxAutonomy: 3,
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.attestation_fresh");
  });

  it("does not name ladder.max_autonomy_constraint on release after a climb above the slip ceiling", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "hire.release",
        hire: hire({ state: "delivered" }),
        intent: signedIntent([{ type: "aether.max_autonomy", max: 3 }]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "ladder.max_autonomy_constraint")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ladder.max_autonomy_constraint")?.message).toBe("rung checked at fund");
  });

  it("does not name ladder.max_autonomy_constraint on refund, submit, require, or deliver after a climb above the slip ceiling", () => {
    for (const commandType of ["hire.refund", "envelope.submit", "envelope.require", "hire.deliver"] as const) {
      const d = evaluate(
        ctx({
          actor: agent({ autonomyLevel: 4 }),
          commandType,
          hire: hire({ state: commandType === "hire.refund" ? "funded" : "delivered" }),
          intent: signedIntent([{ type: "aether.max_autonomy", max: 3 }]),
        }),
      );
      expect(d.trace.find((t) => t.ruleId === "ladder.max_autonomy_constraint")?.verdict).toBe("allow");
    }
  });

  it("still names ladder.max_autonomy_constraint on a new hire after a climb above the slip ceiling", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "hire.create",
        intent: signedIntent([
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.max_autonomy", max: 3 },
        ]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.max_autonomy_constraint")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ladder.max_autonomy_constraint");
    expect(remediationFor(d)?.kind).toBe("issue_intent");
  });

  it("still names ladder.max_autonomy_constraint on fund after a climb above the slip ceiling", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "hire.fund",
        hire: hire({ state: "accepted" }),
        cart: signedCart(),
        payment: signedPayment(),
        intent: signedIntent([
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "aether.max_autonomy", max: 3 },
        ]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.max_autonomy_constraint")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ladder.max_autonomy_constraint");
  });

  it("still names ladder.max_autonomy_constraint first when the handshake grant is also below the climb", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "hire.create",
        intent: signedIntent([
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.max_autonomy", max: 3 },
        ]),
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          grantedMaxAutonomy: 3,
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.max_autonomy_constraint")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("ladder.max_autonomy_constraint");
  });

  it("still names kya.attestation_fresh first when the nested hop is also expired", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        kyaParentFresh: false,
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: true,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.attestation_fresh");
  });

  it("still names mandate.parent_fresh first when the parent slip is also dead", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 200_000 }], { exp: 1 }),
        parentFresh: false,
        kyaParentFresh: false,
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 1,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
        },
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.parent_fresh");
  });

  it("denies quoting an FX window already closed as market.fx_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "market_maker", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: true,
        fxWindowOk: true,
        fxPairOk: true,
        fxMintFresh: false,
        fxRateE6: 998_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_fresh");
  });

  it("does not name market.fx_fresh when the window is still open", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "market_maker", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: true,
        fxWindowOk: true,
        fxPairOk: true,
        fxMintFresh: true,
        fxRateE6: 998_000,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("allow");
  });

  it("does not name market.fx_fresh when the speaker is not quoting a window", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("allow");
  });

  it("still names market.fx_window first when the window object is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: true,
        fxWindowOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_window");
  });

  it("still names market.fx_pair first when the pair is wrong", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: true,
        fxWindowOk: true,
        fxPairOk: false,
        fxMintFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_pair");
  });

  it("still names market.known_rfq first when the room is missing", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "market_maker", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: false,
        fxMintFresh: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
  });

  it("still names market.not_expired first when the RFQ is stale", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "market_maker", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: false,
        fxWindowOk: true,
        fxPairOk: true,
        fxMintFresh: false,
        fxRateE6: 998_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.not_expired");
  });

  it("still names mm.spread_bound first when the nested rate is off-band", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "market_maker", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: true,
        marketFresh: true,
        fxWindowOk: true,
        fxPairOk: true,
        fxMintFresh: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mm.spread_bound");
  });

  it("does not escalate velocity.window on release after a hot settle hour", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.release",
        hire: hire({ state: "delivered" }),
        velocity: { windowSeconds: 3600, count: 21, volume: 0 },
      }),
    );
    expect(d.verdict).not.toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.message).toBe("not a spend");
  });

  it("does not escalate velocity.window on refund, submit, require, or deliver after a hot settle hour", () => {
    for (const commandType of ["hire.refund", "envelope.submit", "envelope.require", "hire.deliver"] as const) {
      const d = evaluate(
        ctx({
          commandType,
          hire: hire({ state: commandType === "hire.refund" ? "funded" : "delivered" }),
          velocity: { windowSeconds: 3600, count: 21, volume: 0 },
        }),
      );
      expect(d.trace.find((t) => t.ruleId === "velocity.window")?.verdict).toBe("allow");
    }
  });

  it("still escalates a new hire after a hot settle hour as velocity.window", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 80_000, currency: "USD_SIM" },
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]),
        velocity: { windowSeconds: 3600, count: 21, volume: 0 },
      }),
    );
    expect(d.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "approval.threshold")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("velocity.window");
    expect(remediationFor(d)?.kind).toBe("wait_approval");
  });

  it("still escalates fund after a hot settle hour as velocity.window", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.fund",
        hire: hire({ state: "accepted" }),
        cart: signedCart(),
        payment: signedPayment(),
        intent: signedIntent([]),
        amount: { amount: 80_000, currency: "USD_SIM" },
        velocity: { windowSeconds: 3600, count: 21, volume: 0 },
      }),
    );
    expect(d.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("velocity.window");
  });

  it("still escalates an FX settle after a hot settle hour as velocity.window", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "market_maker", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        velocity: { windowSeconds: 3600, count: 21, volume: 0 },
      }),
    );
    expect(d.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.verdict).toBe("escalate");
    expect(remediationFor(d)?.ruleId).toBe("velocity.window");
  });

  it("does not escalate a catalog read after a hot settle hour", () => {
    const d = evaluate(
      ctx({
        commandType: "market.catalog",
        velocity: { windowSeconds: 3600, count: 21, volume: 0 },
      }),
    );
    expect(d.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.message).toBe("not a spend");
  });

  it("counts spend at fund so a second fund of an already-funded hire is not a velocity event", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.fund",
        hire: hire({ state: "funded" }),
        cart: signedCart(),
        payment: signedPayment(),
        intent: signedIntent([]),
        amount: { amount: 80_000, currency: "USD_SIM" },
        velocity: { windowSeconds: 3600, count: 21, volume: 0 },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.message).toBe("spend counted at fund");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
  });

  it("still escalates a new hire when the hour is over the volume cap", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 80_000, currency: "USD_SIM" },
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]),
        velocity: { windowSeconds: 3600, count: 0, volume: 2_000_001 },
      }),
    );
    expect(d.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "velocity.window")?.verdict).toBe("escalate");
    expect(remediationFor(d)?.ruleId).toBe("velocity.window");
  });

  it("denies subscribe on the public kernel as host.not_hosted", () => {
    const d = evaluate(ctx({ commandType: "host.subscribe", hostedOk: false }));
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "host.not_hosted")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("host.not_hosted");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name host.not_hosted on a hosted operator", () => {
    const d = evaluate(ctx({ commandType: "host.subscribe", hostedOk: true }));
    expect(d.trace.find((t) => t.ruleId === "host.not_hosted")?.verdict).toBe("allow");
  });

  it("does not name host.not_hosted when the speaker is not subscribing", () => {
    const d = evaluate(ctx({ commandType: "host.card" }));
    expect(d.trace.find((t) => t.ruleId === "host.not_hosted")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "host.not_hosted")?.message).toBe("not a host subscribe");
  });

  it("allows system to read the host card", () => {
    const d = evaluate(ctx({ commandType: "host.card", systemOk: true }));
    expect(d.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "host.not_hosted")?.verdict).toBe("allow");
  });

  it("denies hosted subscribe when the intent issuer is not human or treasury", () => {
    const d = evaluate(
      ctx({
        commandType: "host.subscribe",
        hostedOk: true,
        intentKnown: true,
        hostIssuerOk: false,
        subscribeUnique: true,
        intent: signedIntent([]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "host.human_authority")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("host.human_authority");
  });

  it("denies a second hosted subscribe for the same agent", () => {
    const d = evaluate(
      ctx({
        commandType: "host.subscribe",
        hostedOk: true,
        intentKnown: true,
        hostIssuerOk: true,
        subscribeUnique: false,
        intent: signedIntent([]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "host.unique_subscriber")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("host.unique_subscriber");
  });

  it("allows hosted subscribe when the issuer is human and the subscriber is free", () => {
    const d = evaluate(
      ctx({
        commandType: "host.subscribe",
        hostedOk: true,
        intentKnown: true,
        hostIssuerOk: true,
        subscribeUnique: true,
        intent: signedIntent([]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "host.human_authority")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "host.unique_subscriber")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "host.not_hosted")?.verdict).toBe("allow");
  });
});
