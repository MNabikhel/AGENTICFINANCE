import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { inviteQuote } from "../packages/aether-runtime/src/hire-flow.ts";

function boot(dataDir?: string) {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISFX0000000001",
    dailyLimit: 10_000_000,
    ...(dataDir ? { dataDir } : {}),
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

function economy(rt: Runtime) {
  must(
    rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    ),
    "founder",
  );
  const founder = rt.alias("ops-human");
  for (const a of [
    { key: "procurement", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "vendor-b", displayName: "Other Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "compute", displayName: "Compute Vendor", role: "compute_vendor", autonomyLevel: 2 },
    { key: "mm", displayName: "Market Maker", role: "market_maker", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  rt.seedOpening({
    "vendor:cash": { amount: 200_000, currency: "USD_SIM" },
    "market_maker:cash_usdc": { amount: 1_000_000, currency: "USDC_SIM" },
  });
  return {
    desk: rt.alias("procurement"),
    vendor: rt.alias("vendor"),
    other: rt.alias("vendor-b"),
    compute: rt.alias("compute"),
    mm: rt.alias("mm"),
  };
}

function fxQuote(rt: Runtime, deskId: string, mmId: string) {
  const rfq = must(
    rt.dispatch(
      cmd("market.rfq", deskId, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "window",
        invitedSellerIds: [mmId],
      }),
    ),
    "fx rfq",
  );
  const quoted = must(
    rt.dispatch(
      cmd("market.quote", mmId, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-29T00:00:00.000Z",
        },
        rateE6: 998_000,
      }),
    ),
    "fx quote",
  );
  return (quoted.data as { id: string }).id;
}

describe("FX quote is a one-shot", () => {
  it("refuses a missing quote as market.fx_quote, not a mutate throw", () => {
    const rt = boot();
    const { vendor } = economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const r = rt.dispatch(
      cmd("market.fx_settle", vendor.id, { quoteId: "qte_01J6AETHERGHOSTFX000000001" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_quote");
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(auditBefore);
  });

  it("refuses to settle a research quote as FX", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    const r = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId: invited.quoteId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
  });

  it("refuses an FX window with no rate as command.malformed, not a NaN settle later", () => {
    const rt = boot();
    const { desk, mm } = economy(rt);
    const rfq = must(
      rt.dispatch(cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [mm.id] })),
      "fx rfq",
    );
    const clockBefore = rt.clock.now();
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: { from: "USD_SIM", to: "USDC_SIM", validUntil: "2026-08-29T00:00:00.000Z" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("fx.rateE6");
    expect(r.error.decision).toBeUndefined();
    expect(rt.quotes.size).toBe(before);
    expect(rt.clock.now()).toBe(clockBefore);
  });

  it("refuses an off-band nested rate even when a decoy top-level rateE6 is in band", () => {
    const rt = boot();
    const { desk, mm } = economy(rt);
    const rfq = must(
      rt.dispatch(cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [mm.id] })),
      "fx rfq",
    );
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 500_000,
          validUntil: "2026-08-29T00:00:00.000Z",
        },
        rateE6: 998_000,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("deny");
    expect(rt.quotes.size).toBe(before);
  });

  it("settles once; a retry of the same command replays; a second key is refused", () => {
    const rt = boot();
    const { desk, vendor, mm } = economy(rt);
    const quoteId = fxQuote(rt, desk.id, mm.id);
    const first = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "fx settle");
    expect((first.data as { payout: number }).payout).toBe(79_840);
    const replay = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "fx replay");
    expect(replay.replayed).toBe(true);
    const second = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId }, "fx-again"));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.error.status).toBe(422);
    expect(second.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
    expect(second.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
  });

  it("refuses a second actor settling the same FX quote", () => {
    const rt = boot();
    const { desk, vendor, other, mm } = economy(rt);
    const quoteId = fxQuote(rt, desk.id, mm.id);
    must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "first actor");
    const sneak = rt.dispatch(cmd("market.fx_settle", other.id, { quoteId }));
    expect(sneak.ok).toBe(false);
    if (sneak.ok) return;
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
  });

  it("keeps a spent FX quote spent across durable reboot", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-fx-"));
    try {
      const a = boot(dir);
      const { desk, vendor, mm } = economy(a);
      const quoteId = fxQuote(a, desk.id, mm.id);
      must(a.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "settle before reboot");
      const b = boot(dir);
      const sneak = b.dispatch(cmd("market.fx_settle", vendor.id, { quoteId }, "after-reboot"));
      expect(sneak.ok).toBe(false);
      if (sneak.ok) return;
      expect(sneak.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("deny");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to hire a quote that already settled as FX", () => {
    const rt = boot();
    const { desk, vendor, mm } = economy(rt);
    const founder = rt.alias("ops-human");
    const quoteId = fxQuote(rt, desk.id, mm.id);
    must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "settle");
    const intent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "hire the window",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
        }),
      ),
      "intent",
    );
    const sneak = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId,
        intentId: (intent.data as { payload: { id: string } }).payload.id,
      }),
    );
    expect(sneak.ok).toBe(false);
    if (sneak.ok) return;
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("deny");
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("deny");
    expect(sneak.error.decision?.remediation?.ruleId).toBe("hire.quote_unspent");
  });

  it("refuses to hire an FX window as hire.not_fx; a deny does not consume the window", () => {
    const rt = boot();
    const { desk, vendor, mm } = economy(rt);
    const founder = rt.alias("ops-human");
    const quoteId = fxQuote(rt, desk.id, mm.id);
    const intent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "hire the window",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
        }),
      ),
      "intent",
    );
    const before = rt.quotes.size;
    const sneak = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId,
        intentId: (intent.data as { payload: { id: string } }).payload.id,
      }),
    );
    expect(sneak.ok).toBe(false);
    if (sneak.ok) return;
    expect(sneak.error.error.status).toBe(422);
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("deny");
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(sneak.error.decision?.remediation?.ruleId).toBe("hire.not_fx");
    expect(sneak.error.decision?.remediation?.kind).toBe("none");
    expect(rt.quotes.size).toBe(before);
    expect(rt.consumedQuotes.has(quoteId)).toBe(false);
    expect(rt.reservedQuotes.has(quoteId)).toBe(false);
    const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "settle after denied hire");
    expect((settled.data as { payout: number }).payout).toBe(79_840);
  });

  it("refuses an expensive FX hire as hire.not_fx, not an escalation that holds the window", () => {
    const rt = boot();
    const { desk, mm } = economy(rt);
    const founder = rt.alias("ops-human");
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, {
          sku: "fx.usd_sim.usdc_sim",
          spec: "expensive window",
          invitedSellerIds: [mm.id],
        }),
      ),
      "fx rfq",
    );
    const quoted = must(
      rt.dispatch(
        cmd("market.quote", mm.id, {
          rfqId: (rfq.data as { id: string }).id,
          price: { amount: 640_000, currency: "USD_SIM" },
          fx: {
            from: "USD_SIM",
            to: "USDC_SIM",
            rateE6: 998_000,
            validUntil: "2026-08-29T00:00:00.000Z",
          },
          rateE6: 998_000,
        }),
      ),
      "fx quote",
    );
    const quoteId = (quoted.data as { id: string }).id;
    const intent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "hire the expensive window",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 700_000 }],
        }),
      ),
      "intent",
    );
    const paused = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId,
        intentId: (intent.data as { payload: { id: string } }).payload.id,
      }),
    );
    expect(paused.ok).toBe(false);
    if (paused.ok) return;
    expect(paused.error.decision?.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("deny");
    expect(paused.error.decision?.trace.find((t) => t.ruleId === "approval.threshold")?.verdict).toBe("escalate");
    expect(paused.error.decision?.remediation?.ruleId).toBe("hire.not_fx");
    expect(rt.reservedQuotes.has(quoteId)).toBe(false);
    expect(rt.consumedQuotes.has(quoteId)).toBe(false);
  });
});

describe("FX vendor cash", () => {
  it("refuses to settle when the vendor cannot cover the USD leg as ledger.sufficient, not MM inventory", () => {
    const rt = boot();
    const { desk, other, mm } = economy(rt);
    const quoteId = fxQuote(rt, desk.id, mm.id);
    const clockBefore = rt.clock.now();
    const usdBefore = rt.ledger.balanceByName("vendor-b:cash").amount;
    const mmUsdcBefore = rt.ledger.balanceByName("market_maker:cash_usdc").amount;
    const r = rt.dispatch(cmd("market.fx_settle", other.id, { quoteId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.inventory")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.sufficient");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.ledger.balanceByName("vendor-b:cash").amount).toBe(usdBefore);
    expect(rt.ledger.balanceByName("market_maker:cash_usdc").amount).toBe(mmUsdcBefore);
    expect(rt.consumedQuotes.has(quoteId)).toBe(false);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("FX vendor USDC book", () => {
  it("refuses to settle when the vendor has no USDC book as ledger.known_account, not a journal throw", () => {
    const rt = boot();
    const { desk, compute, mm } = economy(rt);
    const quoteId = fxQuote(rt, desk.id, mm.id);
    const clockBefore = rt.clock.now();
    const mmUsdcBefore = rt.ledger.balanceByName("market_maker:cash_usdc").amount;
    expect(rt.ledger.accountsByName.has("compute:cash")).toBe(true);
    expect(rt.ledger.accountsByName.has("compute:usdc")).toBe(false);
    const r = rt.dispatch(cmd("market.fx_settle", compute.id, { quoteId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.inventory")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.known_account");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.ledger.balanceByName("market_maker:cash_usdc").amount).toBe(mmUsdcBefore);
    expect(rt.consumedQuotes.has(quoteId)).toBe(false);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("FX pair is this rail's window", () => {
  it("refuses a research quote wearing an FX window as fx_pair, not a dual-use settle", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const rfq = must(
      rt.dispatch(cmd("market.rfq", desk.id, { sku: "research.brief", spec: "one pager", invitedSellerIds: [vendor.id] })),
      "research rfq",
    );
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-29T00:00:00.000Z",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_pair");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.quotes.size).toBe(before);
  });

  it("refuses an FX SKU with swapped from/to as fx_pair, not a silent USD→USDC journal", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [vendor.id] }),
      ),
      "fx rfq",
    );
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USDC_SIM",
          to: "USD_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-29T00:00:00.000Z",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_pair");
    expect(rt.quotes.size).toBe(before);
  });

  it("refuses an FX SKU priced in to as fx_pair", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [vendor.id] }),
      ),
      "fx rfq",
    );
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USDC_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-29T00:00:00.000Z",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_pair");
    expect(rt.quotes.size).toBe(before);
  });

  it("refuses an FX SKU quoted without a window as fx_window, not a hireable good", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [vendor.id] }),
      ),
      "fx rfq",
    );
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_window");
    expect(rt.quotes.size).toBe(before);
  });
});

describe("FX needs a market maker", () => {
  it("refuses to settle FX with no market maker as mm.known, not a journal throw", () => {
    const rt = boot();
    must(
      rt.dispatch(
        cmd("identity.register", "system", {
          key: "ops-human",
          displayName: "Founder",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
      "founder",
    );
    const founder = rt.alias("ops-human");
    for (const a of [
      { key: "procurement", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
      { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
    ] as const) {
      must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
    }
    rt.seedOpening({ "vendor:cash": { amount: 200_000, currency: "USD_SIM" } });
    const desk = rt.alias("procurement");
    const vendor = rt.alias("vendor");
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, {
          sku: "fx.usd_sim.usdc_sim",
          spec: "window",
          invitedSellerIds: [vendor.id],
        }),
      ),
      "fx rfq",
    );
    const quoted = must(
      rt.dispatch(
        cmd("market.quote", vendor.id, {
          rfqId: (rfq.data as { id: string }).id,
          price: { amount: 80_000, currency: "USD_SIM" },
          fx: {
            from: "USD_SIM",
            to: "USDC_SIM",
            rateE6: 998_000,
            validUntil: "2026-08-29T00:00:00.000Z",
          },
        }),
      ),
      "fx quote",
    );
    const quoteId = (quoted.data as { id: string }).id;
    const clockBefore = rt.clock.now();
    const usdBefore = rt.ledger.balanceByName("vendor:cash").amount;
    expect(rt.ledger.accountsByName.has("market_maker:cash_usd")).toBe(false);
    const r = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.known")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.inventory")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_quote")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mm.known");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.ledger.balanceByName("vendor:cash").amount).toBe(usdBefore);
    expect(rt.consumedQuotes.has(quoteId)).toBe(false);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("market.fx_fresh", () => {
  it("refuses an FX window born already closed as fx_fresh, not a written corpse", () => {
    const rt = boot();
    const { desk, mm } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [mm.id] }),
      ),
      "fx rfq",
    );
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-27T00:00:00.000Z",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_fresh");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.quotes.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(auditBefore);
  });

  it("refuses a validUntil equal to now as fx_fresh", () => {
    const rt = boot();
    const { desk, mm } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [mm.id] }),
      ),
      "fx rfq",
    );
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: rt.clock.now(),
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_fresh");
    expect(rt.quotes.size).toBe(before);
  });

  it("refuses an unparseable validUntil as fx_fresh", () => {
    const rt = boot();
    const { desk, mm } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [mm.id] }),
      ),
      "fx rfq",
    );
    const clockBefore = rt.clock.now();
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "not-a-window",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_fresh");
    expect(rt.quotes.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("still names known_rfq first when the room is missing", () => {
    const rt = boot();
    const { mm } = economy(rt);
    const r = rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: "rfq_01J6AETHERGHOSTFXWIN000001",
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-27T00:00:00.000Z",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.known_rfq");
  });

  it("still names not_expired first when the RFQ is already stale", () => {
    const rt = boot();
    const { desk, mm } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [mm.id] }),
      ),
      "fx rfq",
    );
    rt.clock.set("2026-08-29T01:00:00.000Z");
    const r = rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-27T00:00:00.000Z",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.not_expired");
  });

  it("still names fx_pair first when a research SKU wears a dead window", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "research.brief", spec: "one pager", invitedSellerIds: [vendor.id] }),
      ),
      "research rfq",
    );
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 998_000,
          validUntil: "2026-08-27T00:00:00.000Z",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_pair");
    expect(rt.quotes.size).toBe(before);
  });

  it("still names spread_bound first when the nested rate is off-band", () => {
    const rt = boot();
    const { desk, mm } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [mm.id] }),
      ),
      "fx rfq",
    );
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", mm.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: 500_000,
          validUntil: "2026-08-27T00:00:00.000Z",
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mm.spread_bound")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("mm.spread_bound");
    expect(rt.quotes.size).toBe(before);
  });

  it("still names not_expired at settle when a live window later lapses", () => {
    const rt = boot();
    const { desk, vendor, mm } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "fx.usd_sim.usdc_sim", spec: "window", invitedSellerIds: [mm.id] }),
      ),
      "fx rfq",
    );
    const quoted = must(
      rt.dispatch(
        cmd("market.quote", mm.id, {
          rfqId: (rfq.data as { id: string }).id,
          price: { amount: 80_000, currency: "USD_SIM" },
          fx: {
            from: "USD_SIM",
            to: "USDC_SIM",
            rateE6: 998_000,
            validUntil: "2026-08-28T00:30:00.000Z",
          },
        }),
      ),
      "fx quote",
    );
    const quoteId = (quoted.data as { id: string }).id;
    expect((rt.inspect(quoteId)?.value as { status: string }).status).toBe("live");
    rt.clock.set("2026-08-28T00:45:00.000Z");
    expect((rt.inspect(quoteId)?.value as { status: string }).status).toBe("expired");
    expect("status" in (rt.quotes.get(quoteId) ?? {})).toBe(false);
    const r = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.not_expired");
    expect(rt.consumedQuotes.has(quoteId)).toBe(false);
  });
});

