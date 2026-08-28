import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SUBHIRE_TLDR, analog } from "./story.js";
import { completeHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface SubHireScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  parent: { task: string; constraints: MandateConstraint[] };
  wideChild: { task: string; constraints: MandateConstraint[] };
  child: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface SubHireReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadSubHire(path: string): SubHireScenario {
  return JSON.parse(readFileSync(path, "utf8")) as SubHireScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny");
}

export function runSubHire(scenario: SubHireScenario): SubHireReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SUBHIRE_TLDR;
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
  const parentId = (parent.data as { payload: { id: string } }).payload.id;

  const wide = rt.dispatch(
    cmd("mandate.issue_intent", desk.id, {
      subjectId: scout.id,
      parentId,
      task: scenario.wideChild.task,
      constraints: [...scenario.wideChild.constraints, payees],
    }),
  );

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
  const childId = (child.data as { payload: { id: string } }).payload.id;
  const childParent = (child.data as { payload: { parentId?: string } }).payload.parentId;

  must(
    rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "scout:cash",
        amount: scenario.allocation,
      }),
    ),
    "fund scout",
  );

  completeHire(rt, {
    buyer: scout.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "field notes",
    price: scenario.quotes.cheap!,
    intentId: childId,
    qty: 1,
    deliverable: { notes: 12 },
  });

  const over = offerHire(rt, {
    buyer: scout.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "too big for the child slip",
    price: scenario.quotes.over!,
    intentId: childId,
  });

  const parentSpent = rt.spentByIntent.get(parentId as MandateId) ?? 0;
  const childSpent = rt.spentByIntent.get(childId as MandateId) ?? 0;

  must(
    rt.dispatch(cmd("kya.revoke", desk.id, { principalId: desk.id, delegateId: scout.id })),
    "revoke scout",
  );

  const revoked = offerHire(rt, {
    buyer: scout.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "after revoke",
    price: scenario.quotes.cheap!,
    intentId: childId,
  });

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const released = [...rt.hires.values()].filter((h) => h.state === "released");

  const snap = rt.snapshotState();
  const results: TapResult[] = [
    expect(deniedRule(wide, "mandate.child_tighter"), 1, "sub-intent cannot be wider than parent"),
    expect(childParent === parentId, 2, "child intent.parentId binds to parent"),
    expect(released.length === 1, 3, "scout $800 hire released", String(released.length)),
    expect(deniedRule(over.attempt, "payment.amount_range"), 4, "$2,500 denied by child amount_range"),
    expect(parentSpent === 80000 && childSpent === 80000, 5, "child spend counts against parent budget", `${parentSpent}/${childSpent}`),
    expect(deniedRule(revoked.attempt, "kya.chain_intact"), 6, "revoked desk→scout handshake blocks spend"),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 7, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
