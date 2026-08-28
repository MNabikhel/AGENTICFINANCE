/**
 * Deterministic policy engine. No I/O. No LLM.
 * Aggregation: any deny → deny; else any escalate → escalate; else allow.
 * Every rule always runs so the trace is a complete audit artifact.
 */

import {
  DEFAULT_APPROVAL_THRESHOLDS,
  HIRE_COMMAND_REQUIRED_STATE,
  HIRE_COMMAND_TARGET,
  HIRE_TRANSITIONS,
  MIN_LEVEL_FOR_ACTION,
  MM_RATE_BAND_E6,
  RECURRENCE_GAP_MS,
  ROLE_CAPABILITY,
  VELOCITY_CAPS,
  type AutonomyLevel,
  type CommandType,
  type HireState,
  type Instant,
  type MandateConstraint,
  type PolicyContext,
  type PolicyDecision,
  type RecurrenceFrequency,
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

function nextHireState(commandType: string): HireState | undefined {
  if (commandType in HIRE_COMMAND_TARGET) {
    return HIRE_COMMAND_TARGET[commandType as keyof typeof HIRE_COMMAND_TARGET];
  }
  return undefined;
}

function requiredHireState(commandType: string): HireState | undefined {
  if (commandType in HIRE_COMMAND_REQUIRED_STATE) {
    return HIRE_COMMAND_REQUIRED_STATE[commandType as keyof typeof HIRE_COMMAND_REQUIRED_STATE];
  }
  return undefined;
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

/** New spend starts here. Completing a funded hire is not a new spend. */
const SPEND_START_COMMANDS = new Set<CommandType>(["hire.create", "hire.fund"]);

const FREQ_RANK: Record<RecurrenceFrequency, number> = {
  ON_DEMAND: 0,
  DAILY: 1,
  WEEKLY: 2,
  MONTHLY: 3,
};

function recurrenceDeny(
  c: Extract<MandateConstraint, { type: "payment.agent_recurrence" }>,
  occurrenceCount: number,
  lastOccurrenceAt: Instant | undefined,
  clock: Instant,
  prefix: string,
): RuleVerdict | undefined {
  if (!(c.frequency in RECURRENCE_GAP_MS)) {
    return v("payment.recurrence", "deny", `${prefix}unknown frequency`);
  }
  if (c.max_occurrences !== undefined && occurrenceCount >= c.max_occurrences) {
    return v("payment.recurrence", "deny", `${prefix}max_occurrences exceeded`, {
      count: occurrenceCount,
      max: c.max_occurrences,
    });
  }
  const gap = RECURRENCE_GAP_MS[c.frequency];
  if (gap > 0 && lastOccurrenceAt) {
    const elapsed = Date.parse(clock) - Date.parse(lastOccurrenceAt);
    if (elapsed < gap) {
      return v("payment.recurrence", "deny", `${prefix}recurrence gap (${c.frequency})`, {
        frequency: c.frequency,
        elapsedMs: elapsed,
        gapMs: gap,
      });
    }
  }
  return undefined;
}

function executionWindowDeny(
  c: Extract<MandateConstraint, { type: "payment.execution_date" }>,
  clock: Instant,
  prefix: string,
): RuleVerdict | undefined {
  const now = Date.parse(clock);
  if (c.not_before && now < Date.parse(c.not_before)) {
    return v("payment.execution_date", "deny", `${prefix}before not_before`);
  }
  if (c.not_after && now > Date.parse(c.not_after)) {
    return v("payment.execution_date", "deny", `${prefix}after not_after`);
  }
  return undefined;
}

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
        if (
          (ctx.commandType === "envelope.submit" || ctx.commandType === "hire.fund") &&
          ctx.hire &&
          ctx.hire.id !== "hid_draft"
        ) {
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
      if (typeof c.max !== "number") {
        return v("payment.amount_range", "deny", "amount_range missing max");
      }
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
      if (typeof c.max !== "number") {
        return v("payment.budget", "deny", "budget missing max");
      }
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
      if (!Array.isArray(c.allowed)) {
        return v("payment.allowed_payees", "deny", "payee list missing");
      }
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
      if (!Array.isArray(c.allowed)) {
        return v("payment.allowed_skus", "deny", "sku list missing");
      }
      return c.allowed.includes(sku)
        ? v("payment.allowed_skus", "allow", "sku listed")
        : v("payment.allowed_skus", "deny", `sku ${sku} not listed`);
    },
  },
  {
    id: "payment.recurrence",
    evaluate: (ctx) => {
      if (!SPEND_START_COMMANDS.has(ctx.commandType as CommandType)) {
        return v("payment.recurrence", "allow", "recurrence counted at fund");
      }
      const own = findConstraint(ctx, "payment.agent_recurrence");
      if (own) {
        const hit = recurrenceDeny(own, ctx.occurrenceCount, ctx.lastOccurrenceAt, ctx.clock, "");
        if (hit) return hit;
      }
      const parentC = ctx.parentIntent
        ? listed(ctx.parentIntent.payload.constraints, "payment.agent_recurrence")
        : undefined;
      if (parentC) {
        const hit = recurrenceDeny(
          parentC,
          ctx.parentOccurrenceCount ?? 0,
          ctx.parentLastOccurrenceAt,
          ctx.clock,
          "parent ",
        );
        if (hit) return hit;
      }
      if (!own && !parentC) return v("payment.recurrence", "allow", "no recurrence constraint");
      return v("payment.recurrence", "allow", "recurrence ok");
    },
  },
  {
    id: "payment.execution_date",
    evaluate: (ctx) => {
      if (!SPEND_START_COMMANDS.has(ctx.commandType as CommandType)) {
        return v("payment.execution_date", "allow", "window checked at fund");
      }
      const own = findConstraint(ctx, "payment.execution_date");
      if (own) {
        const hit = executionWindowDeny(own, ctx.clock, "");
        if (hit) return hit;
      }
      const parentC = ctx.parentIntent
        ? listed(ctx.parentIntent.payload.constraints, "payment.execution_date")
        : undefined;
      if (parentC) {
        const hit = executionWindowDeny(parentC, ctx.clock, "parent ");
        if (hit) return hit;
      }
      if (!own && !parentC) return v("payment.execution_date", "allow", "no execution window");
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
      if (typeof c.max !== "number") {
        return v("ladder.max_autonomy_constraint", "deny", "max autonomy missing");
      }
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
      // Nested fx.rateE6 is what is stored and what settle uses.
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
      if (
        parentRange &&
        (typeof parentRange.max !== "number" ||
          !childRange ||
          typeof childRange.max !== "number" ||
          childRange.max > parentRange.max)
      ) {
        return v("mandate.child_tighter", "deny", "child amount_range wider than parent", {
          parentMax: parentRange.max,
          childMax: childRange?.max ?? null,
        });
      }
      const parentBudget = listed(parent, "payment.budget");
      const childBudget = listed(child, "payment.budget");
      if (
        parentBudget &&
        (typeof parentBudget.max !== "number" ||
          !childBudget ||
          typeof childBudget.max !== "number" ||
          childBudget.max > parentBudget.max)
      ) {
        return v("mandate.child_tighter", "deny", "child budget wider than parent");
      }
      const parentSkus = listed(parent, "aether.allowed_skus");
      const childSkus = listed(child, "aether.allowed_skus");
      if (
        parentSkus &&
        (!Array.isArray(parentSkus.allowed) ||
          !childSkus ||
          !Array.isArray(childSkus.allowed) ||
          childSkus.allowed.some((s) => !parentSkus.allowed.includes(s)))
      ) {
        return v("mandate.child_tighter", "deny", "child skus not a subset of parent");
      }
      const parentPayees = listed(parent, "payment.allowed_payees");
      const childPayees = listed(child, "payment.allowed_payees");
      if (
        parentPayees &&
        (!Array.isArray(parentPayees.allowed) ||
          !childPayees ||
          !Array.isArray(childPayees.allowed) ||
          childPayees.allowed.some((m) => !parentPayees.allowed.some((p) => p.id === m.id)))
      ) {
        return v("mandate.child_tighter", "deny", "child payees not a subset of parent");
      }
      const parentMax = listed(parent, "aether.max_autonomy");
      const childMax = listed(child, "aether.max_autonomy");
      if (parentMax && (!childMax || typeof childMax.max !== "number" || typeof parentMax.max !== "number" || childMax.max > parentMax.max)) {
        return v("mandate.child_tighter", "deny", "child max autonomy wider than parent");
      }
      const parentRec = listed(parent, "payment.agent_recurrence");
      const childRec = listed(child, "payment.agent_recurrence");
      if (parentRec) {
        if (!childRec) return v("mandate.child_tighter", "deny", "child missing recurrence constraint");
        if (
          parentRec.max_occurrences !== undefined &&
          (childRec.max_occurrences === undefined || childRec.max_occurrences > parentRec.max_occurrences)
        ) {
          return v("mandate.child_tighter", "deny", "child max_occurrences wider than parent");
        }
        if (
          !(childRec.frequency in FREQ_RANK) ||
          !(parentRec.frequency in FREQ_RANK) ||
          FREQ_RANK[childRec.frequency] < FREQ_RANK[parentRec.frequency]
        ) {
          return v("mandate.child_tighter", "deny", "child recurrence more frequent than parent");
        }
      }
      const parentWin = listed(parent, "payment.execution_date");
      const childWin = listed(child, "payment.execution_date");
      if (parentWin) {
        if (!childWin) return v("mandate.child_tighter", "deny", "child missing execution window");
        if (
          parentWin.not_before &&
          (!childWin.not_before || Date.parse(childWin.not_before) < Date.parse(parentWin.not_before))
        ) {
          return v("mandate.child_tighter", "deny", "child execution window starts before parent");
        }
        if (
          parentWin.not_after &&
          (!childWin.not_after || Date.parse(childWin.not_after) > Date.parse(parentWin.not_after))
        ) {
          return v("mandate.child_tighter", "deny", "child execution window ends after parent");
        }
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
      if (typeof c.max !== "number") {
        return v("payment.parent_budget", "deny", "parent budget missing max");
      }
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
  {
    id: "market.invited_seller",
    evaluate: (ctx) => {
      if (ctx.sellerInvited === undefined) return v("market.invited_seller", "allow", "not an invite-gated command");
      return ctx.sellerInvited
        ? v("market.invited_seller", "allow", "seller is invited or RFQ is open")
        : v("market.invited_seller", "deny", "seller is not on the RFQ invite list");
    },
  },
  {
    id: "hire.cart_matches",
    evaluate: (ctx) => {
      if (ctx.cartMatchesHire === undefined) return v("hire.cart_matches", "allow", "not a hire-cart command");
      return ctx.cartMatchesHire
        ? v("hire.cart_matches", "allow", "cart matches hire")
        : v("hire.cart_matches", "deny", "cart does not match hire price, seller, or sku");
    },
  },
  {
    id: "market.known_rfq",
    evaluate: (ctx) => {
      if (ctx.rfqKnown === undefined) return v("market.known_rfq", "allow", "not an RFQ-gated command");
      return ctx.rfqKnown
        ? v("market.known_rfq", "allow", "rfq exists")
        : v("market.known_rfq", "deny", "rfq or quote not found");
    },
  },
  {
    id: "market.fx_quote",
    evaluate: (ctx) => {
      if (ctx.fxQuoteLive === undefined) return v("market.fx_quote", "allow", "not an FX settle");
      return ctx.fxQuoteLive
        ? v("market.fx_quote", "allow", "live unused FX quote")
        : v("market.fx_quote", "deny", "need a live unused FX quote");
    },
  },
  {
    id: "hire.quote_unspent",
    evaluate: (ctx) => {
      if (ctx.quoteUnspent === undefined) return v("hire.quote_unspent", "allow", "not a hire.create");
      return ctx.quoteUnspent
        ? v("hire.quote_unspent", "allow", "quote has not been used")
        : v("hire.quote_unspent", "deny", "quote already used");
    },
  },
  {
    id: "hire.known",
    evaluate: (ctx) => {
      if (ctx.hireKnown === undefined) return v("hire.known", "allow", "not a hire-id command");
      return ctx.hireKnown
        ? v("hire.known", "allow", "hire exists")
        : v("hire.known", "deny", "hire not found");
    },
  },
  {
    id: "mandate.known_intent",
    evaluate: (ctx) => {
      if (ctx.intentKnown === undefined) return v("mandate.known_intent", "allow", "not an intent-gated command");
      return ctx.intentKnown
        ? v("mandate.known_intent", "allow", "intent exists")
        : v("mandate.known_intent", "deny", "intent not found");
    },
  },
  {
    id: "mandate.known_cart",
    evaluate: (ctx) => {
      if (ctx.cartKnown === undefined) return v("mandate.known_cart", "allow", "not a cart-gated command");
      return ctx.cartKnown
        ? v("mandate.known_cart", "allow", "cart exists")
        : v("mandate.known_cart", "deny", "cart not found");
    },
  },
  {
    id: "approval.known",
    evaluate: (ctx) => {
      if (ctx.approvalKnown === undefined) return v("approval.known", "allow", "not an approval.resolve");
      return ctx.approvalKnown
        ? v("approval.known", "allow", "ticket exists")
        : v("approval.known", "deny", "approval not found");
    },
  },
  {
    id: "approval.pending",
    evaluate: (ctx) => {
      if (ctx.approvalPending === undefined) return v("approval.pending", "allow", "not a live-ticket resolve");
      return ctx.approvalPending
        ? v("approval.pending", "allow", "ticket is pending")
        : v("approval.pending", "deny", "ticket is not pending");
    },
  },
  {
    id: "hire.party",
    evaluate: (ctx) => {
      if (ctx.hirePartyOk === undefined) return v("hire.party", "allow", "not a party-gated hire command");
      return ctx.hirePartyOk
        ? v("hire.party", "allow", "actor is the hire counterparty")
        : v("hire.party", "deny", "actor is not the hire counterparty");
    },
  },
  {
    id: "mandate.known_parent",
    evaluate: (ctx) => {
      if (ctx.parentKnown === undefined) return v("mandate.known_parent", "allow", "not a sub-intent");
      return ctx.parentKnown
        ? v("mandate.known_parent", "allow", "parent exists")
        : v("mandate.known_parent", "deny", "parent intent not found");
    },
  },
  {
    id: "identity.known",
    evaluate: (ctx) => {
      if (ctx.targetKnown === undefined) return v("identity.known", "allow", "not an agent-id command");
      return ctx.targetKnown
        ? v("identity.known", "allow", "agent exists")
        : v("identity.known", "deny", "agent not found");
    },
  },
  {
    id: "hire.state",
    evaluate: (ctx) => {
      const to = nextHireState(ctx.commandType);
      const required = requiredHireState(ctx.commandType);
      if (to === undefined && required === undefined) return v("hire.state", "allow", "not a hire-state command");
      if (!ctx.hire || ctx.hire.id === "hid_draft") return v("hire.state", "allow", "no live hire");
      if (to !== undefined) {
        return HIRE_TRANSITIONS[ctx.hire.state].includes(to)
          ? v("hire.state", "allow", `${ctx.hire.state} -> ${to}`)
          : v("hire.state", "deny", `illegal ${ctx.hire.state} -> ${to}`, { from: ctx.hire.state, to });
      }
      return ctx.hire.state === required
        ? v("hire.state", "allow", `hire.state=${required}`)
        : v("hire.state", "deny", `illegal ${ctx.hire.state} for ${ctx.commandType}`, {
            from: ctx.hire.state,
            ...(required ? { required } : {}),
          });
    },
  },
  {
    id: "ladder.legal",
    evaluate: (ctx) => {
      if (ctx.ladderLegal === undefined) return v("ladder.legal", "allow", "not a ladder.set");
      return ctx.ladderLegal
        ? v("ladder.legal", "allow", "legal climb")
        : v("ladder.legal", "deny", "illegal ladder climb");
    },
  },
  {
    id: "kya.not_self",
    evaluate: (ctx) => {
      if (ctx.kyaNotSelf === undefined) return v("kya.not_self", "allow", "not a kya.attest");
      return ctx.kyaNotSelf
        ? v("kya.not_self", "allow", "grantor is not the delegate")
        : v("kya.not_self", "deny", "cannot attest yourself");
    },
  },
  {
    id: "kya.known_parent",
    evaluate: (ctx) => {
      if (ctx.kyaParentKnown === undefined) return v("kya.known_parent", "allow", "not a nested hop");
      return ctx.kyaParentKnown
        ? v("kya.known_parent", "allow", "parent hop exists")
        : v("kya.known_parent", "deny", "parent hop not found");
    },
  },
  {
    id: "ledger.known_account",
    evaluate: (ctx) => {
      if (ctx.accountsKnown === undefined) return v("ledger.known_account", "allow", "not an account-name command");
      return ctx.accountsKnown
        ? v("ledger.known_account", "allow", "account exists")
        : v("ledger.known_account", "deny", "account not found");
    },
  },
  {
    id: "ledger.same_currency",
    evaluate: (ctx) => {
      if (ctx.accountsSameCurrency === undefined) return v("ledger.same_currency", "allow", "not a mixed-currency journal");
      return ctx.accountsSameCurrency
        ? v("ledger.same_currency", "allow", "one currency")
        : v("ledger.same_currency", "deny", "mixed currency; use market.fx_settle");
    },
  },
  {
    id: "ledger.sufficient",
    evaluate: (ctx) => {
      if (ctx.fundsOk === undefined) return v("ledger.sufficient", "allow", "not a cash-gated command");
      return ctx.fundsOk
        ? v("ledger.sufficient", "allow", "source covers the amount")
        : v("ledger.sufficient", "deny", "insufficient funds");
    },
  },
  {
    id: "kya.known_attestation",
    evaluate: (ctx) => {
      if (ctx.kyaAttestationKnown === undefined) {
        return v("kya.known_attestation", "allow", "not a named-attestation revoke");
      }
      return ctx.kyaAttestationKnown
        ? v("kya.known_attestation", "allow", "attestation exists for this principal")
        : v("kya.known_attestation", "deny", "attestation not found");
    },
  },
  {
    id: "kya.party",
    evaluate: (ctx) => {
      if (ctx.kyaPartyOk === undefined) return v("kya.party", "allow", "not a handshake command");
      return ctx.kyaPartyOk
        ? v("kya.party", "allow", "actor is the principal or a kill-switch role")
        : v("kya.party", "deny", "actor is not the handshake principal");
    },
  },
  {
    id: "identity.unique_key",
    evaluate: (ctx) => {
      if (ctx.aliasFree === undefined) return v("identity.unique_key", "allow", "not a register");
      return ctx.aliasFree
        ? v("identity.unique_key", "allow", "alias and cash book are free")
        : v("identity.unique_key", "deny", "alias or cash book already taken");
    },
  },
  {
    id: "receipt.known",
    evaluate: (ctx) => {
      if (ctx.receiptKnown === undefined) return v("receipt.known", "allow", "not a receipt fetch");
      return ctx.receiptKnown
        ? v("receipt.known", "allow", "receipt exists")
        : v("receipt.known", "deny", "receipt not found");
    },
  },
  {
    id: "identity.freeze_state",
    evaluate: (ctx) => {
      if (ctx.freezeStateOk === undefined) return v("identity.freeze_state", "allow", "not a freeze delta");
      if (ctx.freezeStateOk) return v("identity.freeze_state", "allow", "freeze delta matches state");
      return ctx.commandType === "identity.unfreeze"
        ? v("identity.freeze_state", "deny", "target is not frozen")
        : v("identity.freeze_state", "deny", "target is already frozen");
    },
  },
  {
    id: "kya.unique_live",
    evaluate: (ctx) => {
      if (ctx.kyaLiveFree === undefined) return v("kya.unique_live", "allow", "not a handshake mint");
      return ctx.kyaLiveFree
        ? v("kya.unique_live", "allow", "no live hop for this pair")
        : v("kya.unique_live", "deny", "live handshake already exists for this pair");
    },
  },
  {
    id: "hire.unique_cart",
    evaluate: (ctx) => {
      if (ctx.cartUnbound === undefined) return v("hire.unique_cart", "allow", "not binding a cart to a hire");
      return ctx.cartUnbound
        ? v("hire.unique_cart", "allow", "hire has no cart yet")
        : v("hire.unique_cart", "deny", "hire already has a cart");
    },
  },
  {
    id: "mandate.unique_payment",
    evaluate: (ctx) => {
      if (ctx.paymentUnbound === undefined) {
        return v("mandate.unique_payment", "allow", "not minting a payment for a cart");
      }
      return ctx.paymentUnbound
        ? v("mandate.unique_payment", "allow", "cart has no payment yet")
        : v("mandate.unique_payment", "deny", "cart already has a payment");
    },
  },
  {
    id: "market.sku_currency",
    evaluate: (ctx) => {
      if (ctx.skuCurrencyOk === undefined) {
        return v("market.sku_currency", "allow", "not a priced catalog command");
      }
      return ctx.skuCurrencyOk
        ? v("market.sku_currency", "allow", "price currency is listed for this sku")
        : v("market.sku_currency", "deny", "price currency is not listed for this sku");
    },
  },
  {
    id: "market.fx_pair",
    evaluate: (ctx) => {
      if (ctx.fxPairOk === undefined) return v("market.fx_pair", "allow", "not an FX window");
      return ctx.fxPairOk
        ? v("market.fx_pair", "allow", "USD_SIM to USDC_SIM priced in from")
        : v("market.fx_pair", "deny", "FX window is not this rail's USD_SIM to USDC_SIM pair");
    },
  },
  {
    id: "hire.not_fx",
    evaluate: (ctx) => {
      if (ctx.hireNotFx === undefined) return v("hire.not_fx", "allow", "not a hire.create");
      return ctx.hireNotFx
        ? v("hire.not_fx", "allow", "quote is not an FX window")
        : v("hire.not_fx", "deny", "FX window is not a hire");
    },
  },
  {
    id: "approval.replay",
    evaluate: (ctx) => {
      if (ctx.replayOk === undefined) return v("approval.replay", "allow", "not approving a live ticket");
      return ctx.replayOk
        ? v("approval.replay", "allow", "paused command is still an allow")
        : v("approval.replay", "deny", "paused command is no longer legal");
    },
  },
  {
    id: "market.fx_window",
    evaluate: (ctx) => {
      if (ctx.fxWindowOk === undefined) return v("market.fx_window", "allow", "not quoting an FX SKU");
      return ctx.fxWindowOk
        ? v("market.fx_window", "allow", "FX SKU carries a window")
        : v("market.fx_window", "deny", "FX SKU is a window, not a good");
    },
  },
  {
    id: "hire.bound_cart",
    evaluate: (ctx) => {
      if (ctx.cartBound === undefined) return v("hire.bound_cart", "allow", "not moving escrow against a hire");
      return ctx.cartBound
        ? v("hire.bound_cart", "allow", "hire holds its cart and payment")
        : v("hire.bound_cart", "deny", "hire has not bound a cart");
    },
  },
  {
    id: "mm.known",
    evaluate: (ctx) => {
      if (ctx.mmKnown === undefined) return v("mm.known", "allow", "not a live FX settle");
      return ctx.mmKnown
        ? v("mm.known", "allow", "market maker and books exist")
        : v("mm.known", "deny", "no market maker");
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
  "market.invited_seller": {
    kind: "none",
    hint: "This RFQ named its sellers. Only invitedSellerIds may quote. An empty invite list is an open RFQ.",
  },
  "payment.recurrence": {
    kind: "none",
    hint: "Cadence is spent. If the frequency gap has not elapsed, wait. If max_occurrences is exhausted, issue a new intent. Refund does not restore a slot.",
  },
  "hire.cart_matches": {
    kind: "none",
    hint: "The cart must equal the hire: same seller, same SKU, same integer cents. Escrow moves the hire price. A cheaper cart is not a discount.",
  },
  "market.known_rfq": {
    kind: "none",
    hint: "That RFQ or quote id is unknown. Issue a real RFQ, then quote it. A missing room is not a missing SKU.",
  },
  "market.fx_quote": {
    kind: "none",
    hint: "An FX quote is a one-shot window. A missing quote, a research quote, a spent quote, or a quote held by an open hire ticket is not a second settle.",
  },
  "hire.quote_unspent": {
    kind: "none",
    hint: "That quote already produced a hire, an FX settle, or is held by an open approval ticket. A price promise is used once. A deny does not consume it. Reject or wait for expiry to release a reservation. A void does not restore it.",
  },
  "hire.known": {
    kind: "none",
    hint: "That hire id is not in this world. Create the hire first. A missing contract is not a broken mandate chain.",
  },
  "mandate.known_intent": {
    kind: "none",
    hint: "That intent id is not in this world. Issue a real permission slip first. A missing slip is not a missing handshake.",
  },
  "mandate.known_cart": {
    kind: "none",
    hint: "That cart id is not in this world. Issue the cart first. A missing cart is not a broken payment chain.",
  },
  "approval.known": {
    kind: "none",
    hint: "That approval id is not in this world. Escalate a real spend to mint a ticket. A missing ticket is not a late yes.",
  },
  "approval.pending": {
    kind: "none",
    hint: "That ticket is expired or already resolved. Resolving it is a refuse, not a late yes. Retry the original command if it is still legal.",
  },
  "hire.party": {
    kind: "none",
    hint: "This command belongs to a party on the hire. Accept, deliver, and payment-required are the seller. Refund and release are the buyer or treasury.",
  },
  "mandate.known_parent": {
    kind: "none",
    hint: "That parentId is not in this world. Issue the parent slip first. A missing parent is not a tighter child.",
  },
  "identity.known": {
    kind: "none",
    hint: "That agent id is not in this world. Register them first. A missing agent is not a freeze, a handshake, a merchant, a permission-slip subject, or a revoke target.",
  },
  "hire.state": {
    kind: "none",
    hint: "A hire only walks offered → accepted → funded → delivered → released. Refund is only from funded. Payment-required is only after deliver. An illegal arrow is a refuse. Delivered work cannot be unwound.",
  },
  "ladder.legal": {
    kind: "none",
    hint: "Rungs cannot be skipped. L5 also needs a working circuit breaker and a freeze that was actually tested — listing the gate names is not the test. any→L0 is always legal for a ladder approver.",
  },
  "kya.not_self": {
    kind: "none",
    hint: "A handshake is with another agent. You cannot attest yourself. Know Your Agent is a grant, not a mirror.",
  },
  "kya.known_parent": {
    kind: "none",
    hint: "That parentId is not in this world’s graph. Attest the parent hop first. A missing parent is not a live nested handshake.",
  },
  "ledger.known_account": {
    kind: "none",
    hint: "That account name is not in this world. Register the agent (or open the book) first. A missing book is not an allocation. An FX settle needs the vendor’s USDC book — USD cash is not a USDC wallet.",
  },
  "ledger.same_currency": {
    kind: "none",
    hint: "One journal is one currency. USD_SIM and USDC_SIM do not mix. Convert with market.fx_settle, not a transfer. Escrow cannot lock USD cash into a USDC hire.",
  },
  "ledger.sufficient": {
    kind: "none",
    hint: "The source book does not have that many cents. A transfer is not an overdraft. Escrow cannot lock on empty cash. An FX settle cannot spend USD the vendor does not hold. Seed or allocate first.",
  },
  "kya.known_attestation": {
    kind: "none",
    hint: "That attestation id is not in this world’s graph for this principal. A missing handshake is not a tombstone. You cannot revoke someone else’s handshake by guessing its id.",
  },
  "kya.party": {
    kind: "none",
    hint: "You can only mint or tombstone a handshake for which you are the principal. A human or treasury may revoke any pair. An L4 desk cannot write a founder’s handshake by filling in the ids.",
  },
  "identity.unique_key": {
    kind: "none",
    hint: "That runtime alias (or its cash book) is already taken. Pick a free key. Two agents cannot share one operating book. Same-body retries still replay.",
  },
  "receipt.known": {
    kind: "none",
    hint: "That receipt is not in this world. A missing receipt is not an empty success. Release escrow first.",
  },
  "identity.freeze_state": {
    kind: "none",
    hint: "Freeze someone who is live and unfrozen. Unfreeze someone who is actually frozen. A no-op freeze is not a notary line after yes.",
  },
  "kya.unique_live": {
    kind: "none",
    hint: "That principal already has a live handshake with this delegate. Revoke it, then attest again. A second live hop is not a tighter grant.",
  },
  "hire.unique_cart": {
    kind: "none",
    hint: "That hire already has a cart. A hire takes one cart. Issue payment against the existing cart. A second cart is not a pointer swap.",
  },
  "mandate.unique_payment": {
    kind: "none",
    hint: "That cart already has a payment. A cart takes one payment. Fund or release against the existing mandate. A second payment is not a second check.",
  },
  "market.sku_currency": {
    kind: "none",
    hint: "That SKU is not priced in that currency. Read market.catalog. Convert with market.fx_settle.",
  },
  "market.fx_pair": {
    kind: "none",
    hint: "This rail settles USD_SIM → USDC_SIM. Price is in from. An FX window does not belong on a research SKU. A swapped pair or a price in to is not this window.",
  },
  "hire.not_fx": {
    kind: "none",
    hint: "An FX window settles with market.fx_settle. It is not a hire. A deny does not consume the window.",
  },
  "approval.replay": {
    kind: "none",
    hint: "That ticket’s paused command is no longer legal (stale quote, expired slip, or the held command is gone). Reject the ticket to release a reserved quote. Do not treat a grown-up yes as a late hire.",
  },
  "market.fx_window": {
    kind: "none",
    hint: "An FX SKU is a conversion window. Attach fx.from/to/rateE6/validUntil. Settle with market.fx_settle. It is not a hireable good.",
  },
  "hire.bound_cart": {
    kind: "none",
    hint: "That hire has not bound a cart (and that cart’s payment). Issue the cart with hireId, then the payment. Passing cartId on fund is not a pointer. A loose cart is not this hire’s check.",
  },
  "mm.known": {
    kind: "none",
    hint: "There is no market maker (or their USD/USDC books) in this world. Register a market_maker before settling FX. A window is not a journal against missing books.",
  },
  "payment.execution_date": {
    kind: "none",
    hint: "This slip's calendar window is closed for new spends. Completing a funded hire is not a new spend. Issue a new intent if you need another hire.",
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
