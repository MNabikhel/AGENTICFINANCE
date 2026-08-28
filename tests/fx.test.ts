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
});
