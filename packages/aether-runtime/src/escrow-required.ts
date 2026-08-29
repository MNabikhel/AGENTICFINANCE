import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { BARE_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface EscrowRequiredScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface EscrowRequiredReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadEscrowRequired(path: string): EscrowRequiredScenario {
  return JSON.parse(readFileSync(path, "utf8")) as EscrowRequiredScenario;
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

export function runEscrowRequired(scenario: EscrowRequiredScenario): EscrowRequiredReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = BARE_TLDR;
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

  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.intent.task,
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "intent",
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
    spec: "funded work still finishes",
    price: firstPrice,
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
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const hiresBeforeSneak = rt.hires.size;

  const sneakOffer = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "accepted is not funded",
    price: sneakPrice,
    intentId,
  });
  const sneakHired = must(sneakOffer.attempt, "second hire.create still writes");
  const sneakId = (sneakHired.data as { id: string }).id;
  must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId: sneakId })), "accept sneak");
  const acceptedState = rt.hires.get(sneakId)?.state;
  const deliverAttempt = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId: sneakId, deliverable: { n: 1 } }));
  const afterSneak = {
    denied: deniedRule(deliverAttempt, "hire.escrow_required"),
    knownAllows: allowedRule(deliverAttempt, "hire.known"),
    partyAllows: allowedRule(deliverAttempt, "hire.party"),
    roleAllows: allowedRule(deliverAttempt, "actor.role_capability"),
    liveAllows: allowedRule(deliverAttempt, "actor.not_frozen"),
    firstDeny: deliverAttempt.ok ? undefined : deliverAttempt.error.decision?.remediation?.ruleId,
    sneakState: rt.hires.get(sneakId)?.state,
    hires: rt.hires.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after escrow deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after escrow deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && hiresBeforeSneak === 1,
      1,
      "desk hire.create allows and funds",
      hireId,
    ),
    expect(
      acceptedState === "accepted" &&
        afterSneak.denied &&
        afterSneak.knownAllows &&
        afterSneak.partyAllows &&
        afterSneak.roleAllows &&
        afterSneak.liveAllows &&
        afterSneak.firstDeny === "hire.escrow_required" &&
        afterSneak.sneakState === "accepted" &&
        afterSneak.hires === 2,
      2,
      "deliver on an accepted hire is hire.escrow_required — the seller is still the party",
      sneakId,
    ),
    expect(
      released && rt.hires.get(hireId)?.state === "released" && rt.hires.get(sneakId)?.state === "accepted",
      3,
      "that funded work still releases after the unfunded deliver is refused",
      hireId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
