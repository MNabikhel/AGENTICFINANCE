import { readFileSync } from "node:fs";
import { Runtime, cmd } from "./index.js";
import { STOCK_TLDR, analog } from "./story.js";
import { mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface MmInventoryScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  quotes: Record<
    string,
    { amount: number; currency: "USD_SIM"; rateE6: number; validUntil: string }
  >;
}

export interface MmInventoryReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadMmInventory(path: string): MmInventoryScenario {
  return JSON.parse(readFileSync(path, "utf8")) as MmInventoryScenario;
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

export function runMmInventory(scenario: MmInventoryScenario): MmInventoryReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = STOCK_TLDR;
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
  const large = scenario.quotes.large!;
  const small = scenario.quotes.small!;

  const largeRfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "empty MM USDC is not a missing maker",
        invitedSellerIds: [mm.id],
      }),
    ),
    "large rfq",
  );
  const largeQuoted = must(
    rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (largeRfq.data as { id: string }).id,
        price: { amount: large.amount, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: large.rateE6,
          validUntil: large.validUntil,
        },
      }),
    ),
    "large quote",
  );
  const largeQuoteId = (largeQuoted.data as { id: string }).id;
  const mmUsdcBefore = rt.ledger.balanceByName("market_maker:cash_usdc").amount;
  const vendorUsdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;

  const sneak = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId: largeQuoteId }));
  const afterSneak = {
    denied: deniedRule(sneak, "mm.inventory"),
    notBand: allowedRule(sneak, "mm.spread_bound"),
    notMaker: allowedRule(sneak, "mm.known"),
    notVendorOverdraft: allowedRule(sneak, "ledger.sufficient"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    consumed: rt.consumedQuotes.has(largeQuoteId),
    mmUsdc: rt.ledger.balanceByName("market_maker:cash_usdc").amount,
    vendorUsd: rt.ledger.balanceByName("research-vendor:cash").amount,
  };

  const smallRfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "a thin book is not a freeze on a smaller window",
        invitedSellerIds: [mm.id],
      }),
    ),
    "small rfq",
  );
  const smallQuoted = must(
    rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (smallRfq.data as { id: string }).id,
        price: { amount: small.amount, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: small.rateE6,
          validUntil: small.validUntil,
        },
      }),
    ),
    "small quote",
  );
  const smallQuoteId = (smallQuoted.data as { id: string }).id;
  const expectedSmallPayout = Math.trunc((small.amount * small.rateE6) / 1_000_000);
  const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId: smallQuoteId })), "small settle");
  const payout = (settled.data as { payout: number }).payout;
  const mmUsdcAfter = rt.ledger.balanceByName("market_maker:cash_usdc").amount;
  const vendorUsdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterSneak.denied &&
        afterSneak.notBand &&
        afterSneak.notMaker &&
        afterSneak.notVendorOverdraft &&
        afterSneak.firstDeny === "mm.inventory" &&
        afterSneak.consumed === false &&
        afterSneak.mmUsdc === mmUsdcBefore &&
        afterSneak.vendorUsd === vendorUsdBefore,
      1,
      "thin MM USDC on the large window is mm.inventory — not the band, not a missing maker, not a vendor overdraft",
      largeQuoteId,
    ),
    expect(
      settled.replayed !== true &&
        payout === expectedSmallPayout &&
        rt.consumedQuotes.has(smallQuoteId) &&
        !rt.consumedQuotes.has(largeQuoteId) &&
        mmUsdcAfter === mmUsdcBefore - expectedSmallPayout &&
        vendorUsdcAfter === expectedSmallPayout,
      2,
      "a smaller window on a different RFQ still converts — inventory is a stock, not a freeze",
      smallQuoteId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 3, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
