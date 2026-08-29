import { readFileSync } from "node:fs";
import { Runtime, cmd } from "./index.js";
import { BAND_TLDR, analog } from "./story.js";
import { mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface SpreadBoundScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  quotes: Record<string, { amount: number; currency: "USD_SIM"; rateE6: number; decoyRateE6: number; validUntil: string }>;
}

export interface SpreadBoundReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadSpreadBound(path: string): SpreadBoundScenario {
  return JSON.parse(readFileSync(path, "utf8")) as SpreadBoundScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runSpreadBound(scenario: SpreadBoundScenario): SpreadBoundReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = BAND_TLDR;
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

  const rfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "a 200bps band is not decoration",
        invitedSellerIds: [mm.id],
      }),
    ),
    "fx rfq",
  );
  const rfqId = (rfq.data as { id: string }).id;
  const quotesBeforeSneak = rt.quotes.size;

  const sneak = rt.dispatch(
    cmd("market.quote", mm.id, {
      rfqId,
      price: { amount: fx.amount, currency: "USD_SIM" },
      fx: {
        from: "USD_SIM",
        to: "USDC_SIM",
        rateE6: fx.rateE6,
        validUntil: fx.validUntil,
      },
      rateE6: fx.decoyRateE6,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mm.spread_bound"),
    quotes: rt.quotes.size,
  };

  const quoted = must(
    rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId,
        price: { amount: fx.amount, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: fx.decoyRateE6,
          validUntil: fx.validUntil,
        },
        rateE6: fx.rateE6,
      }),
    ),
    "in-band quote",
  );
  const quoteId = (quoted.data as { id: string }).id;
  const nestedRate = (quoted.data as { fx?: { rateE6: number } }).fx?.rateE6;

  const usdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcBefore = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "settle");
  const payout = (settled.data as { payout: number }).payout;
  const usdAfter = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const expectedPayout = Math.trunc((fx.amount * fx.decoyRateE6) / 1_000_000);

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterSneak.denied && afterSneak.quotes === quotesBeforeSneak,
      1,
      "off-band nested rate is mm.spread_bound — a decoy top-level rate is not the band",
      rfqId,
    ),
    expect(
      quoted.replayed !== true && nestedRate === fx.decoyRateE6 && rt.quotes.size === 1,
      2,
      "in-band nested quote allows — the deny did not occupy the room",
      quoteId,
    ),
    expect(
      settled.replayed !== true &&
        payout === expectedPayout &&
        usdAfter === usdBefore - fx.amount &&
        usdcAfter === usdcBefore + expectedPayout &&
        rt.consumedQuotes.has(quoteId),
      3,
      "the band is not a freeze on a legal window — settle still converts",
      String(payout),
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
