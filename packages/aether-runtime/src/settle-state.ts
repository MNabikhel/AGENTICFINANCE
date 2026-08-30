import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { FILM_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface SettleStateScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface SettleStateReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadSettleState(path: string): SettleStateScenario {
  return JSON.parse(readFileSync(path, "utf8")) as SettleStateScenario;
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

export function runSettleState(scenario: SettleStateScenario): SettleStateReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = FILM_TLDR;
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
  const hirePrice = scenario.quotes.hire!;

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
    spec: "an empty book is not a settlement photo",
    price: hirePrice,
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
    unitAmount: hirePrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const usdLegsAfterFund = rt.clearing.openLegs("USD_SIM");
  const usdcLegs = rt.clearing.openLegs("USDC_SIM");
  const windowLines = () => rt.audit.all().filter((r) => r.action === "CLEARING_WINDOW").length;
  const windowsBeforeSneak = rt.clearing.windows.length;
  const linesBeforeSneak = windowLines();

  const film = rt.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USDC_SIM" }));
  const systemSneak = rt.dispatch(cmd("clearing.settle_window", "system", { currency: "USDC_SIM" }));
  const juniorSneak = rt.dispatch(cmd("clearing.settle_window", vendor.id, { currency: "USDC_SIM" }));

  const afterSneak = {
    denied: deniedRule(film, "clearing.settle_state"),
    firstDeny: film.ok ? undefined : film.error.decision?.remediation?.ruleId,
    roleAllows: allowedRule(film, "actor.role_capability"),
    scopeAllows: allowedRule(film, "actor.system_scope"),
    knownAllows: allowedRule(film, "actor.known"),
    capAllows: allowedRule(film, "clearing.bilateral_limit"),
    systemFirst: systemSneak.ok ? undefined : systemSneak.error.decision?.remediation?.ruleId,
    systemStateDenies: deniedRule(systemSneak, "clearing.settle_state"),
    juniorFirst: juniorSneak.ok ? undefined : juniorSneak.error.decision?.remediation?.ruleId,
    juniorStateDenies: deniedRule(juniorSneak, "clearing.settle_state"),
    windows: rt.clearing.windows.length,
    lines: windowLines(),
    usdLegsStillOpen: rt.clearing.openLegs("USD_SIM"),
    funded: rt.hires.get(hireId)?.state,
  };

  const settleAttempt = rt.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USD_SIM" }));
  const settled = must(settleAttempt, "USD book still settles");
  const photo = settled.data as { legsConsumed: number; grossVolume: number };
  const doublePhoto = rt.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USD_SIM" }));
  const afterLegal = {
    settleAllows: allowedRule(settleAttempt, "clearing.settle_state"),
    doubleDenied: deniedRule(doublePhoto, "clearing.settle_state"),
    doubleFirst: doublePhoto.ok ? undefined : doublePhoto.error.decision?.remediation?.ruleId,
    windows: rt.clearing.windows.length,
    usdLegsLeft: rt.clearing.openLegs("USD_SIM"),
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after film deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after film deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        usdLegsAfterFund === 1 &&
        usdcLegs === 0 &&
        windowsBeforeSneak === 0,
      1,
      "a funded $800 hire puts one open leg on the USD book; the USDC book is empty",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.firstDeny === "clearing.settle_state" &&
        afterSneak.roleAllows &&
        afterSneak.scopeAllows &&
        afterSneak.knownAllows &&
        afterSneak.capAllows &&
        afterSneak.systemFirst === "actor.system_scope" &&
        afterSneak.systemStateDenies &&
        afterSneak.juniorFirst === "actor.role_capability" &&
        afterSneak.juniorStateDenies &&
        afterSneak.windows === 0 &&
        afterSneak.lines === linesBeforeSneak &&
        afterSneak.usdLegsStillOpen === 1 &&
        afterSneak.funded === "funded",
      2,
      "settling the empty USDC book is clearing.settle_state — a system speaker and a junior speaker still first-deny elsewhere; no window minted",
    ),
    expect(
      afterLegal.settleAllows &&
        photo.legsConsumed === 1 &&
        photo.grossVolume === hirePrice.amount &&
        afterLegal.windows === 1 &&
        afterLegal.usdLegsLeft === 0 &&
        afterLegal.doubleDenied &&
        afterLegal.doubleFirst === "clearing.settle_state",
      3,
      "the USD book with an open leg still settles, and the second photo right after is the same refuse",
    ),
    expect(released && rt.clearing.windows.length === 1, 4, "that funded work still releases after the film refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
