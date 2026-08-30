import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { EAVE_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface CapFreshScenario {
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

export interface CapFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadCapFresh(path: string): CapFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as CapFreshScenario;
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

function eaveBody(
  founderId: string,
  deskId: string,
  payees: MandateConstraint,
  task: string,
  capMax: number | undefined,
) {
  const band: MandateConstraint = { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 };
  const constraints: MandateConstraint[] =
    capMax === undefined ? [band, payees] : [band, { type: "aether.max_autonomy", max: capMax as 0 | 1 | 2 | 3 | 4 | 5 }, payees];
  return cmd("mandate.issue_intent", founderId, {
    subjectId: deskId,
    task,
    constraints,
  });
}

export function runCapFresh(scenario: CapFreshScenario): CapFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = EAVE_TLDR;
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
    spec: "a cap below the desk is not a cap",
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

  const sneak = rt.dispatch(eaveBody(founder.id, desk.id, payees, scenario.sneak.task, 2));
  const floor = rt.dispatch(eaveBody(founder.id, desk.id, payees, "a floor cap is not a cap", 0));
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.cap_fresh"),
    floorDenied: deniedRule(floor, "mandate.cap_fresh"),
    vacantAllows: allowedRule(sneak, "mandate.occurrence_fresh"),
    weekAllows: allowedRule(sneak, "mandate.cadence_reach"),
    gulfAllows: allowedRule(sneak, "mandate.range_fresh"),
    cofferAllows: allowedRule(sneak, "mandate.budget_fresh"),
    clashAllows: allowedRule(sneak, "mandate.currency_fresh"),
    hatchAllows: allowedRule(sneak, "mandate.lid_fresh"),
    ceilingAllows: allowedRule(sneak, "ladder.max_autonomy_constraint"),
    gradeAllows: allowedRule(sneak, "ladder.min_level"),
    childAllows: allowedRule(sneak, "mandate.child_tighter"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    floorFirst: floor.ok ? undefined : floor.error.decision?.remediation?.ruleId,
    size: rt.intents.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalAttempt = rt.dispatch(eaveBody(founder.id, desk.id, payees, scenario.legal.task, 3));
  const legal = must(legalAttempt, "exact cap");
  const legalId = (legal.data as { payload: { id: MandateId } }).payload.id;
  const openAttempt = rt.dispatch(eaveBody(founder.id, desk.id, payees, scenario.open.task, undefined));
  const open = must(openAttempt, "open ceiling");
  const openId = (open.data as { payload: { id: MandateId } }).payload.id;
  const afterLegal = {
    capAllows: allowedRule(legalAttempt, "mandate.cap_fresh"),
    openAllows: allowedRule(openAttempt, "mandate.cap_fresh"),
    size: rt.intents.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after eave deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after eave deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && sizeBeforeSneak === 1,
      1,
      "a listed seller still funds a hire with no cap below the desk written yet",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.floorDenied &&
        afterSneak.vacantAllows &&
        afterSneak.weekAllows &&
        afterSneak.gulfAllows &&
        afterSneak.cofferAllows &&
        afterSneak.clashAllows &&
        afterSneak.hatchAllows &&
        afterSneak.ceilingAllows &&
        afterSneak.gradeAllows &&
        afterSneak.childAllows &&
        afterSneak.firstDeny === "mandate.cap_fresh" &&
        afterSneak.floorFirst === "mandate.cap_fresh" &&
        afterSneak.size === sizeBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "minting a cap below the desk's live rung is mandate.cap_fresh — not a vacant slot, not a closed hatch, not a climb after mint",
    ),
    expect(
      legal.replayed !== true &&
        open.replayed !== true &&
        afterLegal.capAllows &&
        afterLegal.openAllows &&
        afterLegal.size === sizeBeforeSneak + 2 &&
        legalId.startsWith("mid_") &&
        openId.startsWith("mid_"),
      3,
      "an exact cap still mints, and an open ceiling still mints — the deny did not write a corpse",
      legalId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the eave refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
