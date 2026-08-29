import { readFileSync } from "node:fs";
import { PROTOCOL, type MandateConstraint, type MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SEAT_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface HostUniqueScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface HostUniqueReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadHostUnique(path: string): HostUniqueScenario {
  return JSON.parse(readFileSync(path, "utf8")) as HostUniqueScenario;
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

export function runHostUnique(scenario: HostUniqueScenario): HostUniqueReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
    hosted: true,
  });
  rt.tldr = SEAT_TLDR;
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

  const sub = must(rt.dispatch(cmd("host.subscribe", desk.id, { intentId })), "first subscribe");
  const rowId = (sub.data as { id: string }).id;
  const afterFirst = {
    size: rt.subscriptions.size,
    rowId,
    publicPin: PROTOCOL.hosted,
    hostedCard: rt.protocolCard().hosted,
  };

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
    spec: "brief while subscribed",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire while subscribed");
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
  const spendNotGated = allowedRule(live.attempt, "host.unique_subscriber");

  const sneakIntent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "a second slip is not a second seat",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "second desk slip",
  );
  const sneakIntentId = (sneakIntent.data as { payload: { id: MandateId } }).payload.id;
  const sneak = rt.dispatch(cmd("host.subscribe", desk.id, { intentId: sneakIntentId }));
  const afterSneak = {
    denied: deniedRule(sneak, "host.unique_subscriber"),
    hostedAllows: allowedRule(sneak, "host.not_hosted"),
    humanAllows: allowedRule(sneak, "host.human_authority"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    size: rt.subscriptions.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const founderIntent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: founder.id,
        task: "a different subscriber takes its own seat",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100 }],
      }),
    ),
    "founder slip",
  );
  const founderIntentId = (founderIntent.data as { payload: { id: MandateId } }).payload.id;
  const founderSub = must(
    rt.dispatch(cmd("host.subscribe", founder.id, { intentId: founderIntentId })),
    "founder subscribe",
  );
  const afterOther = {
    size: rt.subscriptions.size,
    founderRow: (founderSub.data as { id: string }).id,
    subscribers: new Set([...rt.subscriptions.values()].map((s) => s.subscriberId)),
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after seat deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after seat deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterFirst.publicPin === false &&
        afterFirst.hostedCard === true &&
        afterFirst.rowId.startsWith("hsb_") &&
        afterFirst.size === 1 &&
        sub.replayed !== true,
      1,
      "hosted subscribe records one row — PROTOCOL.hosted stays false",
      rowId,
    ),
    expect(
      hired.replayed !== true && fundedState === "funded" && spendNotGated && rt.hires.size === 1,
      2,
      "spend is not gated on the subscribe row",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.hostedAllows &&
        afterSneak.humanAllows &&
        afterSneak.firstDeny === "host.unique_subscriber" &&
        afterSneak.size === 1 &&
        afterSneak.funded === "funded",
      3,
      "second subscribe is host.unique_subscriber — a fresh slip is not a second seat",
      sneakIntentId,
    ),
    expect(
      afterOther.size === 2 &&
        afterOther.founderRow.startsWith("hsb_") &&
        afterOther.subscribers.size === 2 &&
        afterOther.subscribers.has(desk.id) &&
        afterOther.subscribers.has(founder.id),
      4,
      "a different subscriber takes its own seat",
      afterOther.founderRow,
    ),
    expect(released && rt.hires.size === 1, 5, "that funded work still releases after the seat is occupied", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 6, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
