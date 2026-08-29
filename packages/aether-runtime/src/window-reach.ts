import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { REACH_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface WindowReachScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  unreachable: { not_before: string; not_after: string };
  reachable: { not_before: string; not_after: string };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface WindowReachReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadWindowReach(path: string): WindowReachScenario {
  return JSON.parse(readFileSync(path, "utf8")) as WindowReachScenario;
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

export function runWindowReach(scenario: WindowReachScenario): WindowReachReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = REACH_TLDR;
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
  const price = scenario.quotes.once!;

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
    spec: "while the slip still overlaps a window",
    price,
    intentId,
  });
  const hired = must(live.attempt, "hire under live slip");
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
  const intentsBeforeSneak = rt.intents.size;

  const calendar = (win: { not_before: string; not_after: string }): MandateConstraint => ({
    type: "payment.execution_date",
    not_before: win.not_before,
    not_after: win.not_after,
  });

  const sneak = rt.dispatch(
    cmd("mandate.issue_intent", founder.id, {
      subjectId: desk.id,
      task: "buy after this slip would already be dead",
      constraints: [...scenario.intent.constraints, payees, calendar(scenario.unreachable)],
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.window_reach"),
    freshAllows: allowedRule(sneak, "mandate.window_fresh"),
    spendAllows: allowedRule(sneak, "payment.execution_date"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    intents: rt.intents.size,
  };

  const reached = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy next week while this slip still lives",
        constraints: [...scenario.intent.constraints, payees, calendar(scenario.reachable)],
      }),
    ),
    "reachable window",
  );
  const reachedId = (reached.data as { payload: { id: MandateId } }).payload.id;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after reach deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after reach deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && intentsBeforeSneak === 1,
      1,
      "desk hire.create allows and funds while the slip still overlaps a window",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.freshAllows &&
        afterSneak.spendAllows &&
        afterSneak.firstDeny === "mandate.window_reach" &&
        afterSneak.intents === intentsBeforeSneak,
      2,
      "a calendar that opens after the slip dies is mandate.window_reach — not a written corpse",
    ),
    expect(
      reached.replayed !== true && rt.intents.size === 2,
      3,
      "a future not_before that still opens while the slip lives still mints",
      reachedId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the horizon refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
