import { readFileSync } from "node:fs";
import { hopStatus } from "@aether/kya";
import type { AgentId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { JOIST_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface NestTighterScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  parent: { maxAutonomy: number };
  sneak: { maxAutonomy: number };
  legal: { maxAutonomy: number };
  tighter: { maxAutonomy: number };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface NestTighterReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadNestTighter(path: string): NestTighterScenario {
  return JSON.parse(readFileSync(path, "utf8")) as NestTighterScenario;
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

function liveHops(rt: Runtime, principalId: AgentId, delegateId: AgentId) {
  const now = rt.clock.now();
  return [...rt.kya.attestations.values()].filter(
    (a) => a.principalId === principalId && a.delegateId === delegateId && hopStatus(a, now) === "live",
  );
}

export function runNestTighter(scenario: NestTighterScenario): NestTighterReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = JOIST_TLDR;
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
    { key: "scout", displayName: "Scout", role: "procurement", autonomyLevel: 3 },
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
  const scout = rt.alias("scout");
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
    spec: "a nested grant wider than its parent is not a handshake",
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

  const parent = must(
    rt.dispatch(
      cmd("kya.attest", founder.id, {
        delegateId: desk.id,
        maxAutonomy: scenario.parent.maxAutonomy as 0 | 1 | 2 | 3 | 4 | 5,
      }),
    ),
    "parent hop",
  );
  const parentId = (parent.data as { id: string }).id;
  const hopsBeforeSneak = liveHops(rt, founder.id, scout.id).length;
  const sizeBeforeSneak = rt.kya.attestations.size;

  const sneak = rt.dispatch(
    cmd("kya.attest", founder.id, {
      delegateId: scout.id,
      parentId,
      maxAutonomy: scenario.sneak.maxAutonomy as 0 | 1 | 2 | 3 | 4 | 5,
    }),
  );
  const floor = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, parentId }));
  const afterSneak = {
    denied: deniedRule(sneak, "kya.nest_tighter"),
    floorDenied: deniedRule(floor, "kya.nest_tighter"),
    sparkAllows: allowedRule(sneak, "kya.mint_fresh"),
    yearAllows: allowedRule(sneak, "kya.mint_window"),
    pairAllows: allowedRule(sneak, "kya.unique_live"),
    selfAllows: allowedRule(sneak, "kya.not_self"),
    partyAllows: allowedRule(sneak, "kya.party"),
    knownAllows: allowedRule(sneak, "identity.known"),
    parentKnownAllows: allowedRule(sneak, "kya.known_parent"),
    parentAllows: allowedRule(sneak, "kya.parent_fresh"),
    climbAllows: allowedRule(sneak, "kya.capability_subset"),
    sillAllows: allowedRule(sneak, "kya.grant_fresh"),
    childAllows: allowedRule(sneak, "mandate.child_tighter"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    floorFirst: floor.ok ? undefined : floor.error.decision?.remediation?.ruleId,
    hops: liveHops(rt, founder.id, scout.id).length,
    size: rt.kya.attestations.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalAttempt = rt.dispatch(
    cmd("kya.attest", founder.id, {
      delegateId: scout.id,
      parentId,
      maxAutonomy: scenario.legal.maxAutonomy as 0 | 1 | 2 | 3 | 4 | 5,
    }),
  );
  const legal = must(legalAttempt, "exact nested grant");
  const legalId = (legal.data as { id: string }).id;
  const tighterAttempt = rt.dispatch(
    cmd("kya.attest", founder.id, {
      delegateId: vendor.id,
      parentId,
      maxAutonomy: scenario.tighter.maxAutonomy as 0 | 1 | 2 | 3 | 4 | 5,
    }),
  );
  const tighter = must(tighterAttempt, "tighter nested grant");
  const tighterId = (tighter.data as { id: string }).id;
  const afterLegal = {
    nestAllows: allowedRule(legalAttempt, "kya.nest_tighter"),
    tighterAllows: allowedRule(tighterAttempt, "kya.nest_tighter"),
    scoutHops: liveHops(rt, founder.id, scout.id).length,
    vendorHops: liveHops(rt, founder.id, vendor.id).length,
    size: rt.kya.attestations.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after joist deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after joist deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        parent.replayed !== true &&
        parentId.startsWith("dlg_") &&
        hopsBeforeSneak === 0 &&
        sizeBeforeSneak === 1,
      1,
      "a listed seller still funds a hire, and a parent hop still mints, with no wider nested grant written yet",
      parentId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.floorDenied &&
        afterSneak.sparkAllows &&
        afterSneak.yearAllows &&
        afterSneak.pairAllows &&
        afterSneak.selfAllows &&
        afterSneak.partyAllows &&
        afterSneak.knownAllows &&
        afterSneak.parentKnownAllows &&
        afterSneak.parentAllows &&
        afterSneak.climbAllows &&
        afterSneak.sillAllows &&
        afterSneak.childAllows &&
        afterSneak.firstDeny === "kya.nest_tighter" &&
        afterSneak.floorFirst === "kya.nest_tighter" &&
        afterSneak.hops === hopsBeforeSneak &&
        afterSneak.size === sizeBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "minting a nested grant wider than its parent is kya.nest_tighter — not a dead parent hop, not a grant below the desk, not a nested slip",
    ),
    expect(
      legal.replayed !== true &&
        tighter.replayed !== true &&
        afterLegal.nestAllows &&
        afterLegal.tighterAllows &&
        afterLegal.scoutHops === 1 &&
        afterLegal.vendorHops === 1 &&
        afterLegal.size === sizeBeforeSneak + 2 &&
        legalId.startsWith("dlg_") &&
        tighterId.startsWith("dlg_"),
      3,
      "an exact nested grant still mints, and a tighter nested grant still mints — the deny did not occupy the pair",
      legalId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the joist refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
