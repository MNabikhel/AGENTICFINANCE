import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { COFFER_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface BudgetFreshScenario {
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

export interface BudgetFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadBudgetFresh(path: string): BudgetFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as BudgetFreshScenario;
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

function cofferBody(
  founderId: string,
  deskId: string,
  payees: MandateConstraint,
  task: string,
  budgetMax: number,
  rangeMin: number | undefined,
  rangeMax: number,
) {
  const band: MandateConstraint =
    rangeMin === undefined
      ? { type: "payment.amount_range", currency: "USD_SIM", max: rangeMax }
      : { type: "payment.amount_range", currency: "USD_SIM", min: rangeMin, max: rangeMax };
  const envelope: MandateConstraint = { type: "payment.budget", currency: "USD_SIM", max: budgetMax };
  return cmd("mandate.issue_intent", founderId, {
    subjectId: deskId,
    task,
    constraints: [band, envelope, payees],
  });
}

export function runBudgetFresh(scenario: BudgetFreshScenario): BudgetFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = COFFER_TLDR;
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
    spec: "a closed coffer is not a budget",
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

  const sneak = rt.dispatch(cofferBody(founder.id, desk.id, payees, scenario.sneak.task, 0, undefined, 500_000));
  const floor = rt.dispatch(
    cofferBody(founder.id, desk.id, payees, "a coffer below the floor is not a budget", 100_000, 200_000, 500_000),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.budget_fresh"),
    floorDenied: deniedRule(floor, "mandate.budget_fresh"),
    vacantAllows: allowedRule(sneak, "mandate.occurrence_fresh"),
    weekAllows: allowedRule(sneak, "mandate.cadence_reach"),
    gulfAllows: allowedRule(sneak, "mandate.range_fresh"),
    floorGulfAllows: allowedRule(floor, "mandate.range_fresh"),
    purseAllows: allowedRule(sneak, "payment.budget"),
    lidAllows: allowedRule(sneak, "payment.amount_range"),
    childAllows: allowedRule(sneak, "mandate.child_tighter"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    floorFirst: floor.ok ? undefined : floor.error.decision?.remediation?.ruleId,
    size: rt.intents.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalAttempt = rt.dispatch(cofferBody(founder.id, desk.id, payees, scenario.legal.task, 80_000, 80_000, 80_000));
  const legal = must(legalAttempt, "coffer covers the floor");
  const legalId = (legal.data as { payload: { id: MandateId } }).payload.id;
  const openAttempt = rt.dispatch(cofferBody(founder.id, desk.id, payees, scenario.open.task, 100_000, undefined, 500_000));
  const open = must(openAttempt, "open floor coffer");
  const openId = (open.data as { payload: { id: MandateId } }).payload.id;
  const afterLegal = {
    budgetAllows: allowedRule(legalAttempt, "mandate.budget_fresh"),
    openAllows: allowedRule(openAttempt, "mandate.budget_fresh"),
    size: rt.intents.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after coffer deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after coffer deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && sizeBeforeSneak === 1,
      1,
      "a listed seller still funds a hire with no closed coffer written yet",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.floorDenied &&
        afterSneak.vacantAllows &&
        afterSneak.weekAllows &&
        afterSneak.gulfAllows &&
        afterSneak.floorGulfAllows &&
        afterSneak.purseAllows &&
        afterSneak.lidAllows &&
        afterSneak.childAllows &&
        afterSneak.firstDeny === "mandate.budget_fresh" &&
        afterSneak.floorFirst === "mandate.budget_fresh" &&
        afterSneak.size === sizeBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "minting a closed coffer or a coffer below the floor is mandate.budget_fresh — not a vacant slot, not a floor above the lid, not hire-time envelope",
    ),
    expect(
      legal.replayed !== true &&
        open.replayed !== true &&
        afterLegal.budgetAllows &&
        afterLegal.openAllows &&
        afterLegal.size === sizeBeforeSneak + 2 &&
        legalId.startsWith("mid_") &&
        openId.startsWith("mid_"),
      3,
      "a coffer that covers the floor still mints, and an open floor still mints — the deny did not write a corpse",
      legalId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the coffer refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
