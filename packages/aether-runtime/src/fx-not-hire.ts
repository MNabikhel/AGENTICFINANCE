import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { CONVERSION_TLDR, analog } from "./story.js";
import { mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ConversionScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM"; rateE6: number; validUntil: string }>;
}

export interface ConversionReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadConversion(path: string): ConversionScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ConversionScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runConversion(scenario: ConversionScenario): ConversionReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = CONVERSION_TLDR;
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
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "research-vendor", displayName: "Research Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "mm", displayName: "Market Maker", role: "market_maker", autonomyLevel: 2 },
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
  const mm = rt.alias("mm");
  const auditor = rt.alias("auditor");
  const fx = scenario.quotes.fx!;

  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.intent.task,
        constraints: scenario.intent.constraints,
      }),
    ),
    "intent",
  );
  const intentId = (intent.data as { payload: { id: MandateId } }).payload.id;

  const rfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "an FX window is not a hire",
        invitedSellerIds: [mm.id],
      }),
    ),
    "fx rfq",
  );
  const quoted = must(
    rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: fx.amount, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: fx.rateE6,
          validUntil: fx.validUntil,
        },
        rateE6: fx.rateE6,
      }),
    ),
    "fx quote",
  );
  const quoteId = (quoted.data as { id: string }).id;
  const usdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcBefore = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const hiresBefore = rt.hires.size;

  const sneak = rt.dispatch(cmd("hire.create", desk.id, { quoteId, intentId }));
  const afterSneak = {
    denied: deniedRule(sneak, "hire.not_fx"),
    unspent: sneak.ok === false && sneak.error.decision?.trace.some((t) => t.ruleId === "hire.quote_unspent" && t.verdict === "allow") === true,
    hires: rt.hires.size,
    consumed: rt.consumedQuotes.has(quoteId),
    reserved: rt.reservedQuotes.has(quoteId),
  };

  const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "settle");
  const payout = (settled.data as { payout: number }).payout;
  const usdAfter = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;

  const spentHire = rt.dispatch(cmd("hire.create", desk.id, { quoteId, intentId }));

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const expectedPayout = Math.trunc((fx.amount * fx.rateE6) / 1_000_000);

  const results: TapResult[] = [
    expect(
      afterSneak.denied &&
        afterSneak.unspent &&
        afterSneak.hires === hiresBefore &&
        afterSneak.consumed === false &&
        afterSneak.reserved === false,
      1,
      "hire.create against an FX window is hire.not_fx",
      quoteId,
    ),
    expect(
      settled.replayed !== true &&
        payout === expectedPayout &&
        usdAfter === usdBefore - fx.amount &&
        usdcAfter === usdcBefore + expectedPayout,
      2,
      "the deny did not consume the window — settle still converts",
      String(payout),
    ),
    expect(rt.consumedQuotes.has(quoteId) && rt.hires.size === 0, 3, "settle consumes the quote; it is not a hire"),
    expect(deniedRule(spentHire, "hire.quote_unspent") && rt.hires.size === 0, 4, "a spent window is hire.quote_unspent, not a second hire"),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
