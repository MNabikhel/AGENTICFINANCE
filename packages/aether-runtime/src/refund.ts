import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { REFUND_TLDR, analog } from "./story.js";
import { completeHire, fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface RefundScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface RefundReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadRefund(path: string): RefundScenario {
  return JSON.parse(readFileSync(path, "utf8")) as RefundScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runRefund(scenario: RefundScenario): RefundReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = REFUND_TLDR;
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
  const vendorCashOpen = rt.ledger.balance(vendor.accountId);
  const unwindPrice = scenario.quotes.unwind!;

  const offered = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "brief to unwind",
    price: unwindPrice,
    intentId,
  });
  const hire = must(offered.attempt, "hire unwind");
  const hireId = (hire.data as { id: string }).id as HireId;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: unwindPrice.amount,
  });

  const funded = rt.hires.get(hireId);
  const afterFund = {
    desk: rt.ledger.balance(desk.accountId),
    vendor: rt.ledger.balance(vendor.accountId),
    escrow: funded ? rt.ledger.balance(funded.escrowAccountId) : -1,
    spent: rt.spentByIntent.get(intentId as MandateId) ?? -1,
    net: rt.clearing.pairNet(desk.id, vendor.id, "USD_SIM"),
    state: funded?.state,
  };

  const trip = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "would blow the daily fuse",
    price: scenario.quotes.trip!,
    intentId,
  });
  const fuseBlew = deniedRule(trip.attempt, "circuit.daily") && rt.circuitTripped;

  const refund = must(rt.dispatch(cmd("hire.refund", desk.id, { hireId })), "refund");
  const refunded = rt.hires.get(hireId);
  const afterRefund = {
    desk: rt.ledger.balance(desk.accountId),
    vendor: rt.ledger.balance(vendor.accountId),
    escrow: refunded ? rt.ledger.balance(refunded.escrowAccountId) : -1,
    spent: rt.spentByIntent.get(intentId as MandateId) ?? -1,
    net: rt.clearing.pairNet(desk.id, vendor.id, "USD_SIM"),
    legs: rt.clearing.snapshot().legs.length,
    state: refunded?.state,
    tripped: rt.circuitTripped,
    dailySpend: rt.dailySpend,
  };

  const sticky = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "fuse still sticky after refund",
    price: scenario.quotes.trip!,
    intentId,
  });

  must(rt.dispatch(cmd("circuit.reset", treasury.id, {})), "circuit.reset");

  const reuse = rt.dispatch(
    cmd("hire.create", desk.id, { quoteId: offered.quoteId, intentId }, "refund-tap-quote-spent"),
  );

  const delivered = completeHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "work that shipped",
    price: scenario.quotes.delivered!,
    intentId,
    qty: 1,
    deliverable: { n: 1 },
  });
  const afterDeliver = rt.dispatch(cmd("hire.refund", desk.id, { hireId: delivered.hireId }));

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterFund.state === "funded" &&
        afterFund.desk === deskCashOpen - unwindPrice.amount &&
        afterFund.escrow === unwindPrice.amount &&
        afterFund.vendor === vendorCashOpen &&
        afterFund.spent === unwindPrice.amount,
      1,
      "fund locks buyer cash in escrow and occupies mandate spend",
      `${afterFund.desk}/${afterFund.escrow}/${afterFund.spent}`,
    ),
    expect(afterFund.net === unwindPrice.amount, 2, "open book shows gross desk→vendor after fund", String(afterFund.net)),
    expect(fuseBlew, 3, "over-cap hire denied by circuit.daily and the fuse blows"),
    expect(
      (refund.data as { state: string }).state === "refunded" && afterRefund.state === "refunded",
      4,
      "hire.refund is allowed from funded",
    ),
    expect(
      afterRefund.desk === deskCashOpen &&
        afterRefund.escrow === 0 &&
        afterRefund.vendor === vendorCashOpen &&
        afterRefund.spent === 0,
      5,
      "refund returns cash, empties escrow, restores spend; vendor never received",
      `${afterRefund.desk}/${afterRefund.escrow}/${afterRefund.spent}`,
    ),
    expect(
      afterRefund.legs === 2 && afterRefund.net === 0,
      6,
      "clearing reverse-records the pair; net is zero",
      `${afterRefund.legs}/${afterRefund.net}`,
    ),
    expect(
      afterRefund.tripped === true && afterRefund.dailySpend === 0 && deniedRule(sticky.attempt, "circuit.daily"),
      7,
      "refund does not untrip the daily fuse",
    ),
    expect(
      rt.consumedQuotes.has(offered.quoteId) && deniedRule(reuse, "hire.quote_unspent"),
      8,
      "a refund does not restore the quote",
    ),
    expect(deniedRule(afterDeliver, "hire.state"), 9, "refund after deliver is hire.state"),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 10, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
