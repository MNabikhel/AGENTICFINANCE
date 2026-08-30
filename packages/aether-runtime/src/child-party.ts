import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { CUCKOO_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ChildPartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface ChildPartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadChildParty(path: string): ChildPartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ChildPartyScenario;
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

export function runChildParty(scenario: ChildPartyScenario): ChildPartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = CUCKOO_TLDR;
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
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 4 },
    { key: "other-desk", displayName: "Other Desk", role: "procurement", autonomyLevel: 4 },
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
  const otherDesk = rt.alias("other-desk");
  const scout = rt.alias("scout");
  const vendor = rt.alias("research-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const firstPrice = scenario.quotes.first!;

  must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 4 })), "kya desk");
  must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: otherDesk.id, maxAutonomy: 4 })), "kya other");
  must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, maxAutonomy: 3 })), "kya scout");

  const payees: MandateConstraint = {
    type: "payment.allowed_payees",
    allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
  };

  const hireIntent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.intent.task,
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "hire intent",
  );
  const hireIntentId = (hireIntent.data as { payload: { id: MandateId } }).payload.id;

  const parent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "Someone else's parent slip is not yours to nest under.",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "unused parent",
  );
  const parentId = (parent.data as { payload: { id: MandateId } }).payload.id;

  const ripped = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "A dead parent is a different object.",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "rip target",
  );
  const rippedId = (ripped.data as { payload: { id: MandateId } }).payload.id;
  must(rt.dispatch(cmd("mandate.revoke", founder.id, { intentId: rippedId })), "rip unused parent");

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
    spec: "someone else's parent slip is not yours to nest under",
    price: firstPrice,
    intentId: hireIntentId,
  });
  const hired = must(live.attempt, "hire listed seller");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId: hireIntentId,
    qty: 1,
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const intentsBeforeSneak = rt.intents.size;

  const childConstraints: MandateConstraint[] = [
    { type: "payment.amount_range", currency: "USD_SIM", max: 100000 },
    { type: "aether.allowed_skus", allowed: ["research.brief"] },
    payees,
  ];
  const wideConstraints: MandateConstraint[] = [
    { type: "payment.amount_range", currency: "USD_SIM", max: 600000 },
    { type: "aether.allowed_skus", allowed: ["research.brief"] },
    payees,
  ];

  const rippedAttempt = rt.dispatch(
    cmd("mandate.issue_intent", otherDesk.id, {
      subjectId: otherDesk.id,
      parentId: rippedId,
      task: "a dead parent is not this deny",
      constraints: childConstraints,
    }),
  );
  const wide = rt.dispatch(
    cmd("mandate.issue_intent", otherDesk.id, {
      subjectId: otherDesk.id,
      parentId,
      task: "a wider nested slip is not this deny",
      constraints: wideConstraints,
    }),
  );
  const junior = rt.dispatch(
    cmd("mandate.issue_intent", scout.id, {
      subjectId: scout.id,
      parentId,
      task: "a junior nested mint is not this deny",
      constraints: childConstraints,
    }),
  );
  const ghost = rt.dispatch(
    cmd("mandate.issue_intent", otherDesk.id, {
      subjectId: otherDesk.id,
      parentId: "mid_01J6AETHERGHOSTPARENT00001",
      task: "a missing parent is not this deny",
      constraints: childConstraints,
    }),
  );
  const sneak = rt.dispatch(
    cmd("mandate.issue_intent", otherDesk.id, {
      subjectId: otherDesk.id,
      parentId,
      task: "cuckoo",
      constraints: childConstraints,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.child_party"),
    knownParentAllows: allowedRule(sneak, "mandate.known_parent"),
    parentFreshAllows: allowedRule(sneak, "mandate.parent_fresh"),
    tighterAllows: allowedRule(sneak, "mandate.child_tighter"),
    currencyAllows: allowedRule(sneak, "mandate.child_currency"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    minAllows: allowedRule(sneak, "ladder.min_level"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    intents: rt.intents.size,
    funded: rt.hires.get(hireId)?.state,
    ghostFirst: ghost.ok ? undefined : ghost.error.decision?.remediation?.ruleId,
    ghostChildAllows: allowedRule(ghost, "mandate.child_party"),
    rippedFirst: rippedAttempt.ok ? undefined : rippedAttempt.error.decision?.remediation?.ruleId,
    rippedChildDenies: deniedRule(rippedAttempt, "mandate.child_party"),
    wideFirst: wide.ok ? undefined : wide.error.decision?.remediation?.ruleId,
    wideChildDenies: deniedRule(wide, "mandate.child_party"),
    juniorFirst: junior.ok ? undefined : junior.error.decision?.remediation?.ruleId,
    juniorChildDenies: deniedRule(junior, "mandate.child_party"),
  };

  const legalAttempt = rt.dispatch(
    cmd("mandate.issue_intent", desk.id, {
      subjectId: scout.id,
      parentId,
      task: "the parent subject still nests a tighter child",
      constraints: childConstraints,
    }),
  );
  const legal = must(legalAttempt, "subject nest");
  const childId = (legal.data as { payload: { id: MandateId } }).payload.id;
  const afterLegal = {
    childAllows: allowedRule(legalAttempt, "mandate.child_party"),
    intents: rt.intents.size,
    parentId: (legal.data as { payload: { parentId?: string } }).payload.parentId,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after cuckoo deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after cuckoo deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && parentId.startsWith("mid_") && intentsBeforeSneak >= 3,
      1,
      "a listed seller still funds a hire, and an unused parent slip sits on the research desk",
      parentId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownParentAllows &&
        afterSneak.parentFreshAllows &&
        afterSneak.tighterAllows &&
        afterSneak.currencyAllows &&
        afterSneak.roleAllows &&
        afterSneak.minAllows &&
        afterSneak.firstDeny === "mandate.child_party" &&
        afterSneak.intents === intentsBeforeSneak &&
        afterSneak.funded === "funded" &&
        afterSneak.ghostFirst === "mandate.known_parent" &&
        afterSneak.ghostChildAllows &&
        afterSneak.rippedFirst === "mandate.parent_fresh" &&
        afterSneak.rippedChildDenies &&
        afterSneak.wideFirst === "mandate.child_tighter" &&
        afterSneak.wideChildDenies &&
        afterSneak.juniorFirst === "ladder.min_level" &&
        afterSneak.juniorChildDenies,
      2,
      "nesting under someone else's parent is mandate.child_party — not a missing parent, not a dead parent, not a wider nested slip, not a junior nested mint",
    ),
    expect(
      legal.replayed !== true &&
        afterLegal.childAllows &&
        afterLegal.intents === intentsBeforeSneak + 1 &&
        afterLegal.parentId === parentId &&
        childId.startsWith("mid_"),
      3,
      "the parent subject still nested a tighter child — the deny did not occupy the parent",
      childId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the cuckoo refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
