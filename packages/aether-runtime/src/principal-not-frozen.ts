import { readFileSync } from "node:fs";
import { hopStatus } from "@aether/kya";
import type { DelegationId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { ICE_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface PrincipalNotFrozenScenario {
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

export interface PrincipalNotFrozenReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadPrincipalNotFrozen(path: string): PrincipalNotFrozenScenario {
  return JSON.parse(readFileSync(path, "utf8")) as PrincipalNotFrozenScenario;
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

export function runPrincipalNotFrozen(scenario: PrincipalNotFrozenScenario): PrincipalNotFrozenReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = ICE_TLDR;
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

  const hop = must(
    rt.dispatch(
      cmd("kya.attest", founder.id, {
        delegateId: desk.id,
        maxAutonomy: scenario.hop.maxAutonomy,
      }),
    ),
    "live hop",
  );
  const hopId = (hop.data as { id: string }).id;

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
    spec: "while the money's owner still lives",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire while principal lives");
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

  must(rt.dispatch(cmd("identity.freeze", treasury.id, { agentId: founder.id })), "freeze founder");
  const liveHop = rt.kya.attestations.get(hopId as DelegationId);
  const now = rt.clock.now();

  const sneak = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "after the money's owner was frozen",
    price: sneakPrice,
    intentId,
  });
  const afterSneak = {
    denied: deniedRule(sneak.attempt, "kya.principal_not_frozen"),
    chainAllows: allowedRule(sneak.attempt, "kya.chain_intact"),
    freshAllows: allowedRule(sneak.attempt, "kya.attestation_fresh"),
    parentAllows: allowedRule(sneak.attempt, "kya.parent_fresh"),
    speakerAllows: allowedRule(sneak.attempt, "actor.not_frozen"),
    thawAllows: allowedRule(sneak.attempt, "identity.freeze_state"),
    firstDeny: sneak.attempt.ok ? undefined : sneak.attempt.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    consumed: rt.consumedQuotes.has(sneak.quoteId),
    hops: rt.kya.attestations.size,
    hopLive: liveHop !== undefined && hopStatus(liveHop, now) === "live",
    founderFrozen: rt.alias("ops-human").frozen === true,
    deskLive: rt.alias("desk").frozen === false,
  };

  const thawed = must(
    rt.dispatch(cmd("identity.unfreeze", treasury.id, { agentId: founder.id })),
    "unfreeze founder after ice deny",
  );

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after ice deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after ice deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && hiresBeforeSneak === 1 && hopsBefore === 1,
      1,
      "desk hire.create allows and funds while the money's owner still lives",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.chainAllows &&
        afterSneak.freshAllows &&
        afterSneak.parentAllows &&
        afterSneak.speakerAllows &&
        afterSneak.thawAllows &&
        afterSneak.firstDeny === "kya.principal_not_frozen" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.consumed === false &&
        afterSneak.hops === hopsBefore &&
        afterSneak.hopLive &&
        afterSneak.founderFrozen &&
        afterSneak.deskLive,
      2,
      "new hire after the founder is frozen is kya.principal_not_frozen — not a frozen speaker, not a revoked hop, not a no-op thaw; the handshake still lives",
      sneak.quoteId,
    ),
    expect(
      thawed.replayed !== true &&
        rt.alias("ops-human").frozen === false &&
        released &&
        rt.hires.size === 1,
      3,
      "an unfreeze still unlocks the lock and that funded work still releases",
      hireId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
