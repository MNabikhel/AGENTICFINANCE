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
  it("has 117 rules", () => {
    expect(RULE_IDS).toHaveLength(117);
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

  it("denies hire.create when the slip lists a ghost rail", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        payeeId: MERCHANT.id,
        amount: { amount: 80_000, currency: "USD_SIM" },
        intent: signedIntent([
          {
            type: "payment.allowed_payment_instruments",
            allowed: [{ id: "ghost-rail", type: "sim_ledger", description: "x" }],
          },
        ]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.allowed_payment_instruments")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "instrument.sim_only")?.verdict).toBe("allow");
  });

  it("allows hire.create when the slip lists the sim ledger", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        payeeId: MERCHANT.id,
        amount: { amount: 80_000, currency: "USD_SIM" },
        intent: signedIntent([
          {
            type: "payment.allowed_payment_instruments",
            allowed: [{ id: "sim-ledger", type: "sim_ledger", description: "sim" }],
          },
        ]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.allowed_payment_instruments")?.verdict).toBe("allow");
  });

  it("denies a child instrument list that is not a subset of the parent", () => {
    const parent = signedIntent([
      { type: "payment.amount_range", currency: "USD_SIM", max: 500000 },
      {
        type: "payment.allowed_payment_instruments",
        allowed: [{ id: "sim-ledger", type: "sim_ledger", description: "sim" }],
      },
    ]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 200000 }],
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
  });

  it("denies hire.create when a ghost citation misses a funded check", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        referenceOk: false,
        intent: signedIntent([{ type: "payment.reference", conditional_transaction_id: "f".repeat(64) }]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.reference")?.verdict).toBe("deny");
    const rem = remediationFor(d);
    expect(rem?.kind).toBe("issue_intent");
    expect(rem?.ruleId).toBe("payment.reference");
    expect(rem?.commandType).toBe("mandate.issue_intent");
  });

  it("allows hire.create with payment.reference when no prior funded payment exists", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.reference", conditional_transaction_id: "f".repeat(64) }]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.reference")?.verdict).toBe("allow");
  });

  it("allows hire.create when the citation matches a funded check", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        referenceOk: true,
        intent: signedIntent([{ type: "payment.reference", conditional_transaction_id: HASH }]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.reference")?.verdict).toBe("allow");
  });

  it("allows complete-after-fund even when the citation would miss", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.deliver",
        referenceOk: false,
        hire: hire({ state: "funded" }),
        intent: signedIntent([{ type: "payment.reference", conditional_transaction_id: "f".repeat(64) }]),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "payment.reference")?.verdict).toBe("allow");
  });

  it("denies a child that drops the parent's payment.reference", () => {
    const parent = signedIntent([
      { type: "payment.amount_range", currency: "USD_SIM", max: 500000 },
      { type: "payment.reference", conditional_transaction_id: HASH },
    ]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 200000 }],
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
  });

  it("denies a child that changes the parent's payment.reference", () => {
    const parent = signedIntent([
      { type: "payment.amount_range", currency: "USD_SIM", max: 500000 },
      { type: "payment.reference", conditional_transaction_id: HASH },
    ]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 200000 },
          { type: "payment.reference", conditional_transaction_id: "f".repeat(64) },
        ],
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
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

  it("denies spend when KYA depth exceeds max", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 4,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          grantedMaxAutonomy: 5,
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.delegation_depth")?.verdict).toBe("deny");
    expect(d.verdict).toBe("deny");
  });

  it("allows spend when KYA depth is at the max", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        kya: {
          required: true,
          pathOk: true,
          implicit: false,
          depth: 3,
          maxDepth: 3,
          principalFrozen: false,
          expired: false,
          revoked: false,
          hops: [],
          grantedMaxAutonomy: 5,
        },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.delegation_depth")?.verdict).toBe("allow");
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

  it("still names identity.known first when rotating a missing agent", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "identity.rotate",
        targetKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies rotating someone else's key as identity.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "identity.rotate",
        targetKnown: true,
        identityPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.not_frozen")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("identity.party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a desk rotating its own lock as identity.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "identity.rotate",
        targetKnown: true,
        identityPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "identity.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
  });

  it("still names market.known_rfq first when folding a missing quote", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.withdraw",
        rfqKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies folding someone else's bid as market.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "compute_vendor", autonomyLevel: 2 }),
        commandType: "market.withdraw",
        rfqKnown: true,
        marketFresh: true,
        quoteUnspent: true,
        marketPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a seller folding its own bid as market.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.withdraw",
        rfqKnown: true,
        marketFresh: true,
        quoteUnspent: true,
        marketPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
  });

  it("still names mandate.known_intent first when ripping a missing slip", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke",
        intentKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_intent");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies ripping someone else's unused slip as mandate.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke",
        intentKnown: true,
        intentWindowLive: true,
        mandatePartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows an issuer ripping its own unused slip as mandate.party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.revoke",
        intentKnown: true,
        intentWindowLive: true,
        mandatePartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
  });

  it("still names market.known_rfq first when shutting a missing room", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "market.close",
        rfqKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rfq_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies shutting someone else's room as market.rfq_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "market.close",
        rfqKnown: true,
        marketFresh: true,
        rfqPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rfq_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.rfq_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a buyer shutting its own room as market.rfq_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "market.close",
        rfqKnown: true,
        marketFresh: true,
        rfqPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.rfq_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
  });

  it("still names mandate.known_cart first when dumping a missing checkout", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_cart",
        cartKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.rfq_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_cart");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies dumping someone else's unused checkout as mandate.cart_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_cart",
        cartKnown: true,
        cartWindowLive: true,
        cartPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.cart_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a buyer dumping its own unused checkout as mandate.cart_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_cart",
        cartKnown: true,
        cartWindowLive: true,
        cartPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
  });

  it("still names mandate.known_payment first when spiking a missing check", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_payment",
        paymentKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_payment")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.payment_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.rfq_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_payment");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies spiking someone else's unused payment as mandate.payment_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_payment",
        paymentKnown: true,
        paymentWindowLive: true,
        paymentPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.payment_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_payment")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.payment_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a buyer spiking its own unused payment as mandate.payment_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_payment",
        paymentKnown: true,
        paymentWindowLive: true,
        paymentPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.payment_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_payment")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
  });

  it("denies hiring a ripped unused slip as mandate.not_expired", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        intentKnown: true,
        intentWindowLive: false,
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500000 }]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.not_expired");
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

  it("denies void of a funded hire as hire.state, not a missing party", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.void",
        hire: hire({ state: "funded" }),
        hireKnown: true,
        hirePartyOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.state");
  });

  it("allows void from offered", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.void",
        hire: hire({ state: "offered" }),
        hireKnown: true,
        hirePartyOk: true,
      }),
    );
    expect(d.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
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

  it("allows system to verify the notary", () => {
    const d = evaluate(ctx({ commandType: "audit.verify", systemOk: true }));
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

  it("denies L0/L1 envelope.submit without a human payment JWS as human.signature_present", () => {
    const human = agent({ role: "human_operator", autonomyLevel: 0, did: "did:aether:human" });
    const desk = agent({ autonomyLevel: 1, did: "did:aether:proc" });
    const d = evaluate(
      ctx({
        actor: desk,
        counterparties: [desk, human],
        commandType: "envelope.submit",
        payment: signedPayment(),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "human.signature_present")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("escalate");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("human.signature_present");
  });

  it("allows L2+ to self-sign envelope.submit", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 2 }),
        commandType: "envelope.submit",
        payment: signedPayment(),
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "human.signature_present")?.verdict).toBe("allow");
  });

  it("allows L1 envelope.submit when a human_operator signed the payment", () => {
    const human = agent({ role: "human_operator", autonomyLevel: 0, did: "did:aether:human" });
    const desk = agent({ autonomyLevel: 1, did: "did:aether:proc" });
    const d = evaluate(
      ctx({
        actor: desk,
        counterparties: [desk, human],
        commandType: "envelope.submit",
        payment: { ...signedPayment(), issuer: human.did },
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "human.signature_present")?.verdict).toBe("allow");
    expect(d.verdict).toBe("escalate");
  });

  it("does not let a waived ticket wink a junior signature", () => {
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 1 }),
        commandType: "envelope.submit",
        payment: signedPayment(),
        thresholdWaived: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "human.signature_present")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("human.signature_present");
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

  it("denies a week that cannot admit a second hire as mandate.cadence_reach", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        occurrenceMintOk: true,
        cadenceReachOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cadence_reach")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.window_reach")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.cadence_reach");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.cadence_reach when the next slot still opens while the slip lives", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        occurrenceMintOk: true,
        cadenceReachOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.cadence_reach")?.verdict).toBe("allow");
  });

  it("does not name mandate.cadence_reach when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.cadence_reach")?.verdict).toBe("allow");
  });

  it("still names mandate.occurrence_fresh first when a vacant cap also cannot admit a second hire", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        occurrenceMintOk: false,
        cadenceReachOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cadence_reach")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.occurrence_fresh");
  });

  it("denies a floor above the lid as mandate.range_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rangeMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.cadence_reach")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.range_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.range_fresh when the band can still admit an amount", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rangeMintOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.range_fresh when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("allow");
  });

  it("still names mandate.occurrence_fresh first when a vacant cap is also an inverted range", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        occurrenceMintOk: false,
        rangeMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.occurrence_fresh");
  });

  it("denies amount_range under min at hire, not as mandate.range_fresh", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 40000, currency: "USD_SIM" },
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", min: 50000, max: 500000 }]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("payment.amount_range");
  });

  it("denies a nested child whose floor is below the parent", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", min: 100000, max: 500000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", min: 0, max: 200000 }],
        rangeMintOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_tighter");
  });

  it("denies a closed coffer as mandate.budget_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        budgetMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "payment.budget")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.budget_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.budget_fresh when the coffer can still admit an amount", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        budgetMintOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.budget_fresh when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("allow");
  });

  it("still names mandate.range_fresh first when an inverted range is also a closed coffer", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rangeMintOk: false,
        budgetMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.range_fresh");
  });

  it("still names mandate.occurrence_fresh first when a vacant cap is also a closed coffer", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        occurrenceMintOk: false,
        budgetMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.occurrence_fresh");
  });

  it("denies budget exhausted at hire, not as mandate.budget_fresh", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 40000, currency: "USD_SIM" },
        spentAgainstIntent: 80000,
        intent: signedIntent([{ type: "payment.budget", currency: "USD_SIM", max: 100000 }]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.budget")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("payment.budget");
  });

  it("denies a nested child whose coffer is closed as mandate.budget_fresh, not child_tighter", () => {
    const parent = signedIntent([{ type: "payment.budget", currency: "USD_SIM", max: 1000000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.budget", currency: "USD_SIM", max: 0 }],
        budgetMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.budget_fresh");
  });

  it("denies mixed lid and coffer currencies as mandate.currency_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        currencyMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "payment.currency_match")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.currency_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.currency_fresh when lid and coffer name the same currency", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        currencyMintOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.currency_fresh when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("allow");
  });

  it("still names mandate.range_fresh first when an inverted range is also a mixed envelope", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rangeMintOk: false,
        currencyMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.range_fresh");
  });

  it("still names mandate.budget_fresh first when a closed coffer is also a mixed envelope", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        budgetMintOk: false,
        currencyMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.budget_fresh");
  });

  it("denies cart vs hire currency at hire, not as mandate.currency_fresh", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.fund",
        amount: { amount: 80_000, currency: "USD_SIM" },
        cart: signedCart({ total: { amount: 80_000, currency: "USDC_SIM" } }),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.currency_match")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("payment.currency_match");
  });

  it("denies a nested child whose lid and coffer clash as mandate.currency_fresh, not child_tighter", () => {
    const parent = signedIntent([
      { type: "payment.amount_range", currency: "USD_SIM", max: 500000 },
      { type: "payment.budget", currency: "USD_SIM", max: 1000000 },
    ]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500000 },
          { type: "payment.budget", currency: "USDC_SIM", max: 1000000 },
        ],
        currencyMintOk: false,
        childCurrencyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.currency_fresh");
  });

  it("denies a closed hatch as mandate.lid_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        lidMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.lid_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.lid_fresh when the lid can still admit a positive hire", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        lidMintOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.lid_fresh when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("allow");
  });

  it("still names mandate.range_fresh first when an inverted range is also a closed hatch", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rangeMintOk: false,
        lidMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.range_fresh");
  });

  it("still names mandate.budget_fresh first when a closed coffer is also a closed hatch", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        budgetMintOk: false,
        lidMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.budget_fresh");
  });

  it("still names mandate.currency_fresh first when a mixed envelope is also a closed hatch", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        currencyMintOk: false,
        lidMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.currency_fresh");
  });

  it("denies amount_range over max at hire, not as mandate.lid_fresh", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 640000, currency: "USD_SIM" },
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500000 }]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("payment.amount_range");
  });

  it("denies a nested child whose hatch is closed as mandate.lid_fresh, not child_tighter", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 0 }],
        lidMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.lid_fresh");
  });

  it("denies a cap below the desk as mandate.cap_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        capMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ladder.max_autonomy_constraint")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.cap_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.cap_fresh when the subject's live rung is at or below the cap", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        capMintOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("allow");
  });

  it("does not name mandate.cap_fresh when the speaker is not minting a slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("allow");
  });

  it("still names mandate.lid_fresh first when a closed hatch is also a cap below the desk", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        lidMintOk: false,
        capMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.lid_fresh");
  });

  it("denies a climb above the slip ceiling at hire, not as mandate.cap_fresh", () => {
    const d = evaluate(
      ctx({
        commandType: "hire.create",
        amount: { amount: 80000, currency: "USD_SIM" },
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        intent: signedIntent([{ type: "aether.max_autonomy", max: 3 }]),
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.max_autonomy_constraint")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("ladder.max_autonomy_constraint");
  });

  it("denies a nested child whose cap is below the desk as mandate.cap_fresh, not child_tighter", () => {
    const parent = signedIntent([{ type: "aether.max_autonomy", max: 5 }]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "aether.max_autonomy", max: 2 }],
        capMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.cap_fresh");
  });

  it("still names mandate.child_tighter first when a nested child cap is wider than the parent", () => {
    const parent = signedIntent([{ type: "aether.max_autonomy", max: 2 }]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "aether.max_autonomy", max: 5 }],
        capMintOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_tighter");
  });

  it("still names identity.known first when a ghost subject is also a cap below the desk", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: false,
        capMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
  });

  it("denies a grant below the desk as kya.grant_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.grant_fresh");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.grant_fresh when the delegate's live rung is at or below the grant", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
  });

  it("does not name kya.grant_fresh when the speaker is not attesting", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
  });

  it("still names kya.unique_live first when a second hop is also a grant below the desk", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
        kyaMintFresh: true,
        grantMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
  });

  it("still names kya.mint_fresh first when a corpse is also a grant below the desk", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: false,
        grantMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.mint_fresh");
  });

  it("still names kya.mint_window first when a century mint is also a grant below the desk", () => {
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
        grantMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.mint_window");
  });

  it("denies a climb above the handshake at hire, not as kya.grant_fresh", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "hire.create",
        intent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        grantMintOk: true,
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
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.capability_subset");
  });

  it("still names kya.capability_subset first when an L4 over-grant is also a grant below the desk", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: false,
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
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.capability_subset");
  });

  it("still names identity.known first when a ghost delegate is also a grant below the desk", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: false,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
  });

  it("denies a nested grant wider than its parent as kya.nest_tighter", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.nest_tighter");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.nest_tighter when the nested grant is at or below the parent hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        nestTighterOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
  });

  it("does not name kya.nest_tighter when the speaker is not attesting", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
  });

  it("still names kya.grant_fresh first when a nested grant is also below the desk", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: false,
        nestTighterOk: true,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.grant_fresh");
  });

  it("still names kya.parent_fresh first when a dead parent is also a wider nested grant", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: false,
        grantMintOk: true,
        nestTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.parent_fresh");
  });

  it("still names kya.known_parent first when a ghost parent is also a wider nested grant", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: false,
        grantMintOk: true,
        nestTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.known_parent");
  });

  it("still names kya.unique_live first when a second hop is also a wider nested grant", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
  });

  it("still names kya.capability_subset first when an agent over-grant is also a wider nested grant", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: false,
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
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.capability_subset");
  });

  it("still names mandate.child_tighter first when a wider nested slip is also a wider nested hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentIntent: signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }]),
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 200_000 }],
        nestTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_tighter");
  });

  it("denies a grant wider than the incoming hop as kya.path_tighter", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: true,
        pathTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.path_tighter");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.path_tighter when the path grant is at or below the incoming hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        pathTighterOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
  });

  it("does not name kya.path_tighter when the speaker is not attesting", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
  });

  it("still names kya.nest_tighter first when a nested grant is also wider than the incoming hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: false,
        pathTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.nest_tighter");
  });

  it("still names kya.grant_fresh first when a grant below the desk is also wider than the incoming hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: false,
        pathTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.grant_fresh");
  });

  it("still names kya.unique_live first when a second hop is also wider than the incoming hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
        kyaMintFresh: true,
        grantMintOk: true,
        pathTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
  });

  it("still names kya.capability_subset first when an agent over-grant is also wider than the incoming hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: true,
        pathTighterOk: false,
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
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.capability_subset");
  });

  it("denies an orphan hop as kya.path_live", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: true,
        pathLiveOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.path_live");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.path_live when the speaker has a live incoming hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        pathTighterOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
  });

  it("does not name kya.path_live when the speaker is not attesting", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
  });

  it("still names kya.path_tighter first when a wider path grant also has a live incoming hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: true,
        pathTighterOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.path_tighter");
  });

  it("still names kya.party first when an agent filling in another principal is also an orphan hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: false,
        kyaLiveFree: true,
        kyaMintFresh: true,
        grantMintOk: true,
        pathLiveOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.party");
  });

  it("still names kya.unique_live first when a second hop is also an orphan hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
        kyaMintFresh: true,
        grantMintOk: true,
        pathLiveOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
  });

  it("still names identity.known first when a ghost principal is also an orphan hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: false,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        pathLiveOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
  });

  it("denies a nested child in a different currency as mandate.child_currency", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        childCurrencyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.currency_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.range_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.budget_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "payment.currency_match")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_currency");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name mandate.child_currency when nested currencies match the parent", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        childCurrencyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("allow");
  });

  it("does not name mandate.child_currency when the speaker is not minting a nested slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("allow");
  });

  it("still names mandate.child_tighter first when a nested child is also wider than the parent", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 100000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USDC_SIM", max: 500000 }],
        childCurrencyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_tighter");
  });

  it("still names mandate.known_parent first when a ghost parent is also a nested currency mint", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: false,
        childCurrencyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_parent");
  });

  it("still names mandate.parent_fresh first when a dead parent is also a nested currency mint", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: false,
        childCurrencyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.parent_fresh");
  });

  it("still names mandate.lid_fresh first when a nested child's hatch is also closed", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        lidMintOk: false,
        childCurrencyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.lid_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.lid_fresh");
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

  it("denies quoting an FX conversion that pays nothing as market.payout_fresh", () => {
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
        fxPayoutOk: false,
        fxRateE6: 980_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.payout_fresh");
  });

  it("does not name market.payout_fresh when the floor payout is positive", () => {
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
        fxPayoutOk: true,
        fxRateE6: 980_000,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("allow");
  });

  it("does not name market.payout_fresh when the speaker is not quoting a window", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("allow");
  });

  it("still names mm.spread_bound first when the nested rate is off-band and payout is zero", () => {
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
        fxPayoutOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mm.spread_bound");
  });

  it("still names market.fx_fresh first when the window is already closed and payout is zero", () => {
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
        fxPayoutOk: false,
        fxRateE6: 980_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_fresh");
  });

  it("still names market.fx_pair first when the pair is wrong and payout is zero", () => {
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
        fxPairOk: false,
        fxMintFresh: true,
        fxPayoutOk: false,
        fxRateE6: 980_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_pair");
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
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_window");
  });

  it("still names market.known_rfq first when the room is missing and payout is zero", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "market_maker", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: false,
        fxMintFresh: true,
        fxPayoutOk: false,
        fxRateE6: 980_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
  });

  it("denies quoting an FX window as a vendor while a maker sits as market.fx_party", () => {
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
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: false,
        fxBandOk: true,
        fxRateE6: 998_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_party");
  });

  it("does not name market.fx_party when the market maker quotes", () => {
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
        fxPayoutOk: true,
        fxPartyOk: true,
        fxRateE6: 998_000,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("allow");
  });

  it("does not name market.fx_party when the speaker is not quoting a window", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("allow");
  });

  it("does not name market.fx_party when no maker sits", () => {
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
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: true,
        fxRateE6: 998_000,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("allow");
  });

  it("still names market.invited_seller first when the vendor is not invited", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: false,
        marketFresh: true,
        fxWindowOk: true,
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: false,
        fxRateE6: 998_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.invited_seller");
  });

  it("still names mm.spread_bound first when the maker is off-band", () => {
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
        fxPayoutOk: true,
        fxPartyOk: true,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mm.spread_bound");
  });

  it("still names market.payout_fresh first when a vendor conversion pays nothing", () => {
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
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: false,
        fxPartyOk: false,
        fxRateE6: 980_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.payout_fresh");
  });

  it("still names market.fx_fresh first when a vendor quotes a dead window", () => {
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
        fxPairOk: true,
        fxMintFresh: false,
        fxPayoutOk: true,
        fxPartyOk: false,
        fxRateE6: 998_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_fresh");
  });

  it("still names market.fx_pair first when a vendor quotes a swapped pair", () => {
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
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: false,
        fxRateE6: 998_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_pair");
  });

  it("still names market.fx_window first when an FX SKU has no window", () => {
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
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_window");
  });

  it("still names market.known_rfq first when the RFQ is a ghost", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: false,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: false,
        fxRateE6: 998_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
  });

  it("denies quoting an off-band FX window with no maker as market.rate_fresh", () => {
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
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: true,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.kind).toBe("none");
    expect(remediationFor(d)?.ruleId).toBe("market.rate_fresh");
  });

  it("does not name market.rate_fresh when the nested rate is in band", () => {
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
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: true,
        fxBandOk: true,
        fxRateE6: 998_000,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("allow");
  });

  it("does not name market.rate_fresh when the speaker is not quoting a window", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("allow");
  });

  it("still names mm.spread_bound first when the maker is off-band and the band flag is also false", () => {
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
        fxPayoutOk: true,
        fxPartyOk: true,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mm.spread_bound");
  });

  it("still names market.fx_party first when a vendor is off-band while a maker sits", () => {
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
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: false,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_party");
  });

  it("still names market.payout_fresh first when a vendor conversion pays nothing off-band", () => {
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
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: false,
        fxPartyOk: true,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.payout_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.payout_fresh");
  });

  it("still names market.fx_fresh first when a vendor quotes a dead off-band window", () => {
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
        fxPairOk: true,
        fxMintFresh: false,
        fxPayoutOk: true,
        fxPartyOk: true,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_fresh");
  });

  it("still names market.fx_pair first when a vendor quotes a swapped pair off-band", () => {
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
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: true,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_pair");
  });

  it("still names market.fx_window first when an FX SKU has no window and the band is unset", () => {
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
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_window");
  });

  it("still names market.known_rfq first when the RFQ is a ghost and the rate is off-band", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: false,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: true,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
  });

  it("still names market.invited_seller first when the vendor is not invited and off-band", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.quote",
        rfqKnown: true,
        skuListed: true,
        skuCurrencyOk: true,
        sellerInvited: false,
        marketFresh: true,
        fxWindowOk: true,
        fxPairOk: true,
        fxMintFresh: true,
        fxPayoutOk: true,
        fxPartyOk: true,
        fxBandOk: false,
        fxRateE6: 500_000,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.rate_fresh")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.invited_seller");
  });

  it("denies a nested hop under another principal as kya.nest_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: true,
        nestPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("kya.nest_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("does not name kya.nest_party when the nested hop names the parent's principal", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: true,
        nestPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("allow");
  });

  it("does not name kya.nest_party when the speaker is not nesting", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("allow");
  });

  it("still names kya.nest_tighter first when a nested grant is also under another principal", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: false,
        nestPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.nest_tighter");
  });

  it("still names kya.grant_fresh first when a nested hop under another principal is also below the desk", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: false,
        nestTighterOk: true,
        nestPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.grant_fresh");
  });

  it("still names kya.parent_fresh first when a dead parent is also under another principal", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: false,
        nestPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.parent_fresh");
  });

  it("still names kya.known_parent first when a ghost parent is also under another principal", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: false,
        nestPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.known_parent");
  });

  it("still names kya.path_live first when an orphan hop is also nested under another principal", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: true,
        pathLiveOk: false,
        nestPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.path_live");
  });

  it("still names kya.unique_live first when a second hop is also nested under another principal", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: true,
        kyaLiveFree: false,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: true,
        nestPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.unique_live");
  });

  it("still names kya.party first when an agent fills in another principal and also nests under a foreign hop", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "kya.attest",
        targetKnown: true,
        kyaNotSelf: true,
        kyaPartyOk: false,
        kyaLiveFree: true,
        kyaMintFresh: true,
        kyaParentKnown: true,
        kyaParentFresh: true,
        grantMintOk: true,
        nestTighterOk: true,
        nestPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "kya.nest_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("kya.party");
  });

  it("denies filling someone else's checkout as mandate.checkout_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.issue_cart",
        hireKnown: true,
        intentKnown: true,
        cartMatchesHire: true,
        cartUnbound: true,
        checkoutPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.unique_cart")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.cart_matches")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.payment_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.checkout_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("denies filling someone else's payment as mandate.checkout_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.issue_payment",
        cartKnown: true,
        paymentUnbound: true,
        checkoutPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.payment_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.checkout_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a buyer filling its own checkout as mandate.checkout_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.issue_cart",
        hireKnown: true,
        intentKnown: true,
        cartMatchesHire: true,
        cartUnbound: true,
        checkoutPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
  });

  it("allows a human filling a checkout as mandate.checkout_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_cart",
        hireKnown: true,
        intentKnown: true,
        cartMatchesHire: true,
        cartUnbound: true,
        checkoutPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
  });

  it("does not name mandate.checkout_party when the speaker is not minting a checkout", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
  });

  it("does not name mandate.checkout_party on dump or spike", () => {
    const dump = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_cart",
        cartKnown: true,
        cartWindowLive: true,
        cartPartyOk: true,
      }),
    );
    expect(dump.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
    const spike = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_payment",
        paymentKnown: true,
        paymentWindowLive: true,
        paymentPartyOk: true,
      }),
    );
    expect(spike.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
  });

  it("still names hire.unique_cart first when a second cart is also someone else's checkout", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.issue_cart",
        hireKnown: true,
        intentKnown: true,
        cartMatchesHire: true,
        cartUnbound: false,
        checkoutPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.unique_cart")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("hire.unique_cart");
  });

  it("still names mandate.known_cart first when filling a missing cart", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.issue_payment",
        cartKnown: false,
        checkoutPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_cart");
  });

  it("still names hire.cart_matches first when a cheaper cart is also someone else's checkout", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.issue_cart",
        hireKnown: true,
        intentKnown: true,
        cartMatchesHire: false,
        cartUnbound: true,
        checkoutPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.cart_matches")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("hire.cart_matches");
  });

  it("still names mandate.cart_party first when dumping someone else's unused checkout", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_cart",
        cartKnown: true,
        cartWindowLive: true,
        cartPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.cart_party");
  });

  it("still names mandate.payment_party first when spiking someone else's unused payment", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke_payment",
        paymentKnown: true,
        paymentWindowLive: true,
        paymentPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.payment_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.payment_party");
  });

  it("still names hire.known first when filling a missing hire", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.issue_cart",
        hireKnown: false,
        intentKnown: true,
        checkoutPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("hire.known");
  });

  it("still names mandate.unique_payment first when a second payment is also someone else's checkout", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.issue_payment",
        cartKnown: true,
        paymentUnbound: false,
        checkoutPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.unique_payment");
  });

  it("denies hiring from someone else's room as hire.room_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.no_self_deal")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.rfq_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.subject_is_actor")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.room_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a buyer hiring from its own room as hire.room_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
  });

  it("allows a human hiring from a room as hire.room_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
  });

  it("does not name hire.room_party when the speaker is not hiring", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
  });

  it("does not name hire.room_party on shut or fold", () => {
    const shut = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "market.close",
        rfqKnown: true,
        marketFresh: true,
        rfqPartyOk: true,
      }),
    );
    expect(shut.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
    const fold = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.withdraw",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        marketPartyOk: true,
      }),
    );
    expect(fold.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
  });

  it("still names market.known_rfq first when hiring a missing quote from someone else's room", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: false,
        hireRoomPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.known_rfq");
  });

  it("still names hire.quote_unspent first when a spent quote is also someone else's room", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: false,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("hire.quote_unspent");
  });

  it("still names market.not_expired first when a shut room is also someone else's hire", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: false,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("market.not_expired");
  });

  it("still names hire.not_fx first when an FX window is also someone else's room", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: false,
        intentKnown: true,
        hireRoomPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("hire.not_fx");
  });

  it("denies hiring against someone else's unused slip as hire.slip_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: true,
        hireSlipPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.no_self_deal")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.subject_is_actor")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("hire.slip_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a subject hiring against its own unused slip as hire.slip_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: true,
        hireSlipPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
  });

  it("allows a human hiring against a slip as hire.slip_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: true,
        hireSlipPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
  });

  it("does not name hire.slip_party when the speaker is not hiring", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
  });

  it("does not name hire.slip_party on rip or fund", () => {
    const rip = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "mandate.revoke",
        intentKnown: true,
        mandatePartyOk: true,
      }),
    );
    expect(rip.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
    const fund = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.fund",
        intent: signedIntent([]),
      }),
    );
    expect(fund.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
  });

  it("still names mandate.known_intent first when a ghost slip would also be a guise", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: false,
        hireRoomPartyOk: true,
        hireSlipPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_intent");
  });

  it("still names hire.room_party first when a foreign room would also wear a foreign slip", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3 }),
        commandType: "hire.create",
        rfqKnown: true,
        quoteUnspent: true,
        marketFresh: true,
        hireNotFx: true,
        intentKnown: true,
        hireRoomPartyOk: false,
        hireSlipPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("hire.room_party");
  });

  it("denies nesting under someone else's parent as mandate.child_party", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_other" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: true,
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        childPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a parent subject nesting a tighter child as mandate.child_party", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: true,
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        childPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
  });

  it("allows a human nesting under a desk parent as mandate.child_party", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: true,
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        childPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
  });

  it("does not name mandate.child_party when the speaker is not minting a nested slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
  });

  it("still names mandate.known_parent first when a ghost parent would also be a cuckoo", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_other" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.known_parent");
  });

  it("still names mandate.parent_fresh first when a dead parent would also be a cuckoo", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_other" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: false,
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        childPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.parent_fresh");
  });

  it("still names mandate.child_tighter first when a wider child would also be a cuckoo", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_other" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: true,
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 600_000 }],
        childPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_tighter");
  });

  it("still names ladder.min_level first when a junior nest would also be a cuckoo", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3, id: "aid_scout" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: true,
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        childPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("ladder.min_level");
  });

  it("still names mandate.child_currency first when a mixed child would also be a cuckoo", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_other" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: true,
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USDC_SIM", max: 100_000 }],
        childCurrencyOk: false,
        childPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_currency")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_currency");
  });

  it("denies minting a root in someone else's name as mandate.root_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_other" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rootPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.root_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a named subject minting a self-root as mandate.root_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rootPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
  });

  it("allows a human minting a root for a desk as mandate.root_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "human_operator", autonomyLevel: 0 }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rootPartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
  });

  it("does not name mandate.root_party when the speaker is not minting a root slip", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
  });

  it("still names identity.known first when a ghost subject would also be a forge", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_other" }),
        commandType: "mandate.issue_intent",
        targetKnown: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("identity.known");
  });

  it("still names mandate.child_party first when a nested foreign child would also be a forge", () => {
    const parent = signedIntent([{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }]);
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_other" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        parentKnown: true,
        parentFresh: true,
        parentIntent: parent,
        proposedConstraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        childPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("mandate.child_party");
  });

  it("still names ladder.min_level first when a junior foreign root would also be a forge", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 3, id: "aid_scout" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rootPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("ladder.min_level");
  });

  it("still names actor.role_capability first when a vendor foreign root would also be a forge", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2, id: "aid_vendor" }),
        commandType: "mandate.issue_intent",
        targetKnown: true,
        rootPartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("actor.role_capability");
  });

  it("denies settling someone else's vendor window as market.settle_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2, id: "aid_other" }),
        commandType: "market.fx_settle",
        settlePartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.settle_party")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.settle_party");
    expect(remediationFor(d)?.kind).toBe("none");
  });

  it("allows a vendor settling its own window as market.settle_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        settlePartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.settle_party")?.verdict).toBe("allow");
  });

  it("allows a vendor settling a maker window as market.settle_party", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2 }),
        commandType: "market.fx_settle",
        settlePartyOk: true,
      }),
    );
    expect(d.trace.find((t) => t.ruleId === "market.settle_party")?.verdict).toBe("allow");
  });

  it("does not name market.settle_party when the speaker is not settling FX", () => {
    const d = evaluate(ctx({ commandType: "ledger.balances" }));
    expect(d.trace.find((t) => t.ruleId === "market.settle_party")?.verdict).toBe("allow");
  });

  it("still names market.fx_quote first when a ghost quote would also be a snare", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2, id: "aid_other" }),
        commandType: "market.fx_settle",
        fxQuoteLive: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.settle_party")?.verdict).toBe("allow");
    expect(remediationFor(d)?.ruleId).toBe("market.fx_quote");
  });

  it("still names mm.known first when an empty pit would also be a snare", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "data_vendor", autonomyLevel: 2, id: "aid_other" }),
        commandType: "market.fx_settle",
        fxQuoteLive: true,
        mmKnown: false,
        settlePartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.settle_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("mm.known");
  });

  it("still names ledger.known_account first when a missing dest book would also be a snare", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "compute_vendor", autonomyLevel: 2, id: "aid_compute" }),
        commandType: "market.fx_settle",
        fxQuoteLive: true,
        mmKnown: true,
        accountsKnown: false,
        settlePartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.settle_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("ledger.known_account");
  });

  it("still names actor.role_capability first when a desk settle would also be a snare", () => {
    const d = evaluate(
      ctx({
        actor: agent({ role: "procurement", autonomyLevel: 4, id: "aid_desk" }),
        commandType: "market.fx_settle",
        fxQuoteLive: true,
        mmKnown: true,
        accountsKnown: true,
        settlePartyOk: false,
      }),
    );
    expect(d.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("deny");
    expect(d.trace.find((t) => t.ruleId === "market.settle_party")?.verdict).toBe("deny");
    expect(remediationFor(d)?.ruleId).toBe("actor.role_capability");
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
