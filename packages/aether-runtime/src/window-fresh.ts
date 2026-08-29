import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { WILT_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface WindowFreshScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  deadNotAfter: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface WindowFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadWindowFresh(path: string): WindowFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as WindowFreshScenario;
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

export function runWindowFresh(scenario: WindowFreshScenario): WindowFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = WILT_TLDR;
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
    spec: "a slip cannot be born with a closed calendar",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire before corpse calendar");
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
  const intentsBeforeSneak = rt.intents.size;

  const sneak = rt.dispatch(
    cmd("mandate.issue_intent", founder.id, {
      subjectId: desk.id,
      task: "buy last year",
      constraints: [
        ...scenario.intent.constraints,
        payees,
        { type: "payment.execution_date", not_after: scenario.deadNotAfter },
      ],
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.window_fresh"),
    reachAllows: allowedRule(sneak, "mandate.window_reach"),
    spendAllows: allowedRule(sneak, "payment.execution_date"),
    knownAllows: allowedRule(sneak, "identity.known"),
    parentAllows: allowedRule(sneak, "mandate.known_parent"),
    occurrenceAllows: allowedRule(sneak, "mandate.occurrence_fresh"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    intents: rt.intents.size,
  };

  const reached = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy this week with no closed calendar",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "live slip",
  );
  const liveId = (reached.data as { payload: { id: MandateId } }).payload.id;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after wilt deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after wilt deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && intentsBeforeSneak === 1,
      1,
      "the first human still sits after an $800 hire funds on a live slip",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.reachAllows &&
        afterSneak.spendAllows &&
        afterSneak.knownAllows &&
        afterSneak.parentAllows &&
        afterSneak.occurrenceAllows &&
        afterSneak.firstDeny === "mandate.window_fresh" &&
        afterSneak.intents === intentsBeforeSneak,
      2,
      "a slip born with a closed calendar is mandate.window_fresh — a window that opens after the slip dies is not this deny, a hire-time calendar is not this deny",
      scenario.deadNotAfter,
    ),
    expect(
      reached.replayed !== true && rt.intents.size === 2,
      3,
      "a slip without a closed calendar still mints — the deny did not write a corpse",
      liveId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the corpse calendar is refused", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
