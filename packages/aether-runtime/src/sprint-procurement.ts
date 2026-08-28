import { readFileSync } from "node:fs";
import { payloadHash } from "@aether/kernel";
import type { MandateConstraint, PolicyDecision } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { analog, SPRINT_TLDR } from "./story.js";
import { completeHire, finishHire, mustDispatch } from "./hire-flow.js";

export interface Scenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  agents: { key: string; role: string; autonomyLevel: number; displayName: string }[];
  circuit: { dailyLimit: number };
  intentI1: { task: string; constraints: MandateConstraint[] };
  intentI2: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM"; rateE6?: number }>;
  allocation: { amount: number; currency: "USD_SIM" };
}

export interface TapResult {
  ok: boolean;
  id: number;
  name: string;
  detail?: string;
}

export interface DemoReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
  step13?: PolicyDecision;
  step17?: PolicyDecision;
}

export function loadScenario(path: string): Scenario {
  return JSON.parse(readFileSync(path, "utf8")) as Scenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

export function runSprintProcurement(scenario: Scenario): DemoReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SPRINT_TLDR;
  rt.analogDoc = analog();
  const must = mustDispatch;

  must(
    rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Ops Human",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    ),
    "register ops-human",
  );
  const human = rt.alias("ops-human");

  for (const a of scenario.agents) {
    if (a.key === "ops-human") continue;
    must(
      rt.dispatch(
        cmd("identity.register", human.id, {
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

  const procurement = rt.alias("procurement");
  const treasury = rt.alias("treasury");
  const dataVendor = rt.alias("data-vendor");
  const computeVendor = rt.alias("compute-vendor");
  const mm = rt.alias("mm");
  const auditor = rt.alias("auditor");

  const withPayees = (constraints: MandateConstraint[], extra: typeof dataVendor[]): MandateConstraint[] =>
    constraints.map((c) => {
      if (c.type !== "payment.allowed_payees") return c;
      return c;
    }).concat([
      {
        type: "payment.allowed_payees",
        allowed: extra.map((a) => ({ id: a.id, name: a.displayName, website: `https://${a.role}.aether.test` })),
      },
    ]);

  const intent1 = must(
    rt.dispatch(
      cmd("mandate.issue_intent", human.id, {
        subjectId: procurement.id,
        task: scenario.intentI1.task,
        constraints: withPayees(scenario.intentI1.constraints, [dataVendor, computeVendor, mm]),
      }),
    ),
    "intent I1",
  );
  const intentId1 = (intent1.data as { payload: { id: string } }).payload.id;

  must(
    rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "procurement:cash",
        amount: scenario.allocation,
      }),
    ),
    "allocate",
  );

  const dataHire = completeHire(rt, {
    buyer: procurement.id,
    seller: dataVendor.id,
    sku: "data.ticks.2026Q1",
    spec: "1e6 rows of Q1 ticks",
    price: scenario.quotes["data.ticks.2026Q1"]!,
    intentId: intentId1,
    qty: 1,
    deliverable: { rows: 1_000_000, cid: "sim:ticks" },
  });

  const rfqCompute = must(
    rt.dispatch(
      cmd("market.rfq", procurement.id, {
        sku: "compute.gpu.hours",
        spec: "200 GPU hours",
        invitedSellerIds: [computeVendor.id],
      }),
    ),
    "rfq compute",
  );
  const computeQuote = must(
    rt.dispatch(
      cmd("market.quote", computeVendor.id, {
        rfqId: (rfqCompute.data as { id: string }).id,
        price: scenario.quotes["compute.gpu.hours"],
      }),
    ),
    "quote compute",
  );

  const step13 = rt.dispatch(
    cmd("hire.create", procurement.id, {
      quoteId: (computeQuote.data as { id: string }).id,
      intentId: intentId1,
    }),
  );
  if (step13.ok) throw new Error("step 13 should deny");

  const intent2 = must(
    rt.dispatch(
      cmd("mandate.issue_intent", human.id, {
        subjectId: procurement.id,
        task: scenario.intentI2.task,
        constraints: withPayees(scenario.intentI2.constraints, [computeVendor]),
      }),
    ),
    "intent I2",
  );
  const intentId2 = (intent2.data as { payload: { id: string } }).payload.id;

  const step17 = rt.dispatch(
    cmd("hire.create", procurement.id, {
      quoteId: (computeQuote.data as { id: string }).id,
      intentId: intentId2,
    }),
  );
  if (!step17.ok || step17.value.kind !== "escalated" || !step17.value.ticket) {
    throw new Error("step 17 should escalate");
  }

  const approved = must(
    rt.dispatch(
      cmd("approval.resolve", treasury.id, {
        approvalId: step17.value.ticket.id,
        decision: "approved",
      }),
    ),
    "approve T1",
  );
  const computeHireId = (approved.data as { hire: { id: string } }).hire.id;

  finishHire(rt, {
    hireId: computeHireId,
    buyer: procurement.id,
    seller: computeVendor.id,
    sku: "compute.gpu.hours",
    intentId: intentId2,
    qty: 200,
    unitAmount: 3200,
    deliverable: { jobId: "sim:gpu-200" },
  });

  const fxRfq = must(
    rt.dispatch(
      cmd("market.rfq", procurement.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "Convert data-vendor USD proceeds",
        invitedSellerIds: [mm.id],
      }),
    ),
    "fx rfq",
  );
  const fxQuote = must(
    rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (fxRfq.data as { id: string }).id,
        price: { amount: scenario.quotes["fx.usd_sim.usdc_sim"]!.amount, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: scenario.quotes["fx.usd_sim.usdc_sim"]!.rateE6,
          validUntil: "2026-08-29T00:00:00.000Z",
        },
        rateE6: scenario.quotes["fx.usd_sim.usdc_sim"]!.rateE6,
      }),
    ),
    "fx quote",
  );
  must(
    rt.dispatch(
      cmd("market.fx_settle", dataVendor.id, {
        quoteId: (fxQuote.data as { id: string }).id,
      }),
    ),
    "fx settle",
  );

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const auditorSpend = rt.dispatch(
    cmd("envelope.submit", auditor.id, { hireId: dataHire.hireId, nonce: "auditor-should-fail" }),
  );

  const snap = rt.snapshotState();
  const dataReleased = [...rt.hires.values()].find((h) => h.sku === "data.ticks.2026Q1");
  const computeReleased = [...rt.hires.values()].find((h) => h.sku === "compute.gpu.hours");
  const procCash = rt.ledger.balanceByName("procurement:cash");
  const vendorUsdc = rt.ledger.balanceByName("data-vendor:usdc");
  const receipts = [...rt.receipts.values()];
  const binds = receipts.filter((r) => {
    const payment = [...rt.payments.values()].find((p) => payloadHash(p.payload) === r.reference);
    return payment !== undefined;
  });

  const step13Decision = step13.ok ? step13.value.decision : step13.error.decision;
  const step17Decision = step17.value.decision;

  const results: TapResult[] = [
    expect(rt.audit.length >= 25 && (verify.data as { ok: boolean }).ok === true, 1, "genesis hash-chain length >= 25"),
    expect(rt.audit.verify().ok, 2, "audit.verify ok"),
    expect(dataReleased?.state === "released" && receipts.length >= 1, 3, "hire data-vendor state=released receipt=Success"),
    expect(
      step13Decision.verdict === "deny" && step13Decision.trace.some((t) => t.ruleId === "payment.amount_range" && t.verdict === "deny"),
      4,
      "step 13 verdict=deny ruleIds∋payment.amount_range",
    ),
    expect(
      step17Decision.verdict === "escalate" && step17Decision.trace.some((t) => t.ruleId === "approval.threshold" && t.verdict === "escalate"),
      5,
      "step 17 verdict=escalate ruleIds∋approval.threshold",
    ),
    expect(computeReleased?.state === "released", 6, "hire compute-vendor state=released after treasury approval"),
    expect(procCash.amount === 780000 && procCash.currency === "USD_SIM", 7, "procurement cash = 780000", String(procCash.amount)),
    expect(vendorUsdc.amount === 79840 && vendorUsdc.currency === "USDC_SIM", 8, "data-vendor USDC_SIM = 79840", String(vendorUsdc.amount)),
    expect(
      !auditorSpend.ok && auditorSpend.error.decision.trace.some((t) => t.ruleId === "actor.role_capability" && t.verdict === "deny"),
      9,
      "auditor spend denied",
    ),
    expect(binds.length >= 2, 10, "receipts R1,R2 reference === sha256(JCS(paymentMandate))", String(binds.length)),
  ];

  return {
    ok: results.every((r) => r.ok),
    results,
    snapshot: snap,
    runtime: rt,
    step13: step13Decision,
    step17: step17Decision,
  };
}
