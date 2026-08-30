import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { GULF_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface RangeFreshScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  sneak: { task: string };
  legal: { task: string };
  open: { task: string };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface RangeFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadRangeFresh(path: string): RangeFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as RangeFreshScenario;
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

function rangeBody(
  founderId: string,
  deskId: string,
  payees: MandateConstraint,
  task: string,
  min: number | undefined,
  max: number,
) {
  const band: MandateConstraint =
    min === undefined
      ? { type: "payment.amount_range", currency: "USD_SIM", max }
      : { type: "payment.amount_range", currency: "USD_SIM", min, max };
  return cmd("mandate.issue_intent", founderId, {
    subjectId: deskId,
    task,
    constraints: [band, payees],
  });
}

export function runRangeFresh(scenario: RangeFreshScenario): RangeFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = GULF_TLDR;
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
    spec: "a floor above the lid is not a range",
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

  const sneak = rt.dispatch(rangeBody(founder.id, desk.id, payees, scenario.sneak.task, 200_000, 100_000));
  const penny = rt.dispatch(rangeBody(founder.id, desk.id, payees, "a penny floor above a zero lid", 1, 0));
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.range_fresh"),
    pennyDenied: deniedRule(penny, "mandate.range_fresh"),
    vacantAllows: allowedRule(sneak, "mandate.occurrence_fresh"),
    weekAllows: allowedRule(sneak, "mandate.cadence_reach"),
    reachAllows: allowedRule(sneak, "mandate.window_reach"),
    windowAllows: allowedRule(sneak, "mandate.window_fresh"),
    lidAllows: allowedRule(sneak, "payment.amount_range"),
    childAllows: allowedRule(sneak, "mandate.child_tighter"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    pennyFirst: penny.ok ? undefined : penny.error.decision?.remediation?.ruleId,
    size: rt.intents.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalAttempt = rt.dispatch(rangeBody(founder.id, desk.id, payees, scenario.legal.task, 80_000, 80_000));
  const legal = must(legalAttempt, "exact band");
  const legalId = (legal.data as { payload: { id: MandateId } }).payload.id;
  const openAttempt = rt.dispatch(rangeBody(founder.id, desk.id, payees, scenario.open.task, 100, 500_000));
  const open = must(openAttempt, "open floor");
  const openId = (open.data as { payload: { id: MandateId } }).payload.id;
  const afterLegal = {
    rangeAllows: allowedRule(legalAttempt, "mandate.range_fresh"),
    openAllows: allowedRule(openAttempt, "mandate.range_fresh"),
    size: rt.intents.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after gulf deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after gulf deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && sizeBeforeSneak === 1,
      1,
      "a listed seller still funds a hire with no inverted range written yet",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.pennyDenied &&
        afterSneak.vacantAllows &&
        afterSneak.weekAllows &&
        afterSneak.reachAllows &&
        afterSneak.windowAllows &&
        afterSneak.lidAllows &&
        afterSneak.childAllows &&
        afterSneak.firstDeny === "mandate.range_fresh" &&
        afterSneak.pennyFirst === "mandate.range_fresh" &&
        afterSneak.size === sizeBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "minting an amount_range whose min exceeds max is mandate.range_fresh — not a vacant slot, not a week on a seven-day slip, not hire-time max",
    ),
    expect(
      legal.replayed !== true &&
        open.replayed !== true &&
        afterLegal.rangeAllows &&
        afterLegal.openAllows &&
        afterLegal.size === sizeBeforeSneak + 2 &&
        legalId.startsWith("mid_") &&
        openId.startsWith("mid_"),
      3,
      "an exact band still mints, and an open floor still mints — the deny did not write a corpse",
      legalId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the gulf refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
