import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { HEIR_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface MandateParentScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  beforeParentDies: string;
  afterParent: string;
  parent: { task: string; constraints: MandateConstraint[] };
  child: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface MandateParentReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadMandateParent(path: string): MandateParentScenario {
  return JSON.parse(readFileSync(path, "utf8")) as MandateParentScenario;
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

export function runMandateParent(scenario: MandateParentScenario): MandateParentReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = HEIR_TLDR;
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
  const auditor = rt.alias("auditor");
  const price = scenario.quotes.once!;

  const parent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.parent.task,
        constraints: scenario.parent.constraints,
      }),
    ),
    "parent intent",
  );
  const parentId = (parent.data as { payload: { id: MandateId } }).payload.id;

  rt.clock.set(scenario.beforeParentDies);

  const child = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        parentId,
        task: scenario.child.task,
        constraints: scenario.child.constraints,
      }),
    ),
    "child intent",
  );
  const childId = (child.data as { payload: { id: MandateId } }).payload.id;

  const live = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "while the parent slip lives",
    price,
    intentId: childId,
  });
  const hired = must(live.attempt, "hire while parent lives");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId: childId,
    qty: 1,
    unitAmount: price.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const hiresBeforeSneak = rt.hires.size;

  rt.clock.set(scenario.afterParent);

  const sneak = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "after the parent slip died",
    price,
    intentId: childId,
  });
  const afterSneak = {
    denied: deniedRule(sneak.attempt, "mandate.parent_fresh"),
    childStillLive: allowedRule(sneak.attempt, "mandate.not_expired"),
    notHop: allowedRule(sneak.attempt, "kya.parent_fresh"),
    firstDeny: sneak.attempt.ok ? undefined : sneak.attempt.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    consumed: rt.consumedQuotes.has(sneak.quoteId),
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after parent");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after parent",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && hiresBeforeSneak === 1,
      1,
      "desk hire.create allows and funds against the child while the parent slip lives",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.childStillLive &&
        afterSneak.notHop &&
        afterSneak.firstDeny === "mandate.parent_fresh" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.consumed === false,
      2,
      "new hire after the parent slip dies is mandate.parent_fresh",
      sneak.quoteId,
    ),
    expect(released && rt.hires.size === 1, 3, "that funded work still releases after the parent slip dies", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
