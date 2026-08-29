import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { LAPSE_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface AttestationFreshScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  hop: { maxAutonomy: number; expiresAt: string };
  afterHop: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface AttestationFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadAttestationFresh(path: string): AttestationFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as AttestationFreshScenario;
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

export function runAttestationFresh(scenario: AttestationFreshScenario): AttestationFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = LAPSE_TLDR;
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

  must(
    rt.dispatch(
      cmd("kya.attest", founder.id, {
        delegateId: desk.id,
        maxAutonomy: scenario.hop.maxAutonomy,
        expiresAt: scenario.hop.expiresAt,
      }),
    ),
    "timed hop",
  );

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
    spec: "while the hop lives",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire while hop lives");
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
  const hopsBefore = rt.kya.attestations.size;

  rt.clock.set(scenario.afterHop);

  const sneak = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "after the hop died",
    price: sneakPrice,
    intentId,
  });
  const graph = rt.kyaSnapshot();
  const afterSneak = {
    denied: deniedRule(sneak.attempt, "kya.attestation_fresh"),
    chainAllows: allowedRule(sneak.attempt, "kya.chain_intact"),
    parentAllows: allowedRule(sneak.attempt, "kya.parent_fresh"),
    grantAllows: allowedRule(sneak.attempt, "kya.capability_subset"),
    firstDeny: sneak.attempt.ok ? undefined : sneak.attempt.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    consumed: rt.consumedQuotes.has(sneak.quoteId),
    hops: rt.kya.attestations.size,
    expired: graph.edges.some((e) => e.status === "expired") && !graph.edges.some((e) => e.status === "live"),
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after lapse deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after lapse deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && hiresBeforeSneak === 1 && hopsBefore === 1,
      1,
      "desk hire.create allows and funds while the handshake still lives",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.chainAllows &&
        afterSneak.parentAllows &&
        afterSneak.grantAllows &&
        afterSneak.firstDeny === "kya.attestation_fresh" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.consumed === false &&
        afterSneak.hops === hopsBefore &&
        afterSneak.expired,
      2,
      "new hire after the hop dies is kya.attestation_fresh — not a nested parent, not a climb, not a missing chain; the pair still occupies",
      sneak.quoteId,
    ),
    expect(released && rt.hires.size === 1, 3, "that funded work still releases after the lapse refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
