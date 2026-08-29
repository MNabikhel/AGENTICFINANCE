import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SLOT_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface SlotScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface SlotReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadSlot(path: string): SlotScenario {
  return JSON.parse(readFileSync(path, "utf8")) as SlotScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runSlot(scenario: SlotScenario): SlotReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SLOT_TLDR;
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
  const deskOpen = rt.ledger.balance(desk.accountId);

  const offered = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "brief to unwind",
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
  const afterFund = {
    spent: rt.spentByIntent.get(intentId) ?? -1,
    slots: rt.occurrences.get(intentId) ?? -1,
    desk: rt.ledger.balance(desk.accountId),
    state: rt.hires.get(hireId)?.state,
  };

  must(rt.dispatch(cmd("hire.refund", desk.id, { hireId })), "refund");
  const afterRefund = {
    spent: rt.spentByIntent.get(intentId) ?? -1,
    slots: rt.occurrences.get(intentId) ?? -1,
    desk: rt.ledger.balance(desk.accountId),
    state: rt.hires.get(hireId)?.state,
  };

  const second = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "slot was not restored",
    price: scenario.quotes.once!,
    intentId,
  });

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterFund.state === "funded" && afterFund.spent === scenario.quotes.once!.amount && afterFund.slots === 1,
      1,
      "fund occupies mandate spend and the one cadence slot",
      `${afterFund.spent}/${afterFund.slots}`,
    ),
    expect(
      afterRefund.state === "refunded" && afterRefund.spent === 0 && afterRefund.desk === deskOpen,
      2,
      "refund returns cash and restores spend",
      `${afterRefund.desk}/${afterRefund.spent}`,
    ),
    expect(afterRefund.slots === 1, 3, "a refund does not restore the cadence slot", String(afterRefund.slots)),
    expect(
      deniedRule(second.attempt, "payment.recurrence") && rt.hires.size === 1 && !rt.consumedQuotes.has(second.quoteId),
      4,
      "second hire.create is payment.recurrence",
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
