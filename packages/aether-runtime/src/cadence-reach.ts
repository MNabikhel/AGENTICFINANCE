import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId, RecurrenceFrequency } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { WEEK_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface CadenceReachScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  sneak: { task: string };
  legal: { task: string };
  daily: { task: string };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface CadenceReachReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadCadenceReach(path: string): CadenceReachScenario {
  return JSON.parse(readFileSync(path, "utf8")) as CadenceReachScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

function allowedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  const decision = attempt.ok ? attempt.value.decision : attempt.error.decision;
  return decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "allow") === true;
}

function cadenceBody(
  founderId: string,
  deskId: string,
  payees: MandateConstraint,
  task: string,
  frequency: RecurrenceFrequency,
  max?: number,
) {
  const rec: MandateConstraint =
    max === undefined
      ? { type: "payment.agent_recurrence", frequency }
      : { type: "payment.agent_recurrence", frequency, max_occurrences: max };
  return cmd("mandate.issue_intent", founderId, {
    subjectId: deskId,
    task,
    constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }, payees, rec],
  });
}

export function runCadenceReach(scenario: CadenceReachScenario): CadenceReachReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = WEEK_TLDR;
  rt.analogDoc = analog();
  const must = mustDispatch;

  must(
    rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    ),
    "register founder",
  );
  const founder = rt.alias("ops-human");

  const roster = [
    { key: "treasury", displayName: "Treasury", role: "treasury", autonomyLevel: 3 },
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "research-vendor", displayName: "Research Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "auditor", displayName: "Auditor", role: "auditor", autonomyLevel: 0 },
  ] as const;

  for (const a of roster) {
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: a.key,
          displayName: a.displayName,
          role: a.role,
          autonomyLevel: a.autonomyLevel,
        }),
      ),
      `register ${a.key}`,
    );
  }

  rt.seedOpening(scenario.opening);

  const desk = rt.alias("desk");
  const vendor = rt.alias("research-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const price = scenario.quotes.hire!;

  const payees: MandateConstraint = {
    type: "payment.allowed_payees",
    allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
  };

  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.intent.task,
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "desk intent",
  );
  const intentId = (intent.data as { payload: { id: MandateId } }).payload.id;

  must(
    rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "desk:cash",
        amount: scenario.allocation,
      }),
    ),
    "fund desk",
  );

  const live = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a week is not a cadence on a seven-day slip",
    price,
    intentId,
  });
  const hired = must(live.attempt, "hire listed seller");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: price.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const sizeBeforeSneak = rt.intents.size;

  const sneak = rt.dispatch(cadenceBody(founder.id, desk.id, payees, scenario.sneak.task, "WEEKLY", 8));
  const monthly = rt.dispatch(cadenceBody(founder.id, desk.id, payees, "monthly cadence on a seven-day slip", "MONTHLY", 8));
  const unlimited = rt.dispatch(cadenceBody(founder.id, desk.id, payees, "unlimited weekly on a seven-day slip", "WEEKLY"));
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.cadence_reach"),
    monthlyDenied: deniedRule(monthly, "mandate.cadence_reach"),
    unlimitedDenied: deniedRule(unlimited, "mandate.cadence_reach"),
    vacantAllows: allowedRule(sneak, "mandate.occurrence_fresh"),
    reachAllows: allowedRule(sneak, "mandate.window_reach"),
    windowAllows: allowedRule(sneak, "mandate.window_fresh"),
    spendAllows: allowedRule(sneak, "payment.recurrence"),
    childAllows: allowedRule(sneak, "mandate.child_tighter"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    monthlyFirst: monthly.ok ? undefined : monthly.error.decision?.remediation?.ruleId,
    unlimitedFirst: unlimited.ok ? undefined : unlimited.error.decision?.remediation?.ruleId,
    size: rt.intents.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalAttempt = rt.dispatch(cadenceBody(founder.id, desk.id, payees, scenario.legal.task, "WEEKLY", 1));
  const legal = must(legalAttempt, "one-shot weekly");
  const legalId = (legal.data as { payload: { id: MandateId } }).payload.id;
  const dailyAttempt = rt.dispatch(cadenceBody(founder.id, desk.id, payees, scenario.daily.task, "DAILY", 8));
  const daily = must(dailyAttempt, "daily cadence");
  const dailyId = (daily.data as { payload: { id: MandateId } }).payload.id;
  const afterLegal = {
    reachAllows: allowedRule(legalAttempt, "mandate.cadence_reach"),
    vacantAllows: allowedRule(legalAttempt, "mandate.occurrence_fresh"),
    dailyReachAllows: allowedRule(dailyAttempt, "mandate.cadence_reach"),
    size: rt.intents.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after week deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after week deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && sizeBeforeSneak === 1,
      1,
      "a listed seller still funds a hire with no weekly cadence written yet",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.monthlyDenied &&
        afterSneak.unlimitedDenied &&
        afterSneak.vacantAllows &&
        afterSneak.reachAllows &&
        afterSneak.windowAllows &&
        afterSneak.spendAllows &&
        afterSneak.childAllows &&
        afterSneak.firstDeny === "mandate.cadence_reach" &&
        afterSneak.monthlyFirst === "mandate.cadence_reach" &&
        afterSneak.unlimitedFirst === "mandate.cadence_reach" &&
        afterSneak.size === sizeBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "minting WEEKLY or MONTHLY that cannot admit a second hire is mandate.cadence_reach — not a vacant slot, not a closed calendar, not hire-time recurrence",
    ),
    expect(
      legal.replayed !== true &&
        daily.replayed !== true &&
        afterLegal.reachAllows &&
        afterLegal.vacantAllows &&
        afterLegal.dailyReachAllows &&
        afterLegal.size === sizeBeforeSneak + 2 &&
        legalId.startsWith("mid_") &&
        dailyId.startsWith("mid_"),
      3,
      "a one-shot WEEKLY still mints, and DAILY still mints — the deny did not write a corpse",
      legalId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the week refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
