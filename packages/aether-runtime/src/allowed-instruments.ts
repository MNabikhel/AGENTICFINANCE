import { readFileSync } from "node:fs";
import { SIM_INSTRUMENT, type MandateConstraint, type MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { RAIL_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface AllowedInstrumentsScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  sneak: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface AllowedInstrumentsReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadAllowedInstruments(path: string): AllowedInstrumentsScenario {
  return JSON.parse(readFileSync(path, "utf8")) as AllowedInstrumentsScenario;
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

const GHOST_RAIL = {
  id: "ghost-rail",
  type: "sim_ledger" as const,
  description: "not this kernel's ledger",
};

export function runAllowedInstruments(scenario: AllowedInstrumentsScenario): AllowedInstrumentsReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = RAIL_TLDR;
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
  const firstPrice = scenario.quotes.first!;
  const sneakPrice = scenario.quotes.sneak!;

  const payees: MandateConstraint = {
    type: "payment.allowed_payees",
    allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
  };
  const listedRail: MandateConstraint = {
    type: "payment.allowed_payment_instruments",
    allowed: [SIM_INSTRUMENT],
  };
  const ghostRail: MandateConstraint = {
    type: "payment.allowed_payment_instruments",
    allowed: [GHOST_RAIL],
  };

  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.intent.task,
        constraints: [...scenario.intent.constraints, payees, listedRail],
      }),
    ),
    "intent with the sim ledger listed",
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
    spec: "listed sim ledger still hires",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire listed sim ledger");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const hiresBeforeSneak = rt.hires.size;
  const quotesBeforeSneak = rt.quotes.size;
  const intentsBeforeSneak = rt.intents.size;

  const ghostSlip = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.sneak.task,
        constraints: [...scenario.sneak.constraints, payees, ghostRail],
      }),
    ),
    "intent that lists a ghost rail",
  );
  const ghostIntentId = (ghostSlip.data as { payload: { id: MandateId } }).payload.id;

  const sneak = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "ghost rail is not this kernel's ledger",
    price: sneakPrice,
    intentId: ghostIntentId,
  });
  const afterSneak = {
    denied: deniedRule(sneak.attempt, "payment.allowed_payment_instruments"),
    payeeAllows: allowedRule(sneak.attempt, "payment.allowed_payees"),
    amountAllows: allowedRule(sneak.attempt, "payment.amount_range"),
    skuAllows: allowedRule(sneak.attempt, "payment.allowed_skus"),
    simAllows: allowedRule(sneak.attempt, "instrument.sim_only"),
    knownAllows: allowedRule(sneak.attempt, "counterparty.known"),
    firstDeny: sneak.attempt.ok ? undefined : sneak.attempt.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    consumed: rt.consumedQuotes.has(sneak.quoteId),
    quotes: rt.quotes.size,
    intents: rt.intents.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after rail deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after rail deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        hiresBeforeSneak === 1 &&
        allowedRule(live.attempt, "payment.allowed_payment_instruments") &&
        intentsBeforeSneak === 1,
      1,
      "listed sim ledger still funds a hire",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.payeeAllows &&
        afterSneak.amountAllows &&
        afterSneak.skuAllows &&
        afterSneak.simAllows &&
        afterSneak.knownAllows &&
        afterSneak.firstDeny === "payment.allowed_payment_instruments" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.consumed === false &&
        afterSneak.quotes === quotesBeforeSneak + 1 &&
        afterSneak.intents === intentsBeforeSneak + 1,
      2,
      "ghost rail is payment.allowed_payment_instruments — not a listed payee, not a live-rail type",
      sneak.quoteId,
    ),
    expect(released && rt.hires.size === 1, 3, "that funded work still releases after the list refuses", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
