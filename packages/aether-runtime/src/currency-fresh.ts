import { readFileSync } from "node:fs";
import type { CurrencyCode, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { CLASH_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface CurrencyFreshScenario {
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

export interface CurrencyFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadCurrencyFresh(path: string): CurrencyFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as CurrencyFreshScenario;
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

function clashBody(
  founderId: string,
  deskId: string,
  payees: MandateConstraint,
  task: string,
  rangeCurrency: CurrencyCode,
  budgetCurrency: CurrencyCode,
) {
  return cmd("mandate.issue_intent", founderId, {
    subjectId: deskId,
    task,
    constraints: [
      { type: "payment.amount_range", currency: rangeCurrency, max: 500_000 },
      { type: "payment.budget", currency: budgetCurrency, max: 1_000_000 },
      payees,
    ],
  });
}

export function runCurrencyFresh(scenario: CurrencyFreshScenario): CurrencyFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = CLASH_TLDR;
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
    spec: "a USDC coffer on a USD lid is not a budget",
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

  const sneak = rt.dispatch(clashBody(founder.id, desk.id, payees, scenario.sneak.task, "USD_SIM", "USDC_SIM"));
  const flip = rt.dispatch(
    clashBody(founder.id, desk.id, payees, "a USD coffer on a USDC lid is not a budget", "USDC_SIM", "USD_SIM"),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.currency_fresh"),
    flipDenied: deniedRule(flip, "mandate.currency_fresh"),
    vacantAllows: allowedRule(sneak, "mandate.occurrence_fresh"),
    weekAllows: allowedRule(sneak, "mandate.cadence_reach"),
    gulfAllows: allowedRule(sneak, "mandate.range_fresh"),
    cofferAllows: allowedRule(sneak, "mandate.budget_fresh"),
    mixAllows: allowedRule(sneak, "payment.currency_match"),
    purseAllows: allowedRule(sneak, "payment.budget"),
    lidAllows: allowedRule(sneak, "payment.amount_range"),
    childAllows: allowedRule(sneak, "mandate.child_tighter"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    flipFirst: flip.ok ? undefined : flip.error.decision?.remediation?.ruleId,
    size: rt.intents.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalAttempt = rt.dispatch(clashBody(founder.id, desk.id, payees, scenario.legal.task, "USD_SIM", "USD_SIM"));
  const legal = must(legalAttempt, "matching USD");
  const legalId = (legal.data as { payload: { id: MandateId } }).payload.id;
  const openAttempt = rt.dispatch(clashBody(founder.id, desk.id, payees, scenario.open.task, "USDC_SIM", "USDC_SIM"));
  const open = must(openAttempt, "matching USDC");
  const openId = (open.data as { payload: { id: MandateId } }).payload.id;
  const afterLegal = {
    currencyAllows: allowedRule(legalAttempt, "mandate.currency_fresh"),
    openAllows: allowedRule(openAttempt, "mandate.currency_fresh"),
    size: rt.intents.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after clash deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after clash deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && sizeBeforeSneak === 1,
      1,
      "a listed seller still funds a hire with no mixed envelope written yet",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.flipDenied &&
        afterSneak.vacantAllows &&
        afterSneak.weekAllows &&
        afterSneak.gulfAllows &&
        afterSneak.cofferAllows &&
        afterSneak.mixAllows &&
        afterSneak.purseAllows &&
        afterSneak.lidAllows &&
        afterSneak.childAllows &&
        afterSneak.firstDeny === "mandate.currency_fresh" &&
        afterSneak.flipFirst === "mandate.currency_fresh" &&
        afterSneak.size === sizeBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "minting a USDC coffer on a USD lid is mandate.currency_fresh — not a vacant slot, not a closed coffer, not hire-time currency",
    ),
    expect(
      legal.replayed !== true &&
        open.replayed !== true &&
        afterLegal.currencyAllows &&
        afterLegal.openAllows &&
        afterLegal.size === sizeBeforeSneak + 2 &&
        legalId.startsWith("mid_") &&
        openId.startsWith("mid_"),
      3,
      "matching USD still mints, and matching USDC still mints — the deny did not write a corpse",
      legalId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the clash refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
