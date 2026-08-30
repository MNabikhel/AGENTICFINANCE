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
  SIM_INSTRUMENT,
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

/** Escrow already moved. Cart, payment, intent, handshake windows, grant ceilings, slip rungs, and a hot settle hour do not trap the lock. Freeze and revoke still bind. */
const COMPLETE_AFTER_FUND = new Set<CommandType>([
  "hire.deliver",
  "hire.release",
  "hire.refund",
  "envelope.require",
  "envelope.submit",
]);

/** New money movement. Completing a funded hire and reads are not a velocity event. */
const VELOCITY_SPEND_COMMANDS = new Set<CommandType>(["hire.create", "hire.fund", "market.fx_settle"]);

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
    evaluate: (ctx) => {
      if (ctx.actorKnown === false) return v("actor.not_frozen", "allow", "speaker is not registered");
      return ctx.actor.frozen
        ? v("actor.not_frozen", "deny", "actor is frozen")
        : v("actor.not_frozen", "allow", "actor not frozen");
    },
  },
  {
    id: "actor.role_capability",
    evaluate: (ctx) => {
      if (ctx.actorKnown === false) return v("actor.role_capability", "allow", "speaker is not registered");
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
      if (COMPLETE_AFTER_FUND.has(ctx.commandType as CommandType)) {
        return v("mandate.not_expired", "allow", "window checked at fund");
      }
      if (ctx.intentWindowLive === false) {
        return v("mandate.not_expired", "deny", "intent revoked");
      }
      if (ctx.cartWindowLive === false) {
        return v("mandate.not_expired", "deny", "cart revoked");
      }
      if (ctx.paymentWindowLive === false) {
        return v("mandate.not_expired", "deny", "payment revoked");
      }
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
      if (
        ctx.commandType !== "envelope.submit" &&
        ctx.commandType !== "hire.fund" &&
        ctx.commandType !== "host.subscribe"
      ) {
        return v("mandate.subject_is_actor", "allow", "not a subject-bound command");
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
    id: "payment.allowed_payment_instruments",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "payment.allowed_payment_instruments");
      if (!c) return v("payment.allowed_payment_instruments", "allow", "no instrument constraint");
      const instrument = ctx.payment?.payload.payment_instrument
        ? ctx.payment.payload.payment_instrument
        : SPEND_START_COMMANDS.has(ctx.commandType as CommandType)
          ? SIM_INSTRUMENT
          : undefined;
      if (!instrument) {
        return v("payment.allowed_payment_instruments", "allow", "no payment instrument");
      }
      if (!Array.isArray(c.allowed)) {
        return v("payment.allowed_payment_instruments", "deny", "instrument list missing");
      }
      return c.allowed.some((m) => m.id === instrument.id)
        ? v("payment.allowed_payment_instruments", "allow", "instrument listed")
        : v("payment.allowed_payment_instruments", "deny", "instrument not in allow-list");
    },
  },
  {
    id: "payment.reference",
    evaluate: (ctx) => {
      const c = findConstraint(ctx, "payment.reference");
      if (!c) return v("payment.reference", "allow", "no reference constraint");
      if (!SPEND_START_COMMANDS.has(ctx.commandType as CommandType)) {
        return v("payment.reference", "allow", "not a spend start");
      }
      if (ctx.referenceOk === undefined) {
        return v("payment.reference", "allow", "no prior funded payment");
      }
      return ctx.referenceOk
        ? v("payment.reference", "allow", "citation matches a funded check")
        : v("payment.reference", "deny", "citation is not a funded check");
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
      if (ctx.thresholdWaived && ESCALATABLE.has(ctx.commandType as CommandType)) {
        return v("ladder.min_level", "allow", "rung waived by approved ticket");
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
      if (COMPLETE_AFTER_FUND.has(ctx.commandType as CommandType)) {
        return v("ladder.max_autonomy_constraint", "allow", "rung checked at fund");
      }
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
      if (!VELOCITY_SPEND_COMMANDS.has(ctx.commandType as CommandType)) {
        return v("velocity.window", "allow", "not a spend");
      }
      if (ctx.hire && (ctx.hire.state === "funded" || ctx.hire.state === "delivered" || ctx.hire.state === "released")) {
        return v("velocity.window", "allow", "spend counted at fund");
      }
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
    evaluate: (ctx) => {
      if (ctx.commandType !== "envelope.submit") {
        return v("idempotency.nonce", "allow", "not a payment submit");
      }
      return ctx.nonceSeen
        ? v("idempotency.nonce", "deny", "nonce already settled")
        : v("idempotency.nonce", "allow", "nonce unused");
    },
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
      if (COMPLETE_AFTER_FUND.has(ctx.commandType as CommandType)) {
        return v("kya.attestation_fresh", "allow", "handshake checked at fund");
      }
      return ctx.kya.expired
        ? v("kya.attestation_fresh", "deny", "delegation expired")
        : v("kya.attestation_fresh", "allow", "attestation in window");
    },
  },
  {
    id: "kya.capability_subset",
    evaluate: (ctx) => {
      if (!ctx.kya?.required) return v("kya.capability_subset", "allow", "kya not required");
      if (COMPLETE_AFTER_FUND.has(ctx.commandType as CommandType)) {
        return v("kya.capability_subset", "allow", "grant checked at fund");
      }
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
      if (parentRange && childRange) {
        const parentMin = typeof parentRange.min === "number" ? parentRange.min : 0;
        const childMin = typeof childRange.min === "number" ? childRange.min : 0;
        if (childMin < parentMin) {
          return v("mandate.child_tighter", "deny", "child amount_range floor wider than parent", {
            parentMin,
            childMin,
          });
        }
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
      const parentRails = listed(parent, "payment.allowed_payment_instruments");
      const childRails = listed(child, "payment.allowed_payment_instruments");
      if (
        parentRails &&
        (!Array.isArray(parentRails.allowed) ||
          !childRails ||
          !Array.isArray(childRails.allowed) ||
          childRails.allowed.some((m) => !parentRails.allowed.some((p) => p.id === m.id)))
      ) {
        return v("mandate.child_tighter", "deny", "child instruments not a subset of parent");
      }
      const parentRef = listed(parent, "payment.reference");
      const childRef = listed(child, "payment.reference");
      if (parentRef) {
        if (!childRef) return v("mandate.child_tighter", "deny", "child missing payment.reference");
        if (childRef.conditional_transaction_id !== parentRef.conditional_transaction_id) {
          return v("mandate.child_tighter", "deny", "child payment.reference does not match parent");
        }
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
      if (ctx.quoteUnspent === undefined) return v("hire.quote_unspent", "allow", "not a spend-or-withdraw of a known quote");
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
    id: "mandate.known_payment",
    evaluate: (ctx) => {
      if (ctx.paymentKnown === undefined) return v("mandate.known_payment", "allow", "not a payment-gated command");
      return ctx.paymentKnown
        ? v("mandate.known_payment", "allow", "payment exists")
        : v("mandate.known_payment", "deny", "payment not found");
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
        ? v("identity.unique_key", "allow", "alias and operating books are free")
        : v("identity.unique_key", "deny", "alias or operating book already taken");
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
  {
    id: "actor.known",
    evaluate: (ctx) => {
      if (ctx.actorKnown === undefined) return v("actor.known", "allow", "speaker is registered");
      return ctx.actorKnown
        ? v("actor.known", "allow", "speaker is registered")
        : v("actor.known", "deny", "actor not found");
    },
  },
  {
    id: "ledger.safe_balance",
    evaluate: (ctx) => {
      if (ctx.balancesSafe === undefined) return v("ledger.safe_balance", "allow", "not a dest-overflow journal");
      return ctx.balancesSafe
        ? v("ledger.safe_balance", "allow", "resulting books stay safe integers")
        : v("ledger.safe_balance", "deny", "resulting balance is not a safe integer");
    },
  },
  {
    id: "actor.system_scope",
    evaluate: (ctx) => {
      if (ctx.systemOk === undefined) return v("actor.system_scope", "allow", "speaker is not system");
      return ctx.systemOk
        ? v("actor.system_scope", "allow", "system may bootstrap or read")
        : v("actor.system_scope", "deny", "system cannot run this command");
    },
  },
  {
    id: "ledger.operating_book",
    evaluate: (ctx) => {
      if (ctx.operatingBooksOk === undefined) {
        return v("ledger.operating_book", "allow", "not a transfer of non-operating books");
      }
      return ctx.operatingBooksOk
        ? v("ledger.operating_book", "allow", "both books are operating cash")
        : v("ledger.operating_book", "deny", "transfer is not against operating cash");
    },
  },
  {
    id: "ladder.birth_rung",
    evaluate: (ctx) => {
      if (ctx.birthRungOk === undefined) return v("ladder.birth_rung", "allow", "not a register");
      return ctx.birthRungOk
        ? v("ladder.birth_rung", "allow", "birth rung is L0–L4")
        : v("ladder.birth_rung", "deny", "L5 is not a birthright");
    },
  },
  {
    id: "kya.mint_fresh",
    evaluate: (ctx) => {
      if (ctx.kyaMintFresh === undefined) return v("kya.mint_fresh", "allow", "not a handshake mint");
      return ctx.kyaMintFresh
        ? v("kya.mint_fresh", "allow", "handshake expires after now")
        : v("kya.mint_fresh", "deny", "handshake would be born expired");
    },
  },
  {
    id: "kya.mint_window",
    evaluate: (ctx) => {
      if (ctx.kyaMintWindowOk === undefined) return v("kya.mint_window", "allow", "not a handshake mint");
      return ctx.kyaMintWindowOk
        ? v("kya.mint_window", "allow", "handshake expires within one year")
        : v("kya.mint_window", "deny", "handshake would outlive one year");
    },
  },
  {
    id: "mandate.window_fresh",
    evaluate: (ctx) => {
      if (ctx.windowMintFresh === undefined) return v("mandate.window_fresh", "allow", "not a windowed mint");
      return ctx.windowMintFresh
        ? v("mandate.window_fresh", "allow", "execution window can still open")
        : v("mandate.window_fresh", "deny", "execution window already closed");
    },
  },
  {
    id: "mandate.window_reach",
    evaluate: (ctx) => {
      if (ctx.windowReachOk === undefined) return v("mandate.window_reach", "allow", "not a windowed mint");
      return ctx.windowReachOk
        ? v("mandate.window_reach", "allow", "execution window opens while the slip lives")
        : v("mandate.window_reach", "deny", "execution window opens after the slip dies");
    },
  },
  {
    id: "mandate.occurrence_fresh",
    evaluate: (ctx) => {
      if (ctx.occurrenceMintOk === undefined) return v("mandate.occurrence_fresh", "allow", "not a recurrence mint");
      return ctx.occurrenceMintOk
        ? v("mandate.occurrence_fresh", "allow", "cadence still has a first slot")
        : v("mandate.occurrence_fresh", "deny", "cadence already exhausted at mint");
    },
  },
  {
    id: "mandate.parent_fresh",
    evaluate: (ctx) => {
      if (ctx.parentFresh === undefined) return v("mandate.parent_fresh", "allow", "not a parented mint or spend");
      return ctx.parentFresh
        ? v("mandate.parent_fresh", "allow", "parent intent still lives")
        : v("mandate.parent_fresh", "deny", "parent intent expired");
    },
  },
  {
    id: "kya.parent_fresh",
    evaluate: (ctx) => {
      if (ctx.kyaParentFresh === undefined) return v("kya.parent_fresh", "allow", "not a nested hop with a known parent");
      return ctx.kyaParentFresh
        ? v("kya.parent_fresh", "allow", "parent hop still lives")
        : v("kya.parent_fresh", "deny", "parent hop is not live");
    },
  },
  {
    id: "market.fx_fresh",
    evaluate: (ctx) => {
      if (ctx.fxMintFresh === undefined) return v("market.fx_fresh", "allow", "not an FX window mint");
      return ctx.fxMintFresh
        ? v("market.fx_fresh", "allow", "FX window still open at mint")
        : v("market.fx_fresh", "deny", "FX window already closed");
    },
  },
  {
    id: "host.not_hosted",
    evaluate: (ctx) => {
      if (ctx.hostedOk === undefined) return v("host.not_hosted", "allow", "not a host subscribe");
      return ctx.hostedOk
        ? v("host.not_hosted", "allow", "this instance is a hosted operator")
        : v("host.not_hosted", "deny", "this instance is the public kernel");
    },
  },
  {
    id: "host.human_authority",
    evaluate: (ctx) => {
      if (ctx.hostIssuerOk === undefined) return v("host.human_authority", "allow", "not a hosted subscribe with intent");
      return ctx.hostIssuerOk
        ? v("host.human_authority", "allow", "intent issuer is human or treasury")
        : v("host.human_authority", "deny", "intent issuer is not human or treasury");
    },
  },
  {
    id: "host.unique_subscriber",
    evaluate: (ctx) => {
      if (ctx.subscribeUnique === undefined) {
        return v("host.unique_subscriber", "allow", "not a hosted subscribe with intent");
      }
      return ctx.subscribeUnique
        ? v("host.unique_subscriber", "allow", "subscriber is free")
        : v("host.unique_subscriber", "deny", "subscriber already bound");
    },
  },
  {
    id: "identity.party",
    evaluate: (ctx) => {
      if (ctx.identityPartyOk === undefined) return v("identity.party", "allow", "not a rotate");
      return ctx.identityPartyOk
        ? v("identity.party", "allow", "actor is the named agent or a kill-switch role")
        : v("identity.party", "deny", "actor is not the named agent");
    },
  },
  {
    id: "market.party",
    evaluate: (ctx) => {
      if (ctx.marketPartyOk === undefined) return v("market.party", "allow", "not a withdraw");
      return ctx.marketPartyOk
        ? v("market.party", "allow", "actor is the named seller or a kill-switch role")
        : v("market.party", "deny", "actor is not the named seller");
    },
  },
  {
    id: "mandate.party",
    evaluate: (ctx) => {
      if (ctx.mandatePartyOk === undefined) return v("mandate.party", "allow", "not a revoke");
      return ctx.mandatePartyOk
        ? v("mandate.party", "allow", "actor is the named issuer or a kill-switch role")
        : v("mandate.party", "deny", "actor is not the named issuer");
    },
  },
  {
    id: "market.rfq_party",
    evaluate: (ctx) => {
      if (ctx.rfqPartyOk === undefined) return v("market.rfq_party", "allow", "not a close");
      return ctx.rfqPartyOk
        ? v("market.rfq_party", "allow", "actor is the named buyer or a kill-switch role")
        : v("market.rfq_party", "deny", "actor is not the named buyer");
    },
  },
  {
    id: "mandate.cart_party",
    evaluate: (ctx) => {
      if (ctx.cartPartyOk === undefined) return v("mandate.cart_party", "allow", "not a dump");
      return ctx.cartPartyOk
        ? v("mandate.cart_party", "allow", "actor is the named merchant, hire buyer, intent subject, or a kill-switch role")
        : v("mandate.cart_party", "deny", "actor is not the named merchant or hire buyer");
    },
  },
  {
    id: "mandate.payment_party",
    evaluate: (ctx) => {
      if (ctx.paymentPartyOk === undefined) return v("mandate.payment_party", "allow", "not a spike");
      return ctx.paymentPartyOk
        ? v("mandate.payment_party", "allow", "actor is the named signer, payee, hire buyer, intent subject, or a kill-switch role")
        : v("mandate.payment_party", "deny", "actor is not the named signer or payee");
    },
  },
  {
    id: "mandate.cadence_reach",
    evaluate: (ctx) => {
      if (ctx.cadenceReachOk === undefined) return v("mandate.cadence_reach", "allow", "not a cadence mint");
      return ctx.cadenceReachOk
        ? v("mandate.cadence_reach", "allow", "next slot opens while the slip lives")
        : v("mandate.cadence_reach", "deny", "next slot opens after the slip dies");
    },
  },
  {
    id: "mandate.range_fresh",
    evaluate: (ctx) => {
      if (ctx.rangeMintOk === undefined) return v("mandate.range_fresh", "allow", "not a range mint");
      return ctx.rangeMintOk
        ? v("mandate.range_fresh", "allow", "amount_range can still admit an amount")
        : v("mandate.range_fresh", "deny", "amount_range min exceeds max");
    },
  },
  {
    id: "mandate.budget_fresh",
    evaluate: (ctx) => {
      if (ctx.budgetMintOk === undefined) return v("mandate.budget_fresh", "allow", "not a budget mint");
      return ctx.budgetMintOk
        ? v("mandate.budget_fresh", "allow", "budget can still admit an amount the lid would allow")
        : v("mandate.budget_fresh", "deny", "budget cannot admit an amount the lid would allow");
    },
  },
  {
    id: "mandate.currency_fresh",
    evaluate: (ctx) => {
      if (ctx.currencyMintOk === undefined) return v("mandate.currency_fresh", "allow", "not a paired money mint");
      return ctx.currencyMintOk
        ? v("mandate.currency_fresh", "allow", "lid and coffer name the same currency")
        : v("mandate.currency_fresh", "deny", "lid and coffer name different currencies");
    },
  },
  {
    id: "mandate.lid_fresh",
    evaluate: (ctx) => {
      if (ctx.lidMintOk === undefined) return v("mandate.lid_fresh", "allow", "not a lid mint");
      return ctx.lidMintOk
        ? v("mandate.lid_fresh", "allow", "amount_range can still admit a positive hire")
        : v("mandate.lid_fresh", "deny", "amount_range max cannot admit a positive hire");
    },
  },
  {
    id: "mandate.cap_fresh",
    evaluate: (ctx) => {
      if (ctx.capMintOk === undefined) return v("mandate.cap_fresh", "allow", "not a cap mint");
      return ctx.capMintOk
        ? v("mandate.cap_fresh", "allow", "subject's live rung is at or below the cap")
        : v("mandate.cap_fresh", "deny", "subject's live rung is above the cap");
    },
  },
  {
    id: "kya.grant_fresh",
    evaluate: (ctx) => {
      if (ctx.grantMintOk === undefined) return v("kya.grant_fresh", "allow", "not a grant mint");
      return ctx.grantMintOk
        ? v("kya.grant_fresh", "allow", "delegate's live rung is at or below the grant")
        : v("kya.grant_fresh", "deny", "delegate's live rung is above the grant");
    },
  },
  {
    id: "kya.nest_tighter",
    evaluate: (ctx) => {
      if (ctx.nestTighterOk === undefined) return v("kya.nest_tighter", "allow", "not a nested grant mint");
      return ctx.nestTighterOk
        ? v("kya.nest_tighter", "allow", "nested grant is at or below the parent hop")
        : v("kya.nest_tighter", "deny", "nested grant is wider than the parent hop");
    },
  },
  {
    id: "kya.path_tighter",
    evaluate: (ctx) => {
      if (ctx.pathTighterOk === undefined) return v("kya.path_tighter", "allow", "not a path grant mint");
      return ctx.pathTighterOk
        ? v("kya.path_tighter", "allow", "path grant is at or below the incoming hop")
        : v("kya.path_tighter", "deny", "path grant is wider than the incoming hop");
    },
  },
  {
    id: "kya.path_live",
    evaluate: (ctx) => {
      if (ctx.pathLiveOk === undefined) return v("kya.path_live", "allow", "not an orphan hop mint");
      return ctx.pathLiveOk
        ? v("kya.path_live", "allow", "speaker has a live incoming hop")
        : v("kya.path_live", "deny", "speaker has no live incoming hop");
    },
  },
  {
    id: "mandate.child_currency",
    evaluate: (ctx) => {
      if (ctx.childCurrencyOk === undefined) return v("mandate.child_currency", "allow", "not a nested currency mint");
      return ctx.childCurrencyOk
        ? v("mandate.child_currency", "allow", "nested lid and coffer name the parent's currency")
        : v("mandate.child_currency", "deny", "nested lid or coffer names a different currency than the parent");
    },
  },
  {
    id: "market.payout_fresh",
    evaluate: (ctx) => {
      if (ctx.fxPayoutOk === undefined) return v("market.payout_fresh", "allow", "not an FX payout mint");
      return ctx.fxPayoutOk
        ? v("market.payout_fresh", "allow", "FX floor payout is a positive amount")
        : v("market.payout_fresh", "deny", "FX floor payout is zero");
    },
  },
  {
    id: "market.fx_party",
    evaluate: (ctx) => {
      if (ctx.fxPartyOk === undefined) return v("market.fx_party", "allow", "not an FX party mint");
      return ctx.fxPartyOk
        ? v("market.fx_party", "allow", "speaker is the market maker, or no maker sits")
        : v("market.fx_party", "deny", "speaker is not the market maker");
    },
  },
  {
    id: "market.rate_fresh",
    evaluate: (ctx) => {
      if (ctx.fxBandOk === undefined) return v("market.rate_fresh", "allow", "not an FX rate mint");
      return ctx.fxBandOk
        ? v("market.rate_fresh", "allow", "FX rate is inside the 200bps band")
        : v("market.rate_fresh", "deny", "FX rate is outside the 200bps band");
    },
  },
  {
    id: "kya.nest_party",
    evaluate: (ctx) => {
      if (ctx.nestPartyOk === undefined) return v("kya.nest_party", "allow", "not a nested hop mint");
      return ctx.nestPartyOk
        ? v("kya.nest_party", "allow", "nested hop names the parent's principal")
        : v("kya.nest_party", "deny", "nested hop is under another principal");
    },
  },
  {
    id: "mandate.checkout_party",
    evaluate: (ctx) => {
      if (ctx.checkoutPartyOk === undefined) return v("mandate.checkout_party", "allow", "not a checkout mint");
      return ctx.checkoutPartyOk
        ? v("mandate.checkout_party", "allow", "speaker is the hire buyer, intent subject, or a kill-switch role")
        : v("mandate.checkout_party", "deny", "speaker is not the hire buyer");
    },
  },
  {
    id: "hire.room_party",
    evaluate: (ctx) => {
      if (ctx.hireRoomPartyOk === undefined) return v("hire.room_party", "allow", "not a room hire");
      return ctx.hireRoomPartyOk
        ? v("hire.room_party", "allow", "speaker is the named buyer or a kill-switch role")
        : v("hire.room_party", "deny", "speaker is not the named buyer");
    },
  },
  {
    id: "hire.slip_party",
    evaluate: (ctx) => {
      if (ctx.hireSlipPartyOk === undefined) return v("hire.slip_party", "allow", "not a slip hire");
      return ctx.hireSlipPartyOk
        ? v("hire.slip_party", "allow", "speaker is the named subject or a kill-switch role")
        : v("hire.slip_party", "deny", "speaker is not the named subject");
    },
  },
  {
    id: "mandate.child_party",
    evaluate: (ctx) => {
      if (ctx.childPartyOk === undefined) return v("mandate.child_party", "allow", "not a nested slip");
      return ctx.childPartyOk
        ? v("mandate.child_party", "allow", "speaker is the parent subject, issuer, or a kill-switch role")
        : v("mandate.child_party", "deny", "speaker is not the parent subject or issuer");
    },
  },
  {
    id: "mandate.root_party",
    evaluate: (ctx) => {
      if (ctx.rootPartyOk === undefined) return v("mandate.root_party", "allow", "not a root slip");
      return ctx.rootPartyOk
        ? v("mandate.root_party", "allow", "speaker is the named subject or a kill-switch role")
        : v("mandate.root_party", "deny", "speaker is not the named subject");
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
  "human.signature_present": {
    kind: "none",
    hint: "L0/L1 envelope.submit needs a human_operator payment JWS. A grown-up pause does not wink a junior signature. Climb to L2 to self-sign, or have a human sign the payment. Completing funded work is legal via hire.release. A vendor pull stays mandate.subject_is_actor. An auditor stays actor.role_capability.",
  },
  "payment.amount_range": ISSUE_INTENT,
  "payment.budget": ISSUE_INTENT,
  "payment.parent_budget": ISSUE_INTENT,
  "mandate.child_tighter": ISSUE_INTENT,
  "payment.allowed_payees": ISSUE_INTENT,
  "payment.allowed_payment_instruments": ISSUE_INTENT,
  "payment.reference": {
    kind: "issue_intent",
    commandType: "mandate.issue_intent",
    hint: "Cite a funded check's transaction_id (the cart hash), or omit the constraint until a check exists. Completing funded work is legal. A listed payee, a listed rail, and a listed SKU are different objects. Before any funded payment, the constraint is still AP2-shaped catalog surface.",
  },
  "payment.allowed_skus": ISSUE_INTENT,
  "ladder.max_autonomy_constraint": {
    kind: "issue_intent",
    commandType: "mandate.issue_intent",
    hint: "This slip’s max autonomy is below the actor’s rung. Completing a funded hire after a climb is legal; a new hire is not. Issue a new slip, or demote.",
  },
  "ladder.min_level": {
    kind: "none",
    hint: "Issuing a sub-intent is L4. A junior desk cannot mint a nested slip. A grown-up ticket does not waive that verb. Climb with ladder.set, then issue. Completing funded work is legal. A skipped rung stays ladder.legal. A handshake ceiling stays kya.capability_subset. A wider child stays mandate.child_tighter. Nesting under someone else's parent stays mandate.child_party. Minting a root in someone else's name stays mandate.root_party.",
  },
  "circuit.daily": {
    kind: "reset_circuit",
    commandType: "circuit.reset",
    hint: "Daily fuse is sticky. A human or treasury must reset it. Mandate budgets are unchanged.",
  },
  "kya.chain_intact": {
    kind: "attest_kya",
    commandType: "kya.attest",
    hint: "No live handshake from the principal. Attest, or stop. Revoke is a tombstone. An expired hop stays kya.attestation_fresh. A nested parent stays kya.parent_fresh. A frozen speaker stays actor.not_frozen. A frozen principal stays kya.principal_not_frozen. A ghost revoke stays kya.known_attestation. Completing funded work after expiry is legal; freeze and revoke still bind.",
  },
  "kya.delegation_depth": {
    kind: "none",
    hint: "Hop count > 3 is a refuse. Shorten the chain. A missing path stays kya.chain_intact. A dead parent hop stays kya.parent_fresh. A climb stays kya.capability_subset. Completing funded work is legal. A nested parentId under the same grantor does not add hops.",
  },
  "kya.principal_not_frozen": {
    kind: "unfreeze_principal",
    commandType: "identity.unfreeze",
    hint: "The money’s owner is frozen. Unfreeze the principal, not only the delegate. A frozen speaker stays actor.not_frozen. A revoked hop stays kya.chain_intact. A no-op thaw stays identity.freeze_state. Completing funded work after expiry is legal; freeze and revoke still bind.",
  },
  "kya.attestation_fresh": {
    kind: "attest_kya",
    commandType: "kya.attest",
    hint: "The handshake expired. Revoke it, then attest again. A dead hop still occupies the pair. A new hop cannot be born expired. Completing a funded hire after expiry is legal; freeze and revoke still bind.",
  },
  "kya.capability_subset": {
    kind: "none",
    hint: "Omitted maxAutonomy is L5. An agent may not grant a standing-mandate ceiling above its own rung, or spend above the handshake ceiling. Name a ceiling you hold. A human or treasury may grant L5. Completing a funded hire after a climb is legal; freeze and revoke still bind. A grant below the desk is kya.grant_fresh.",
  },
  "market.known_sku": {
    kind: "none",
    hint: "This is not a storefront. Only catalog SKUs can be hired. Read market.catalog. A listed SKU not on the slip stays payment.allowed_skus. Completing funded work is legal. A ghost SKU is not a catalog good.",
  },
  "market.not_expired": {
    kind: "none",
    hint: "RFQ or quote is stale. Issue a new RFQ and get a fresh quote. Do not hire on a dead price.",
  },
  "market.invited_seller": {
    kind: "none",
    hint: "This RFQ named its sellers. Only invitedSellerIds may quote. An empty invite list is an open RFQ. A vendor conversion while a maker sits is market.fx_party.",
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
    hint: "That RFQ or quote id is unknown. Issue a real RFQ, then quote it. A missing room is not a missing SKU. A closed guest list stays market.invited_seller. Completing funded work is legal.",
  },
  "market.fx_quote": {
    kind: "none",
    hint: "An FX quote is a one-shot window. A research quote is not a conversion. A missing quote, a spent quote, or a quote held by an open hire ticket is not a second settle. Hiring the window stays hire.not_fx. A missing window on quote stays market.fx_window.",
  },
  "hire.quote_unspent": {
    kind: "none",
    hint: "That quote already produced a hire, an FX settle, or is held by an open approval ticket. A price promise is used once. A deny does not consume it. Reject or wait for expiry to release a reservation. A void does not restore it.",
  },
  "hire.known": {
    kind: "none",
    hint: "That hire id is not in this world. Create the hire first. A missing contract is not a broken mandate chain. A stranger on a live hire stays hire.party. Unfunded work stays hire.escrow_required. Completing funded work is legal.",
  },
  "mandate.known_intent": {
    kind: "none",
    hint: "That intent id is not in this world. Issue a real permission slip first. A missing slip is not a missing handshake. A missing handshake stays kya.chain_intact. A dead parent stays mandate.parent_fresh. Wearing someone else's unused slip stays hire.slip_party. Completing funded work is legal.",
  },
  "mandate.known_cart": {
    kind: "none",
    hint: "That cart id is not in this world. Issue the cart first. A missing cart is not a broken payment chain. Occupancy stays mandate.unique_payment. A dead cart at fund stays mandate.chain_integrity. Completing funded work is legal.",
  },
  "mandate.known_payment": {
    kind: "none",
    hint: "That payment id is not in this world. Issue the payment first. A missing check is not a broken payment chain. Occupancy stays mandate.unique_payment. A dead cart at fund stays mandate.chain_integrity. Completing funded work is legal.",
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
    hint: "That parentId is not in this world. Issue the parent slip first. A missing parent is not a tighter child. A dead parent stays mandate.parent_fresh. Nesting under someone else's parent stays mandate.child_party. Completing funded work is legal.",
  },
  "identity.known": {
    kind: "none",
    hint: "That agent id is not in this world. Register them first. A missing agent is not a freeze, a handshake, a merchant, a permission-slip subject, a revoke target, or an RFQ guest. Minting a root in someone else's name stays mandate.root_party.",
  },
  "hire.escrow_required": {
    kind: "none",
    hint: "Escrow must be funded before the vendor delivers. Offered or accepted is not funded. Completing funded work is legal. Unfunded work is not a delivery. Release before deliver stays hire.state.",
  },
  "hire.state": {
    kind: "none",
    hint: "A hire only walks offered → accepted → funded → delivered → released. Void is offered or accepted, before escrow moves. Refund is only from funded. Release is only after deliver. Payment-required is only after deliver. An illegal arrow is a refuse. A void is not a refund. Delivered work cannot be unwound. Unfinished work is not a payout. Unfunded work is not a delivery.",
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
  "payment.currency_match": {
    kind: "none",
    hint: "The cart or payment is not this hire’s currency. A USDC sticker is not a USD hire. Convert with market.fx_settle. A mixed journal stays ledger.same_currency. A USDC quote stays market.sku_currency. A loose USD pointer stays hire.bound_cart. A cheaper cart stays hire.cart_matches.",
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
    hint: "You can only mint or tombstone a handshake for which you are the principal. A human or treasury may revoke any pair. An L4 scout cannot write a founder’s handshake by filling in the ids. Someone else’s name is not a handshake.",
  },
  "identity.unique_key": {
    kind: "none",
    hint: "That runtime alias (or its USD/USDC operating book) is already taken. Pick a free key. Two agents cannot share one operating book. Same-body retries still replay.",
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
    hint: "That principal already has a live handshake with this delegate. Revoke it, then attest again. A second live hop is not a tighter grant. A grant below the desk is kya.grant_fresh. A nested grant wider than its parent is kya.nest_tighter. A grant wider than the incoming hop is kya.path_tighter.",
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
    hint: "An FX SKU is a conversion window. Attach fx.from/to/rateE6/validUntil. Settle with market.fx_settle. It is not a hireable good. A missing window is not a quote. Ghost SKU stays market.known_sku. A swapped pair stays market.fx_pair. A corpse mint stays market.fx_fresh.",
  },
  "hire.bound_cart": {
    kind: "none",
    hint: "That hire has not bound a cart (and that cart’s payment). Issue the cart with hireId, then the payment. Passing cartId on fund is not a pointer. A loose cart is not this hire’s check.",
  },
  "mandate.chain_integrity": {
    kind: "none",
    hint: "The cart or payment window has closed, or the chain hashes no longer verify. Completing a funded hire after that is legal; a new fund is not. Occupancy stays hire.bound_cart. Issue a live cart.",
  },
  "mandate.subject_is_actor": {
    kind: "none",
    hint: "This permission slip names a different subject. The speaker is not that agent. A live chain is not a shared checkbook. Party TAP is who sits on the hire. Name TAP is whose name a handshake is in. Seat TAP is a hosted subscribe row. Wearing someone else's unused slip at hire.create stays hire.slip_party.",
  },
  "mm.known": {
    kind: "none",
    hint: "There is no market maker (or their USD/USDC books) in this world. Register a market_maker before settling FX. A window is not a journal against missing books.",
  },
  "mm.spread_bound": {
    kind: "none",
    hint: "The nested fx.rateE6 is the stored rate. It must sit inside the 200bps band (980000–1020000). A top-level rateE6 is not the band. A vendor conversion while a maker sits is market.fx_party. An empty pit does not waive the band — that is market.rate_fresh.",
  },
  "mm.inventory": {
    kind: "none",
    hint: "The market maker’s USDC book does not cover this payout. Restock inventory, or settle a smaller window. Empty MM USDC is not a missing maker, not a vendor overdraft, and not the 200bps band. A deny does not consume the window.",
  },
  "actor.known": {
    kind: "none",
    hint: "That actorId is not in this world. Register them first. A missing speaker is not a 500. identity.known is for named targets, not the speaker.",
  },
  "ledger.safe_balance": {
    kind: "none",
    hint: "That book cannot hold this many more cents. IEEE rounding is not a mint. Split the journal or drain the dest first. Command amounts that are already unsafe integers are command.malformed.",
  },
  "actor.system_scope": {
    kind: "none",
    hint: "System is the runtime, not a treasurer. It may bootstrap the first human and read the catalog, the notary, balances, and receipts. Name a registered actor to spend, freeze, or mint further agents.",
  },
  "ledger.operating_book": {
    kind: "none",
    hint: "A transfer moves operating cash. Equity is not a source — opening cash is seedOpening. Escrow moves through hire.fund / refund / release. A transfer cannot mint, burn, or pick the escrow lock.",
  },
  "ladder.birth_rung": {
    kind: "none",
    hint: "L5 is not a birthright. Register at L0–L4, then climb with ladder.set after a freeze that was actually tested. Listing the gate names is not the test.",
  },
  "kya.mint_fresh": {
    kind: "none",
    hint: "A handshake cannot be born dead. Name an expiresAt strictly after now, or omit it for one year. An unparseable Instant is not a window. Ghost, self, party, a second live hop, and an over-grant keep first deny. A grant below the desk is kya.grant_fresh.",
  },
  "kya.mint_window": {
    kind: "none",
    hint: "A handshake cannot outlive one year. Omit expiresAt for that ceiling, or name a sooner Instant. Year 9999 is not standing identity. A corpse mint stays kya.mint_fresh. A grant below the desk is kya.grant_fresh.",
  },
  "mandate.window_fresh": {
    kind: "none",
    hint: "A slip cannot be born with a closed calendar. Name a not_after after now, or omit the window. An inverted or unparseable Instant is not a window. A window that opens after the slip dies is mandate.window_reach. Ghost subject, missing parent, and a wider child keep first deny. Hire still names payment.execution_date.",
  },
  "mandate.window_reach": {
    kind: "none",
    hint: "A slip lives seven days. A not_before at or after that exp never opens. Name an earlier Instant, or omit not_before. A closed calendar stays mandate.window_fresh.",
  },
  "mandate.occurrence_fresh": {
    kind: "none",
    hint: "A slip cannot be born with a cadence that has no slots. Name max_occurrences of at least one, or omit the cap. A non-number is not a cap. Ghost subject, missing parent, and a wider child keep first deny. Hire still names payment.recurrence. A week that cannot admit a second hire is mandate.cadence_reach.",
  },
  "mandate.cadence_reach": {
    kind: "none",
    hint: "A slip lives seven days. WEEKLY and MONTHLY cannot admit a second hire before that exp. Name DAILY, a one-shot WEEKLY (max_occurrences 1), or omit recurrence. A vacant cap stays mandate.occurrence_fresh. Hire still names payment.recurrence. A floor above the lid is mandate.range_fresh.",
  },
  "mandate.range_fresh": {
    kind: "none",
    hint: "A slip cannot be born with an amount_range whose min exceeds max. Name min ≤ max, omit min, or name an exact band (min === max). Hire still names payment.amount_range. A vacant cap stays mandate.occurrence_fresh. A week that cannot admit a second hire stays mandate.cadence_reach. Lid TAP is hire-time max. A closed hatch is mandate.lid_fresh. A closed coffer is mandate.budget_fresh.",
  },
  "mandate.budget_fresh": {
    kind: "none",
    hint: "A slip cannot be born with a payment.budget that cannot admit an amount the lid would allow. Name max > 0, and if a floor is named, max ≥ min. Hire still names payment.budget. A floor above the lid stays mandate.range_fresh. A vacant cap stays mandate.occurrence_fresh. Purse TAP is hire-time envelope. A mixed envelope is mandate.currency_fresh.",
  },
  "mandate.currency_fresh": {
    kind: "none",
    hint: "A slip cannot be born with an amount_range and a payment.budget in different currencies. Name the same currency on both, or omit one. Hire still names payment.currency_match. A closed coffer stays mandate.budget_fresh. A floor above the lid stays mandate.range_fresh. A closed hatch is mandate.lid_fresh. Mix TAP is a mixed journal. Ink TAP is cart vs hire. A nested child in a different currency is mandate.child_currency.",
  },
  "mandate.lid_fresh": {
    kind: "none",
    hint: "A slip cannot be born with an amount_range whose max cannot admit a positive hire. Name max > 0, or omit the range. Hire still names payment.amount_range. A floor above the lid stays mandate.range_fresh. A vacant cap stays mandate.occurrence_fresh. Lid TAP is hire-time max. A closed coffer is mandate.budget_fresh. A mixed envelope is mandate.currency_fresh. A cap below the desk is mandate.cap_fresh.",
  },
  "mandate.cap_fresh": {
    kind: "none",
    hint: "A slip cannot be born with an aether.max_autonomy below the named subject's live rung. Name max ≥ that rung, or omit the cap. Hire still names ladder.max_autonomy_constraint. A closed hatch stays mandate.lid_fresh. Ceiling TAP is a climb after mint. Grade TAP is a junior nested mint. Rung TAP is a skipped climb. A grant below the desk is kya.grant_fresh.",
  },
  "kya.grant_fresh": {
    kind: "none",
    hint: "A handshake cannot be born with a maxAutonomy below the named delegate's live rung. Name max ≥ that rung, or omit the ceiling. Hire still names kya.capability_subset. A corpse mint stays kya.mint_fresh. A century mint stays kya.mint_window. A second live hop stays kya.unique_live. Climb TAP is a climb after mint. Eave TAP is a slip cap below the desk. A nested grant wider than its parent is kya.nest_tighter. A grant wider than the incoming hop is kya.path_tighter.",
  },
  "kya.nest_tighter": {
    kind: "none",
    hint: "A nested handshake cannot be born wider than its parent hop. Name max ≤ the parent's maxAutonomy, or omit only when the parent is already L5. Hire still names kya.capability_subset. A grant below the desk stays kya.grant_fresh. A dead parent stays kya.parent_fresh. A ghost parent stays kya.known_parent. A second live hop stays kya.unique_live. An agent over-grant stays kya.capability_subset. Mandate child_tighter is a nested slip, not a nested hop. A grant wider than the incoming hop is kya.path_tighter. A nested hop under another principal is kya.nest_party.",
  },
  "kya.path_tighter": {
    kind: "none",
    hint: "A handshake in another principal's name cannot be born wider than the speaker's live incoming hop from that principal. Name max ≤ that hop's maxAutonomy, or omit only when the incoming hop is already L5. Hire still names kya.capability_subset. A nested grant wider than its parent stays kya.nest_tighter. A grant below the desk stays kya.grant_fresh. An agent over-grant stays kya.capability_subset. Well TAP equal hops still mint. A speaker granting in their own name is not this deny. An orphan hop is kya.path_live.",
  },
  "kya.path_live": {
    kind: "none",
    hint: "A handshake in another principal's name cannot be born without a live incoming hop from that principal. Attest the speaker under that principal, then nest. Speaker granting in their own name is not this deny. Ghost principal stays identity.known. An agent filling in another principal's id stays kya.party. A grant wider than a live incoming hop stays kya.path_tighter. A nested grant wider than its parent stays kya.nest_tighter. A grant below the desk stays kya.grant_fresh. A dead parentId stays kya.parent_fresh. A nested hop under another principal is kya.nest_party.",
  },
  "mandate.child_currency": {
    kind: "none",
    hint: "A nested slip cannot be born in a different currency than its parent. Name the parent's currency on the child's amount_range and payment.budget, or omit a constraint the parent also omitted. Same-slip lid vs coffer stays mandate.currency_fresh. A wider nested slip stays mandate.child_tighter. Nesting under someone else's parent stays mandate.child_party. Matching USD still mints. Matching USDC still mints. Hire still names payment.currency_match. Ink TAP is cart vs hire. Mix TAP is a mixed journal. Clash TAP is a mixed envelope.",
  },
  "mandate.parent_fresh": {
    kind: "issue_intent",
    commandType: "mandate.issue_intent",
    hint: "A dead parent is not a parent. Issue a new parent slip, then a tighter child. Completing a funded hire after the parent dies is legal. Ghost parent stays mandate.known_parent. Nesting under someone else's parent stays mandate.child_party. The child's own expiry stays mandate.not_expired.",
  },
  "kya.parent_fresh": {
    kind: "none",
    hint: "A dead parent hop is not a parent. Attest a live parent, then nest. A new hire or fund against a nested hop whose parent died is a refuse. Completing a funded hire after that is legal. Ghost parent stays kya.known_parent. A nested grant wider than its parent stays kya.nest_tighter. A grant wider than the incoming hop stays kya.path_tighter. Unique_live, mint_fresh, mint_window, party, not_self, and an over-grant keep first deny.",
  },
  "market.fx_fresh": {
    kind: "none",
    hint: "An FX window cannot be born dead. Name a validUntil strictly after now. An unparseable Instant is not a window. Settle of a window that lapses after mint stays market.not_expired. Ghost RFQ stays market.known_rfq. A missing window stays market.fx_window. A swapped pair stays market.fx_pair. A conversion that pays nothing is market.payout_fresh. A vendor conversion while a maker sits is market.fx_party.",
  },
  "market.payout_fresh": {
    kind: "none",
    hint: "An FX window cannot be born with a floor payout of 0. Name a from-amount whose floor(from * rateE6 / 1e6) is at least 1 cent, or a higher in-band rate. A 1-cent window at the low band is not a conversion. A 0-cent window is not a conversion. A 2-cent window at the low band still mints. A 1-cent window at par still mints. A 200bps miss stays mm.spread_bound. A dead window stays market.fx_fresh. A swapped pair stays market.fx_pair. A missing window stays market.fx_window. Ghost RFQ stays market.known_rfq. A vendor conversion while a maker sits is market.fx_party. An empty pit does not waive the band — that is market.rate_fresh.",
  },
  "market.fx_party": {
    kind: "none",
    hint: "A vendor cannot mint an FX window while a market maker sits. Have the maker quote. Quoting FX with no maker on the pit is not this deny — settle stays mm.known. A closed guest list stays market.invited_seller. A 200bps miss stays mm.spread_bound. A conversion that pays nothing stays market.payout_fresh. A dead window stays market.fx_fresh. A swapped pair stays market.fx_pair. A missing window stays market.fx_window. Ghost RFQ stays market.known_rfq. A research quote with no fx is not this deny. An empty pit does not waive the band — that is market.rate_fresh.",
  },
  "market.rate_fresh": {
    kind: "none",
    hint: "An FX window cannot be born outside the 200bps band, even when no market maker sits. Name a nested rateE6 inside 980000–1020000. A maker's own off-band quote stays mm.spread_bound. A vendor conversion while a maker sits stays market.fx_party. A conversion that pays nothing stays market.payout_fresh. A dead window stays market.fx_fresh. A swapped pair stays market.fx_pair. A missing window stays market.fx_window. Ghost RFQ stays market.known_rfq. An in-band guest quote with no maker still mints. The maker still mints in-band after sitting.",
  },
  "kya.nest_party": {
    kind: "none",
    hint: "A nested handshake cannot be born under another principal's parent hop. Nest under a hop in this principal's name, or omit parentId. A nested grant wider than its parent stays kya.nest_tighter. A dead parent stays kya.parent_fresh. A ghost parent stays kya.known_parent. An orphan hop stays kya.path_live. Whose name a handshake is in stays kya.party. A grant below the desk stays kya.grant_fresh. Speaker granting in their own name without parentId is not this deny. Exact same-principal nest still mints. A tighter same-principal nest still mints.",
  },
  "mandate.checkout_party": {
    kind: "none",
    hint: "Fill your own checkout, or ask a human or treasury. Someone else's cart is not yours to fill. A missing cart is mandate.known_cart. A missing hire is hire.known. A cheaper cart is hire.cart_matches. A second cart is hire.unique_cart. A second payment is mandate.unique_payment. Dumping someone else's cart is mandate.cart_party. Spiking someone else's check is mandate.payment_party. Completing funded work is legal. Buyer still fills its own checkout.",
  },
  "hire.room_party": {
    kind: "none",
    hint: "Hire from your own room, or ask a human or treasury. Someone else's quote is not yours to hire. A missing room is market.known_rfq. A spent quote is hire.quote_unspent. A shut or expired room is market.not_expired. An FX window is hire.not_fx. Shutting someone else's room is market.rfq_party. Folding someone else's bid is market.party. Wearing someone else's unused slip stays hire.slip_party. Completing funded work is legal. Buyer still hires its own quote.",
  },
  "hire.slip_party": {
    kind: "none",
    hint: "Hire against your own unused slip, or ask a human or treasury. Someone else's permission is not yours to wear. A missing slip is mandate.known_intent. A ripped unused slip is mandate.not_expired. Hiring from someone else's room is hire.room_party. Tearing someone else's unused slip is mandate.party. Fund and submit stay mandate.subject_is_actor. Completing funded work is legal. The named subject still hires.",
  },
  "mandate.child_party": {
    kind: "none",
    hint: "Nest under your own parent slip, or ask a human or treasury. Someone else's parent is not yours to hang a child on. A missing parent is mandate.known_parent. A dead parent is mandate.parent_fresh. A wider nested slip is mandate.child_tighter. A junior nested mint is ladder.min_level. A mixed nested currency is mandate.child_currency. Minting a root in someone else's name stays mandate.root_party. Completing funded work is legal. The parent subject still nests. Human/treasury still nest.",
  },
  "mandate.root_party": {
    kind: "none",
    hint: "Mint a root slip in your own name, or ask a human or treasury. Someone else's name is not a root slip to mint. A missing subject is identity.known. Nesting under someone else's parent is mandate.child_party. A junior root is ladder.min_level. A vendor root is actor.role_capability. Completing funded work is legal. The named subject still mints a self-root. Human/treasury still mint roots for a desk.",
  },
  "host.not_hosted": {
    kind: "none",
    hint: "This instance is the public kernel. Self-host is free. A hosted operator constructs Runtime({ hosted: true }) and records subscribe against a live human-issued intent. GitHub is not a checkout. Read host.card.",
  },
  "host.human_authority": {
    kind: "issue_intent",
    commandType: "mandate.issue_intent",
    hint: "Subscribe with a live intent issued by a human_operator or treasury. An agent-issued slip is not host authority. Ghost intent stays mandate.known_intent. An expired slip stays mandate.not_expired. The speaker must be the intent subject.",
  },
  "host.unique_subscriber": {
    kind: "none",
    hint: "This agent already has a subscription on this host. One subscriber, one row. Spend is not gated on the row.",
  },
  "identity.party": {
    kind: "none",
    hint: "Rotate your own key, or ask a human or treasury. Someone else's key is not yours to turn. A missing agent is identity.known. System is not a treasurer.",
  },
  "market.party": {
    kind: "none",
    hint: "Fold your own bid, or ask a human or treasury. Someone else's quote is not yours to pull. A missing quote is market.known_rfq. A spent quote is hire.quote_unspent. A folded quote is market.not_expired.",
  },
  "mandate.party": {
    kind: "none",
    hint: "Rip your own unused slip, or ask a human or treasury. Someone else's permission is not yours to tear. A missing slip is mandate.known_intent. A ripped unused slip is mandate.not_expired on a new hire. Wearing someone else's unused slip stays hire.slip_party. Completing funded work is legal.",
  },
  "market.rfq_party": {
    kind: "none",
    hint: "Shut your own room, or ask a human or treasury. Someone else's RFQ is not yours to close. A missing room is market.known_rfq. A shut room is market.not_expired on quote or hire.create. Hiring from someone else's room stays hire.room_party.",
  },
  "mandate.cart_party": {
    kind: "none",
    hint: "Dump your own unused checkout, or ask a human or treasury. Someone else's cart is not yours to dump. A missing cart is mandate.known_cart. A dumped unused cart is mandate.not_expired on a new payment. Bound is when a payment occupies it. Completing funded work is legal.",
  },
  "mandate.payment_party": {
    kind: "none",
    hint: "Spike your own unused check, or ask a human or treasury. Someone else's payment is not yours to spike. A missing payment is mandate.known_payment. A spiked unused payment is mandate.not_expired on fund. Funded is when escrow occupies it. Completing funded work is legal.",
  },
  "clearing.bilateral_limit": {
    kind: "none",
    commandType: "clearing.settle_window",
    hint: "This pair’s open gross would exceed the bilateral credit limit. Close a settlement window (not a second payment) or hire a smaller amount. Money already moved at escrow stays moved.",
  },
  "payment.execution_date": {
    kind: "none",
    hint: "This slip's calendar window is closed for new spends. Completing a funded hire is not a new spend. Issue a new intent if you need another hire.",
  },
  "mandate.not_expired": {
    kind: "none",
    hint: "That cart, payment, or slip window has closed. A ripped unused slip is this deny on a new hire. A dumped unused cart is this deny on a new payment. A spiked unused payment is this deny on fund. Bound dump is this deny, not a refund. Funded spike is this deny, not a refund. Issue a live cart. Completing a funded hire after that is legal. Occupancy stays mandate.unique_payment. A dead cart at fund stays mandate.chain_integrity. A missing cart stays mandate.known_cart. A missing payment stays mandate.known_payment.",
  },
};

export function remediationFor(decision: PolicyDecision): Remediation | undefined {
  if (decision.verdict === "escalate") {
    const rule = decision.trace.find((t) => t.verdict === "escalate");
    const next: Remediation = {
      kind: "wait_approval",
      ruleId: rule?.ruleId ?? "approval.threshold",
      commandType: "approval.resolve",
      hint: "Do not retry the spend. Resolve the approval ticket. Policy re-runs; the threshold and the hire/settle rung are waived. Caps, freeze, KYA, and nonce still bind.",
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
