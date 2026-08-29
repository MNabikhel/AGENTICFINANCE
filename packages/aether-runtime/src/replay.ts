import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { REPLAY_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ReplayScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface ReplayReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadReplay(path: string): ReplayScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ReplayScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runReplay(scenario: ReplayScenario): ReplayReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = REPLAY_TLDR;
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
  const intentId = (intent.data as { payload: { id: string } }).payload.id;

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

  const deskCashOpen = rt.ledger.balance(desk.accountId);
  const price = scenario.quotes.once!;

  const offered = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "brief funded once",
    price,
    intentId,
  });
  const hire = must(offered.attempt, "hire.create");
  const hireId = (hire.data as { id: string }).id as HireId;
  const createReplay = rt.dispatch(cmd("hire.create", desk.id, { quoteId: offered.quoteId, intentId }));

  const funded = fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: price.amount,
  });
  const row = rt.hires.get(hireId);
  const afterFund = {
    desk: rt.ledger.balance(desk.accountId),
    escrow: row ? rt.ledger.balance(row.escrowAccountId) : -1,
    journals: rt.journals.length,
  };

  const fundReplay = rt.dispatch(
    cmd("hire.fund", desk.id, { hireId, paymentMandateId: funded.paymentId }),
  );
  const afterReplay = {
    desk: rt.ledger.balance(desk.accountId),
    escrow: row ? rt.ledger.balance(row.escrowAccountId) : -1,
    journals: rt.journals.length,
  };

  const secondKey = rt.dispatch(
    cmd("hire.create", desk.id, { quoteId: offered.quoteId, intentId }, "replay-tap-quote-spent"),
  );

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterFund.desk === deskCashOpen - price.amount && afterFund.escrow === price.amount,
      1,
      "fund moves buyer cash into escrow once",
      `${afterFund.desk}/${afterFund.escrow}`,
    ),
    expect(
      createReplay.ok === true && createReplay.value.replayed === true && (createReplay.value.data as { id: string }).id === hireId,
      2,
      "the same hire.create replays the same contract",
    ),
    expect(
      fundReplay.ok === true &&
        fundReplay.value.replayed === true &&
        afterReplay.desk === afterFund.desk &&
        afterReplay.escrow === afterFund.escrow &&
        afterReplay.journals === afterFund.journals,
      3,
      "the same hire.fund replays; cash does not move again",
      `${afterReplay.desk}/${afterReplay.journals}`,
    ),
    expect(deniedRule(secondKey, "hire.quote_unspent"), 4, "a new key on that spent quote is hire.quote_unspent"),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
