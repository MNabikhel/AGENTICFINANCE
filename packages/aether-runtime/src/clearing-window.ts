import { readFileSync } from "node:fs";
import type { MandateConstraint } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { CLEARING_TLDR, analog } from "./story.js";
import { completeHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ClearingWindowScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  bilateralLimit: number;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface ClearingWindowReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadClearingWindow(path: string): ClearingWindowScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ClearingWindowScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runClearingWindow(scenario: ClearingWindowScenario): ClearingWindowReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
    bilateralLimit: scenario.bilateralLimit,
  });
  rt.tldr = CLEARING_TLDR;
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

  completeHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "first brief",
    price: scenario.quotes.first!,
    intentId,
    qty: 1,
    deliverable: { n: 1 },
  });

  const afterFirst = rt.clearing.snapshot();
  const vendorCashBeforeWindow = rt.ledger.balance(vendor.accountId);

  const over = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "would blow the credit line",
    price: scenario.quotes.over!,
    intentId,
  });

  const window = must(
    rt.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USD_SIM" })),
    "settle window",
  );
  const photo = window.data as {
    id: string;
    legsConsumed: number;
    grossVolume: number;
    netVolume: number;
  };
  const vendorCashAfterWindow = rt.ledger.balance(vendor.accountId);
  const afterWindow = rt.clearing.snapshot();

  completeHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "after the photo",
    price: scenario.quotes.over!,
    intentId,
    qty: 1,
    deliverable: { n: 2 },
  });

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const released = [...rt.hires.values()].filter((h) => h.state === "released");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(afterFirst.bilateralLimit === scenario.bilateralLimit, 1, "instance bilateral limit is the TAP cap", String(afterFirst.bilateralLimit)),
    expect(
      afterFirst.usd.netting.some((n) => n.from === desk.id && n.to === vendor.id && n.net === scenario.quotes.first!.amount),
      2,
      "open book shows gross desk→vendor after the first hire",
    ),
    expect(deniedRule(over.attempt, "clearing.bilateral_limit"), 3, "second hire denied by clearing.bilateral_limit"),
    expect(
      photo.legsConsumed === 1 && photo.grossVolume === scenario.quotes.first!.amount,
      4,
      "window photographs open gross, not a second payment",
      `${photo.legsConsumed}/${photo.grossVolume}`,
    ),
    expect(vendorCashAfterWindow === vendorCashBeforeWindow, 5, "settle_window does not move cash", String(vendorCashBeforeWindow)),
    expect(afterWindow.legs.length === 0 && afterWindow.windows.length === 1, 6, "open book empties; the photo stays"),
    expect(released.length === 2, 7, "after the photo the smaller hire released", String(released.length)),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 8, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
