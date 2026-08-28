/**
 * Deterministic policy engine. No I/O. No LLM.
 * Aggregation: any deny → deny; else any escalate → escalate; else allow.
 * Every rule always runs so the trace is a complete audit artifact.
 */

import {
  DEFAULT_APPROVAL_THRESHOLDS,
  MIN_LEVEL_FOR_ACTION,
  MM_RATE_BAND_E6,
  ROLE_CAPABILITY,
  VELOCITY_CAPS,
  type AutonomyLevel,
  type CommandType,
  type MandateConstraint,
  type PolicyContext,
  type PolicyDecision,
  type Remediation,
  type RuleVerdict,
  type Verdict,
} from "@aether/types";

export type Rule = {
  id: string;
  evaluate(ctx: PolicyContext): RuleVerdict;
};

function v(ruleId: string, verdict: Verdict, message: string, evidence?: Record<string, unknown>): RuleVerdict {
  return evidence ? { ruleId, verdict, message, evidence } : { ruleId, verdict, message };
}

function constraintsOf(ctx: PolicyContext): MandateConstraint[] {
  return ctx.intent?.payload.constraints ?? [];
}

function findConstraint<T extends MandateConstraint["type"]>(
  ctx: PolicyContext,
  type: T,
): Extract<MandateConstraint, { type: T }> | undefined {
  return constraintsOf(ctx).find((c): c is Extract<MandateConstraint, { type: T }> => c.type === type);
}

function listed<T extends MandateConstraint["type"]>(
  list: MandateConstraint[] | undefined,
  type: T,
): Extract<MandateConstraint, { type: T }> | undefined {
  return list?.find((c): c is Extract<MandateConstraint, { type: T }> => c.type === type);
}

function minLevelFor(ctx: PolicyContext): AutonomyLevel {
  const commandType = ctx.commandType;
  if (commandType === "mandate.issue_intent" || commandType === "kya.attest" || commandType === "kya.revoke") {
    if (ctx.actor.role === "human_operator" || ctx.actor.role === "treasury") {
      return MIN_LEVEL_FOR_ACTION.draft;
    }
    return MIN_LEVEL_FOR_ACTION.issueSubIntent;
  }
  if (commandType === "hire.create" || commandType === "hire.refund") {
    return MIN_LEVEL_FOR_ACTION.hireAgainstIntent;
  }
  if (commandType === "envelope.submit" || commandType === "hire.fund" || commandType === "hire.release") {
    return MIN_LEVEL_FOR_ACTION.closePaymentAutonomous;
  }
  return MIN_LEVEL_FOR_ACTION.draft;
}

const ESCALATABLE = new Set<CommandType>([
  "envelope.submit",
  "hire.create",
  "hire.fund",
  "hire.release",
]);

export const RULES: readonly Rule[] = [
  {
    id: "actor.not_frozen",
    evaluate: (ctx) =>
      ctx.actor.frozen
        ? v("actor.not_frozen", "deny", "actor is frozen")
        : v("actor.not_frozen", "allow", "actor not frozen"),
  },
  {
    id: "actor.role_capability",
    evaluate: (ctx) => {
      const allowed = ROLE_CAPABILITY[ctx.actor.role];
      const cmd = ctx.commandType as CommandType;
      return allowed.includes(cmd)
        ? v("actor.role_capability", "allow", `${ctx.actor.role} may ${cmd}`)
        : v("actor.role_capability", "deny", `${ctx.actor.role} cannot ${cmd}`);
    },
  },
  {
    id: "mandate.chain_integrity",
    evaluate: (ctx) => {
      if (!ctx.payment || !ctx.cart || !ctx.intent) {
        if (ctx.commandType === "envelope.submit" || ctx.commandType === "hire.fund") {
          return v("mandate.chain_integrity", "deny", "settle requires intent+cart+payment");
        }
        return v("mandate.chain_integrity", "allow", "no chain required");
      }
      if (ctx.chainOk === false) {
        return v("mandate.chain_integrity", "deny", "verifyChain failed");
      }
      if (ctx.cart.payload.intentId !== ctx.intent.payload.id) {
        return v("mandate.chain_integrity", "deny", "cart.intentId !== intent.id");
      }
      if (ctx.payment.payload.payee.id !== ctx.cart.payload.merchant.id) {
        return v("mandate.chain_integrity", "deny", "payee !== cart merchant");
      }
      const pay = ctx.payment.payload.payment_amount;
      const tot = ctx.cart.payload.total;
      if (pay.amount !== tot.amount || pay.currency !== tot.currency) {
        return v("mandate.chain_integrity", "deny", "payment_amount !== cart.total");
      }
      return v("mandate.chain_integrity", "allow", "chain fields consistent (hashes checked in mandate package)");
    },
  },
  {
    id: "mandate.not_expired",
    evaluate: (ctx) => {
      const nowSec = Math.floor(Date.parse(ctx.clock) / 1000);
      if (ctx.intent && ctx.intent.payload.exp <= nowSec) {
        return v("mandate.not_expired", "deny", "intent expired");
      }
      if (ctx.payment && ctx.payment.payload.exp <= nowSec) {
        return v("mandate.not_expired", "deny", "payment expired");
      }
      if (ctx.cart && Date.parse(ctx.cart.payload.expiresAt) <= Date.parse(ctx.clock)) {
        return v("mandate.not_expired", "deny", "cart expired");
      }
      return v("mandate.not_expired", "allow", "mandates in window");
    },
  },
  {
    id: "mandate.subject_is_actor",
    evaluate: (ctx) => {
      if (!ctx.intent) return v("mandate.subject_is_actor", "allow", "no intent");
      if (ctx.commandType !== "envelope.submit" && ctx.commandType !== "hire.fund") {
        return v("mandate.subject_is_actor", "allow", "not a settle");
      }
      return ctx.intent.payload.subjectId === ctx.actor.id
        ? v("mandate.subject_is_actor", "allow", "actor is intent subject")
        : v("mandate.subject_is_actor", "deny", "actor is not intent subject");
    },
  },
  {
    id: "payment.currency_match",
    evaluate: (ctx) => {
      if (!ctx.amount) return v("payment.currency_match", "allow", "no amount");
      if (ctx.cart && ctx.cart.payload.total.currency !== ctx.amount.currency) {
        return v("payment.currency_match", "deny", "cart currency mismatch");
      }
      if (ctx.payment && ctx.payment.payload.payment_amount.currency !== ctx.amount.currency) {
        return v("payment.currency_match", "deny", "payment currency mismatch");
      }
      return v("payment.currency_match", "allow", "currencies match");
    },
  },
  {
    id: "payment.amount_range",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "payment.amount_range");
      if (!c || !ctx.amount) return v("payment.amount_range", "allow", "no range constraint");
      if (ctx.amount.currency !== c.currency) {
        return v("payment.amount_range", "deny", "currency != range currency", { currency: ctx.amount.currency });
      }
      if (c.min !== undefined && ctx.amount.amount < c.min) {
        return v("payment.amount_range", "deny", `amount ${ctx.amount.amount} < min ${c.min}`);
      }
      if (ctx.amount.amount > c.max) {
        return v("payment.amount_range", "deny", `amount ${ctx.amount.amount} > max ${c.max}`, {
          amount: ctx.amount.amount,
          max: c.max,
        });
      }
      return v("payment.amount_range", "allow", "amount in range");
    },
  },
  {
    id: "payment.budget",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "payment.budget");
      if (!c || !ctx.amount) return v("payment.budget", "allow", "no budget constraint");
      if (ctx.hire && (ctx.hire.state === "funded" || ctx.hire.state === "delivered" || ctx.hire.state === "released")) {
        return v("payment.budget", "allow", "budget reserved at fund");
      }
      if (ctx.amount.currency !== c.currency) {
        return v("payment.budget", "deny", "budget currency mismatch");
      }
      if (ctx.spentAgainstIntent + ctx.amount.amount > c.max) {
        return v("payment.budget", "deny", "budget exhausted", {
          spent: ctx.spentAgainstIntent,
          requested: ctx.amount.amount,
          max: c.max,
        });
      }
      return v("payment.budget", "allow", "budget remaining");
    },
  },
  {
    id: "payment.allowed_payees",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "payment.allowed_payees");
      if (!c || !ctx.payeeId) return v("payment.allowed_payees", "allow", "no payee constraint");
      return c.allowed.some((m) => m.id === ctx.payeeId)
        ? v("payment.allowed_payees", "allow", "payee listed")
        : v("payment.allowed_payees", "deny", "payee not in allow-list");
    },
  },
  {
    id: "payment.allowed_skus",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "aether.allowed_skus");
      const sku = ctx.hire?.sku;
      if (!c || !sku) return v("payment.allowed_skus", "allow", "no sku constraint");
      return c.allowed.includes(sku)
        ? v("payment.allowed_skus", "allow", "sku listed")
        : v("payment.allowed_skus", "deny", `sku ${sku} not listed`);
    },
  },
  {
    id: "payment.recurrence",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "payment.agent_recurrence");
      if (!c) return v("payment.recurrence", "allow", "no recurrence constraint");
      if (c.max_occurrences !== undefined && ctx.occurrenceCount >= c.max_occurrences) {
        return v("payment.recurrence", "deny", "max_occurrences exceeded");
      }
      return v("payment.recurrence", "allow", "recurrence ok");
    },
  },
  {
    id: "payment.execution_date",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "payment.execution_date");
      if (!c) return v("payment.execution_date", "allow", "no execution window");
      const now = Date.parse(ctx.clock);
      if (c.not_before && now < Date.parse(c.not_before)) {
        return v("payment.execution_date", "deny", "before not_before");
      }
      if (c.not_after && now > Date.parse(c.not_after)) {
        return v("payment.execution_date", "deny", "after not_after");
      }
      return v("payment.execution_date", "allow", "in execution window");
    },
  },
  {
    id: "ladder.min_level",
    evaluate: (ctx) => {
      const required = minLevelFor(ctx);
      if (ctx.actor.autonomyLevel >= required) {
        return v("ladder.min_level", "allow", `L${ctx.actor.autonomyLevel} >= L${required}`);
      }
      if (ESCALATABLE.has(ctx.commandType as CommandType) && ctx.actor.autonomyLevel >= 0) {
        return v("ladder.min_level", "escalate", `L${ctx.actor.autonomyLevel} < L${required}`, { required });
      }
      return v("ladder.min_level", "deny", `L${ctx.actor.autonomyLevel} < L${required}`);
    },
  },
  {
    id: "ladder.max_autonomy_constraint",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "aether.max_autonomy");
      if (!c) return v("ladder.max_autonomy_constraint", "allow", "no max autonomy");
      return ctx.actor.autonomyLevel <= c.max
        ? v("ladder.max_autonomy_constraint", "allow", "within max autonomy")
        : v("ladder.max_autonomy_constraint", "deny", `actor L${ctx.actor.autonomyLevel} > max ${c.max}`);
    },
  },
  {
    id: "approval.threshold",
    evaluate: (ctx) => {
      if (!ctx.amount) return v("approval.threshold", "allow", "no amount");
      if (ctx.commandType === "ledger.transfer") {
        return v("approval.threshold", "allow", "internal allocation");
      }
      if (ctx.thresholdWaived) {
        return v("approval.threshold", "allow", "threshold waived by approved ticket");
      }
      if (ctx.hire && ctx.hire.id !== "hid_draft" && (ctx.commandType === "hire.fund" || ctx.commandType === "hire.release" || ctx.commandType === "envelope.submit" || ctx.commandType === "hire.accept" || ctx.commandType === "hire.deliver")) {
        return v("approval.threshold", "allow", "hire already authorized at create");
      }
      if (ctx.actor.autonomyLevel === 5 && !ctx.circuit.tripped) {
        return v("approval.threshold", "allow", "L5 skips per-tx threshold");
      }
      const cap = DEFAULT_APPROVAL_THRESHOLDS[ctx.actor.role];
      if (ctx.amount.amount >= cap && ESCALATABLE.has(ctx.commandType as CommandType)) {
        return v("approval.threshold", "escalate", `amount ${ctx.amount.amount} >= threshold ${cap}`, {
          threshold: cap,
        });
      }
      return v("approval.threshold", "allow", "under threshold");
    },
  },
  {
    id: "velocity.window",
    evaluate: (ctx) => {
      if (ctx.velocity.count > VELOCITY_CAPS.maxCount || ctx.velocity.volume > VELOCITY_CAPS.maxVolume) {
        return v("velocity.window", "escalate", "velocity cap exceeded", { ...ctx.velocity });
      }
      return v("velocity.window", "allow", "velocity ok");
    },
  },
  {
    id: "circuit.daily",
    evaluate: (ctx) => {
      const spend = ctx.commandType === "hire.create" || ctx.commandType === "hire.fund" || ctx.commandType === "envelope.submit" || ctx.commandType === "hire.release" || ctx.commandType === "market.fx_settle";
      if (!spend) return v("circuit.daily", "allow", "not a spend");
      if (ctx.hire && (ctx.hire.state === "funded" || ctx.hire.state === "delivered" || ctx.hire.state === "released")) {
        return v("circuit.daily", "allow", "spend counted at fund");
      }
      if (ctx.circuit.tripped) return v("circuit.daily", "deny", "circuit tripped");
      const next = ctx.circuit.dailySpend + (ctx.amount?.amount ?? 0);
      if (ctx.amount && next > ctx.circuit.dailyLimit) {
        return v("circuit.daily", "deny", "daily limit exceeded", { next, limit: ctx.circuit.dailyLimit });
      }
      return v("circuit.daily", "allow", "circuit intact");
    },
  },
  {
    id: "hire.escrow_required",
    evaluate: (ctx) => {
      if (!ctx.hire) return v("hire.escrow_required", "allow", "no hire");
      if (ctx.commandType === "hire.deliver" && ctx.hire.state !== "funded") {
        return v("hire.escrow_required", "deny", `deliver while hire.state=${ctx.hire.state}`);
      }
      if (ctx.commandType === "hire.accept" && !ctx.hire.escrowAccountId) {
        return v("hire.escrow_required", "deny", "accept without escrow account");
      }
      return v("hire.escrow_required", "allow", "escrow discipline ok");
    },
  },
  {
    id: "hire.no_self_deal",
    evaluate: (ctx) => {
      if (!ctx.hire) return v("hire.no_self_deal", "allow", "no hire");
      return ctx.hire.buyerId === ctx.hire.sellerId
        ? v("hire.no_self_deal", "deny", "buyer === seller")
        : v("hire.no_self_deal", "allow", "counterparties distinct");
    },
  },
  {
    id: "counterparty.known",
    evaluate: (ctx) => {
      if (!ctx.payeeId) return v("counterparty.known", "allow", "no payee");
      const known = ctx.counterparties.some((a) => a.id === ctx.payeeId) || ctx.actor.id === ctx.payeeId;
      return known
        ? v("counterparty.known", "allow", "payee registered")
        : v("counterparty.known", "deny", "payee unknown");
    },
  },
  {
    id: "instrument.sim_only",
    evaluate: (ctx) => {
      if (!ctx.payment) return v("instrument.sim_only", "allow", "no payment");
      return ctx.payment.payload.payment_instrument.type === "sim_ledger"
        ? v("instrument.sim_only", "allow", "sim instrument")
        : v("instrument.sim_only", "deny", "live rails forbidden in v0");
    },
  },
  {
    id: "idempotency.nonce",
    evaluate: (ctx) =>
      ctx.nonceSeen
        ? v("idempotency.nonce", "deny", "nonce already settled")
        : v("idempotency.nonce", "allow", "nonce unused"),
  },
  {
    id: "mm.spread_bound",
    evaluate: (ctx) => {
      if (ctx.actor.role !== "market_maker" || ctx.commandType !== "market.quote") {
        return v("mm.spread_bound", "allow", "not an MM quote");
      }
      // rate lives on the command; runtime must copy it onto ctx.hire.spec or amount evidence.
      const rate = ctx.fxRateE6;
      if (rate === undefined) return v("mm.spread_bound", "allow", "no fx rate on context");
      if (rate < MM_RATE_BAND_E6.min || rate > MM_RATE_BAND_E6.max) {
        return v("mm.spread_bound", "deny", `rateE6 ${rate} outside 200bps band`);
      }
      return v("mm.spread_bound", "allow", "rate inside band");
    },
  },
  {
    id: "mm.inventory",
    evaluate: (ctx) => {
      if (ctx.commandType !== "market.fx_settle") {
        return v("mm.inventory", "allow", "not an FX settle");
      }
      if (ctx.mmInventoryOk === false) {
        return v("mm.inventory", "deny", "MM inventory insufficient");
      }
      return v("mm.inventory", "allow", "MM inventory sufficient");
    },
  },
  {
    id: "audit.writable",
    evaluate: (ctx) =>
      ctx.auditHealthy === false
        ? v("audit.writable", "deny", "audit chain unhealthy")
        : v("audit.writable", "allow", "audit chain healthy"),
  },
  {
    id: "human.signature_present",
    evaluate: (ctx) => {
      if (ctx.commandType !== "envelope.submit") {
        return v("human.signature_present", "allow", "not a payment submit");
      }
      if (ctx.actor.autonomyLevel >= 2) {
        return v("human.signature_present", "allow", "L2+ may self-sign payment");
      }
      const human = ctx.payment && ctx.counterparties.some(
        (a) => a.role === "human_operator" && a.did === ctx.payment!.issuer,
      );
      return human
        ? v("human.signature_present", "allow", "human supervisor signed")
        : v("human.signature_present", "deny", "L0/L1 payment requires human JWS");
    },
  },
  {
    id: "clearing.bilateral_limit",
    evaluate: (ctx) => {
      if (ctx.projectedExposure === undefined || ctx.exposureLimit === undefined) {
        return v("clearing.bilateral_limit", "allow", "no exposure snapshot");
      }
      if (ctx.projectedExposure > ctx.exposureLimit) {
        return v("clearing.bilateral_limit", "deny", "bilateral exposure limit exceeded", {
          projected: ctx.projectedExposure,
          limit: ctx.exposureLimit,
        });
      }
      return v("clearing.bilateral_limit", "allow", "exposure inside limit");
    },
  },
  {
    id: "kya.chain_intact",
    evaluate: (ctx) => {
      if (!ctx.kya?.required) return v("kya.chain_intact", "allow", "kya not required");
      if (ctx.kya.pathOk) return v("kya.chain_intact", "allow", ctx.kya.implicit ? "implicit supervisor grant" : "live delegation path");
      return v("kya.chain_intact", "deny", ctx.kya.revoked ? "delegation revoked" : "no delegation from principal", {
        principalId: ctx.kya.principalId,
      });
    },
  },
  {
    id: "kya.delegation_depth",
    evaluate: (ctx) => {
      if (!ctx.kya?.required || !ctx.kya.pathOk) return v("kya.delegation_depth", "allow", "depth not applicable");
      return ctx.kya.depth > ctx.kya.maxDepth
        ? v("kya.delegation_depth", "deny", `delegation depth ${ctx.kya.depth} > ${ctx.kya.maxDepth}`, {
            depth: ctx.kya.depth,
            max: ctx.kya.maxDepth,
          })
        : v("kya.delegation_depth", "allow", `depth ${ctx.kya.depth} ≤ ${ctx.kya.maxDepth}`);
    },
  },
  {
    id: "kya.principal_not_frozen",
    evaluate: (ctx) => {
      if (!ctx.kya?.required) return v("kya.principal_not_frozen", "allow", "kya not required");
      if (ctx.kya.principalId && ctx.actor.id === ctx.kya.principalId) {
        return v("kya.principal_not_frozen", "allow", "actor is principal");
      }
      return ctx.kya.principalFrozen
        ? v("kya.principal_not_frozen", "deny", "principal is frozen")
        : v("kya.principal_not_frozen", "allow", "principal not frozen");
    },
  },
  {
    id: "kya.attestation_fresh",
    evaluate: (ctx) => {
      if (!ctx.kya?.required) return v("kya.attestation_fresh", "allow", "kya not required");
      return ctx.kya.expired
        ? v("kya.attestation_fresh", "deny", "delegation expired")
        : v("kya.attestation_fresh", "allow", "attestation in window");
    },
  },
  {
    id: "kya.capability_subset",
    evaluate: (ctx) => {
      if (!ctx.kya?.required) return v("kya.capability_subset", "allow", "kya not required");
      const proposed = ctx.kya.proposedMaxAutonomy;
      if (
        proposed !== undefined &&
        ctx.commandType === "kya.attest" &&
        ctx.actor.role !== "human_operator" &&
        ctx.actor.role !== "treasury" &&
        proposed > ctx.actor.autonomyLevel
      ) {
        return v("kya.capability_subset", "deny", `cannot grant L${proposed} above own L${ctx.actor.autonomyLevel}`);
      }
      const granted = ctx.kya.grantedMaxAutonomy;
      if (granted !== undefined && ctx.actor.autonomyLevel > granted) {
        return v("kya.capability_subset", "deny", `actor L${ctx.actor.autonomyLevel} > granted max L${granted}`);
      }
      return v("kya.capability_subset", "allow", "capability within grant");
    },
  },
  {
    id: "mandate.child_tighter",
    evaluate: (ctx) => {
      if (ctx.commandType !== "mandate.issue_intent" || !ctx.parentIntent || !ctx.proposedConstraints) {
        return v("mandate.child_tighter", "allow", "not a sub-intent");
      }
      const parent = ctx.parentIntent.payload.constraints;
      const child = ctx.proposedConstraints;
      const parentRange = listed(parent, "payment.amount_range");
      const childRange = listed(child, "payment.amount_range");
      if (parentRange && (!childRange || childRange.max > parentRange.max)) {
        return v("mandate.child_tighter", "deny", "child amount_range wider than parent", {
          parentMax: parentRange.max,
          childMax: childRange?.max ?? null,
        });
      }
      const parentBudget = listed(parent, "payment.budget");
      const childBudget = listed(child, "payment.budget");
      if (parentBudget && (!childBudget || childBudget.max > parentBudget.max)) {
        return v("mandate.child_tighter", "deny", "child budget wider than parent");
      }
      const parentSkus = listed(parent, "aether.allowed_skus");
      const childSkus = listed(child, "aether.allowed_skus");
      if (parentSkus && (!childSkus || childSkus.allowed.some((s) => !parentSkus.allowed.includes(s)))) {
        return v("mandate.child_tighter", "deny", "child skus not a subset of parent");
      }
      const parentPayees = listed(parent, "payment.allowed_payees");
      const childPayees = listed(child, "payment.allowed_payees");
      if (
        parentPayees &&
        (!childPayees ||
          childPayees.allowed.some((m) => !parentPayees.allowed.some((p) => p.id === m.id)))
      ) {
        return v("mandate.child_tighter", "deny", "child payees not a subset of parent");
      }
      const parentMax = listed(parent, "aether.max_autonomy");
      const childMax = listed(child, "aether.max_autonomy");
      if (parentMax && (!childMax || childMax.max > parentMax.max)) {
        return v("mandate.child_tighter", "deny", "child max autonomy wider than parent");
      }
      return v("mandate.child_tighter", "allow", "sub-intent tighter than parent");
    },
  },
  {
    id: "payment.parent_budget",
    evaluate: (ctx) => {
      if (!ctx.parentIntent) return v("payment.parent_budget", "allow", "no parent intent");
      if (ctx.hire && (ctx.hire.state === "funded" || ctx.hire.state === "delivered" || ctx.hire.state === "released")) {
        return v("payment.parent_budget", "allow", "parent budget reserved at fund");
      }
      const c = listed(ctx.parentIntent.payload.constraints, "payment.budget");
      if (!c || !ctx.amount) return v("payment.parent_budget", "allow", "no parent budget constraint");
      if (ctx.amount.currency !== c.currency) {
        return v("payment.parent_budget", "deny", "parent budget currency mismatch");
      }
      const spent = ctx.parentSpent ?? 0;
      if (spent + ctx.amount.amount > c.max) {
        return v("payment.parent_budget", "deny", "parent budget exhausted", {
          spent,
          requested: ctx.amount.amount,
          max: c.max,
        });
      }
      return v("payment.parent_budget", "allow", "parent budget remaining");
    },
  },
  {
    id: "market.known_sku",
    evaluate: (ctx) => {
      if (ctx.skuListed === undefined) return v("market.known_sku", "allow", "not a catalog command");
      return ctx.skuListed
        ? v("market.known_sku", "allow", "sku is in the catalog")
        : v("market.known_sku", "deny", "sku is not in the catalog");
    },
  },
  {
    id: "market.not_expired",
    evaluate: (ctx) => {
      if (ctx.marketFresh === undefined) return v("market.not_expired", "allow", "not a market-time command");
      return ctx.marketFresh
        ? v("market.not_expired", "allow", "quote/rfq in window")
        : v("market.not_expired", "deny", "quote or RFQ expired");
    },
  },
];

export const RULE_IDS = RULES.map((r) => r.id);

export function evaluate(ctx: PolicyContext): PolicyDecision {
  const trace = RULES.map((r) => r.evaluate(ctx));
  const denied = trace.filter((t) => t.verdict === "deny");
  const escalated = trace.filter((t) => t.verdict === "escalate");
  if (denied.length > 0) return { verdict: "deny", trace };
  if (escalated.length > 0) return { verdict: "escalate", trace };
  return { verdict: "allow", trace };
}

const ISSUE_INTENT: Omit<Remediation, "ruleId"> = {
  kind: "issue_intent",
  commandType: "mandate.issue_intent",
  hint: "Hard constraint. A manager cannot wink this through. Issue a new (or tighter) intent.",
};

const REMEDIATION_BY_RULE: Record<string, Omit<Remediation, "ruleId">> = {
  "actor.not_frozen": {
    kind: "unfreeze_actor",
    commandType: "identity.unfreeze",
    hint: "Unfreeze this agent. Freeze drops it to L0 until then.",
  },
  "actor.role_capability": {
    kind: "role_forbidden",
    hint: "This role cannot run that command. Use a different actor. An auditor cannot spend.",
  },
  "payment.amount_range": ISSUE_INTENT,
  "payment.budget": ISSUE_INTENT,
  "payment.parent_budget": ISSUE_INTENT,
  "mandate.child_tighter": ISSUE_INTENT,
  "payment.allowed_payees": ISSUE_INTENT,
  "payment.allowed_skus": ISSUE_INTENT,
  "circuit.daily": {
    kind: "reset_circuit",
    commandType: "circuit.reset",
    hint: "Daily fuse is sticky. A human or treasury must reset it. Mandate budgets are unchanged.",
  },
  "kya.chain_intact": {
    kind: "attest_kya",
    commandType: "kya.attest",
    hint: "No live handshake from the principal. Attest, or stop. Revoke is a tombstone.",
  },
  "kya.principal_not_frozen": {
    kind: "unfreeze_principal",
    commandType: "identity.unfreeze",
    hint: "The money’s owner is frozen. Unfreeze the principal, not only the delegate.",
  },
  "kya.attestation_fresh": {
    kind: "attest_kya",
    commandType: "kya.attest",
    hint: "The handshake expired. Issue a new attestation.",
  },
  "market.known_sku": {
    kind: "none",
    hint: "This is not a storefront. Only catalog SKUs can be hired. Read market.catalog.",
  },
  "market.not_expired": {
    kind: "none",
    hint: "RFQ or quote is stale. Issue a new RFQ and get a fresh quote. Do not hire on a dead price.",
  },
};

export function remediationFor(decision: PolicyDecision): Remediation | undefined {
  if (decision.verdict === "escalate") {
    const rule = decision.trace.find((t) => t.verdict === "escalate");
    const next: Remediation = {
      kind: "wait_approval",
      ruleId: rule?.ruleId ?? "approval.threshold",
      commandType: "approval.resolve",
      hint: "Do not retry the spend. Resolve the approval ticket. Policy re-runs; only the threshold is waived.",
    };
    return next;
  }
  if (decision.verdict !== "deny") return undefined;
  const rule = decision.trace.find((t) => t.verdict === "deny");
  if (!rule) return undefined;
  const row = REMEDIATION_BY_RULE[rule.ruleId] ?? {
    kind: "none",
    hint: "Read the rule trace. Do not retry until the constraint changes.",
  };
  return { ...row, ruleId: rule.ruleId };
}
