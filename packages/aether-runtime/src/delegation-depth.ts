import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { WELL_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface DelegationDepthScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  hop: { maxAutonomy: number };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface DelegationDepthReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadDelegationDepth(path: string): DelegationDepthScenario {
  return JSON.parse(readFileSync(path, "utf8")) as DelegationDepthScenario;
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

export function runDelegationDepth(scenario: DelegationDepthScenario): DelegationDepthReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = WELL_TLDR;
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
    { key: "hop-a", displayName: "Hop A", role: "human_operator", autonomyLevel: 0 },
    { key: "hop-b", displayName: "Hop B", role: "human_operator", autonomyLevel: 0 },
    { key: "hop-c", displayName: "Hop C", role: "human_operator", autonomyLevel: 0 },
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "over-desk", displayName: "Over Desk", role: "procurement", autonomyLevel: 3 },
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

  const hopA = rt.alias("hop-a");
  const hopB = rt.alias("hop-b");
  const hopC = rt.alias("hop-c");
  const desk = rt.alias("desk");
  const over = rt.alias("over-desk");
  const vendor = rt.alias("research-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const firstPrice = scenario.quotes.first!;
  const sneakPrice = scenario.quotes.sneak!;

  must(
    rt.dispatch(
      cmd("kya.attest", founder.id, {
        delegateId: hopA.id,
        maxAutonomy: scenario.hop.maxAutonomy,
      }),
    ),
    "founder→A",
  );
  must(
    rt.dispatch(
      cmd("kya.attest", hopA.id, {
        delegateId: hopB.id,
        principalId: founder.id,
        maxAutonomy: scenario.hop.maxAutonomy,
      }),
    ),
    "A→B in the founder's name",
  );
  must(
    rt.dispatch(
      cmd("kya.attest", hopB.id, {
        delegateId: desk.id,
        principalId: founder.id,
        maxAutonomy: scenario.hop.maxAutonomy,
      }),
    ),
    "B→desk in the founder's name",
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
    spec: "while the chain is three hops",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire at depth 3");
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
  const depth3 = rt.kya.path(founder.id, desk.id, rt.clock.now())?.length;
  const hiresBeforeSneak = rt.hires.size;
  const hopsBeforeExtend = rt.kya.attestations.size;

  must(
    rt.dispatch(
      cmd("kya.attest", hopB.id, {
        delegateId: hopC.id,
        principalId: founder.id,
        maxAutonomy: scenario.hop.maxAutonomy,
      }),
    ),
    "B→C in the founder's name",
  );
  must(
    rt.dispatch(
      cmd("kya.attest", hopC.id, {
        delegateId: over.id,
        principalId: founder.id,
        maxAutonomy: scenario.hop.maxAutonomy,
      }),
    ),
    "C→over-desk in the founder's name",
  );

  const sneakIntent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: over.id,
        task: scenario.intent.task,
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "four-hop slip",
  );
  const sneakIntentId = (sneakIntent.data as { payload: { id: MandateId } }).payload.id;
  const hopsBeforeSneak = rt.kya.attestations.size;
  const depth4 = rt.kya.path(founder.id, over.id, rt.clock.now())?.length;

  const sneak = offerHire(rt, {
    buyer: over.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "after a fourth hop",
    price: sneakPrice,
    intentId: sneakIntentId,
  });
  const afterSneak = {
    denied: deniedRule(sneak.attempt, "kya.delegation_depth"),
    chainAllows: allowedRule(sneak.attempt, "kya.chain_intact"),
    parentAllows: allowedRule(sneak.attempt, "kya.parent_fresh"),
    climbAllows: allowedRule(sneak.attempt, "kya.capability_subset"),
    freshAllows: allowedRule(sneak.attempt, "kya.attestation_fresh"),
    partyAllows: allowedRule(sneak.attempt, "kya.party"),
    subjectAllows: allowedRule(sneak.attempt, "mandate.subject_is_actor"),
    firstDeny: sneak.attempt.ok ? undefined : sneak.attempt.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    consumed: rt.consumedQuotes.has(sneak.quoteId),
    hops: rt.kya.attestations.size,
    depth3,
    depth4,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after well deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after well deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        hiresBeforeSneak === 1 &&
        hopsBeforeExtend === 3 &&
        depth3 === 3,
      1,
      "desk hire.create allows and funds under a three-hop handshake",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.chainAllows &&
        afterSneak.parentAllows &&
        afterSneak.climbAllows &&
        afterSneak.freshAllows &&
        afterSneak.partyAllows &&
        afterSneak.subjectAllows &&
        afterSneak.firstDeny === "kya.delegation_depth" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.consumed === false &&
        afterSneak.hops === hopsBeforeSneak &&
        afterSneak.depth4 === 4,
      2,
      "new hire down a four-hop chain is kya.delegation_depth — not a missing path, not a nested parent, not a climb",
      sneak.quoteId,
    ),
    expect(
      released && rt.hires.size === 1 && depth3 === 3,
      3,
      "that funded three-hop work still releases",
      hireId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
