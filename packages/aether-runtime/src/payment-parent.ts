import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { COVER_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ParentBudgetScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  parent: { task: string; constraints: MandateConstraint[] };
  child: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface ParentBudgetReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadParentBudget(path: string): ParentBudgetScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ParentBudgetScenario;
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

export function runParentBudget(scenario: ParentBudgetScenario): ParentBudgetReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = COVER_TLDR;
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
  const firstPrice = scenario.quotes.first!;
  const sneakPrice = scenario.quotes.sneak!;

  must(
    rt.dispatch(
      cmd("kya.attest", founder.id, {
        delegateId: desk.id,
        principalId: founder.id,
        maxAutonomy: 4,
      }),
    ),
    "kya desk",
  );
  must(
    rt.dispatch(
      cmd("kya.attest", desk.id, {
        delegateId: scout.id,
        principalId: desk.id,
        maxAutonomy: 3,
      }),
    ),
    "kya scout",
  );

  const payees: MandateConstraint = {
    type: "payment.allowed_payees",
    allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
  };

  const parent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.parent.task,
        constraints: [...scenario.parent.constraints, payees],
      }),
    ),
    "parent intent",
  );
  const parentId = (parent.data as { payload: { id: MandateId } }).payload.id;

  const child = must(
    rt.dispatch(
      cmd("mandate.issue_intent", desk.id, {
        subjectId: scout.id,
        parentId,
        task: scenario.child.task,
        constraints: [...scenario.child.constraints, payees],
      }),
    ),
    "child intent",
  );
  const childId = (child.data as { payload: { id: MandateId } }).payload.id;

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
    spec: "parent envelope still has room",
    price: firstPrice,
    intentId: parentId,
  });
  const hired = must(live.attempt, "desk hire against parent");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId: parentId,
    qty: 1,
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const parentSpent = rt.spentByIntent.get(parentId) ?? 0;
  const childSpent = rt.spentByIntent.get(childId) ?? 0;
  const hiresBeforeSneak = rt.hires.size;

  const sneak = offerHire(rt, {
    buyer: scout.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "child leftover the parent envelope refuses",
    price: sneakPrice,
    intentId: childId,
  });
  const afterSneak = {
    denied: deniedRule(sneak.attempt, "payment.parent_budget"),
    childBudgetAllows: allowedRule(sneak.attempt, "payment.budget"),
    itemCapAllows: allowedRule(sneak.attempt, "payment.amount_range"),
    firstDeny: sneak.attempt.ok ? undefined : sneak.attempt.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    consumed: rt.consumedQuotes.has(sneak.quoteId),
    parentSpent: rt.spentByIntent.get(parentId) ?? 0,
    childSpent: rt.spentByIntent.get(childId) ?? 0,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after parent-budget deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after parent-budget deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        parentSpent === firstPrice.amount &&
        childSpent === 0 &&
        hiresBeforeSneak === 1,
      1,
      "desk hire.create allows and funds against the parent while the envelope still has room",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.childBudgetAllows &&
        afterSneak.itemCapAllows &&
        afterSneak.firstDeny === "payment.parent_budget" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.consumed === false &&
        afterSneak.parentSpent === firstPrice.amount &&
        afterSneak.childSpent === 0,
      2,
      "scout hire is payment.parent_budget — the child's own envelope still allows",
      sneak.quoteId,
    ),
    expect(released && rt.hires.size === 1, 3, "that funded parent work still releases after the envelope is spent", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
