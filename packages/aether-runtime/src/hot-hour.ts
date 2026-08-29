import { readFileSync } from "node:fs";
import { VELOCITY_CAPS, type HireId, type MandateConstraint, type MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { VELOCITY_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface VelocityScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface VelocityReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadVelocity(path: string): VelocityScenario {
  return JSON.parse(readFileSync(path, "utf8")) as VelocityScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function heatHour(rt: Runtime) {
  const at = rt.clock.now();
  while (rt.settleEvents.length <= VELOCITY_CAPS.maxCount) {
    rt.settleEvents.push({ at, volume: 1 });
  }
}

function escalatedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (!attempt.ok) return false;
  return (
    attempt.value.kind === "escalated" &&
    attempt.value.decision.trace.some((t) => t.ruleId === ruleId && t.verdict === "escalate") === true
  );
}

export function runVelocity(scenario: VelocityScenario): VelocityReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = VELOCITY_TLDR;
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

  const offered = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "brief before the hour ran hot",
    price: scenario.quotes.once!,
    intentId,
  });
  const hire = must(offered.attempt, "hire");
  const hireId = (hire.data as { id: string }).id as HireId;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: scenario.quotes.once!.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;

  heatHour(rt);

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after heat");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })), "submit after heat");
  const released = rt.hires.get(hireId)?.state === "released";

  const late = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "after the hour ran hot",
    price: scenario.quotes.once!,
    intentId,
  });
  const lateAllow = late.attempt.ok === true && late.attempt.value.replayed !== true;

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(fundedState === "funded", 1, "cool hour funds once", hireId),
    expect(released, 2, "after the hour runs hot the funded hire still releases"),
    expect(
      lateAllow &&
        escalatedRule(late.attempt, "velocity.window") &&
        rt.hires.size === 1 &&
        rt.reservedQuotes.has(late.quoteId),
      3,
      "new hire.create is velocity.window",
      late.quoteId,
    ),
    expect(
      !rt.consumedQuotes.has(late.quoteId) && rt.approvals.size === 1,
      4,
      "the pause holds the quote; it is not a second hire",
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
