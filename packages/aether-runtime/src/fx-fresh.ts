import { readFileSync } from "node:fs";
import { Runtime, cmd } from "./index.js";
import { BORN_TLDR, analog } from "./story.js";
import { mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface FxFreshScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  quotes: Record<
    string,
    { amount: number; currency: "USD_SIM"; rateE6: number; deadUntil: string; liveUntil: string }
  >;
}

export interface FxFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadFxFresh(path: string): FxFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as FxFreshScenario;
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

export function runFxFresh(scenario: FxFreshScenario): FxFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = BORN_TLDR;
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
        spec: "an FX window cannot be born dead",
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
        validUntil: fx.deadUntil,
      },
      rateE6: fx.rateE6,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "market.fx_fresh"),
    windowAllows: allowedRule(sneak, "market.fx_window"),
    pairAllows: allowedRule(sneak, "market.fx_pair"),
    staleAllows: allowedRule(sneak, "market.not_expired"),
    bandAllows: allowedRule(sneak, "mm.spread_bound"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
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
          rateE6: fx.rateE6,
          validUntil: fx.liveUntil,
        },
        rateE6: fx.rateE6,
      }),
    ),
    "live window",
  );
  const quoteId = (quoted.data as { id: string }).id;

  const usdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcBefore = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "settle");
  const payout = (settled.data as { payout: number }).payout;
  const usdAfter = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const expectedPayout = Math.trunc((fx.amount * fx.rateE6) / 1_000_000);

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterSneak.denied &&
        afterSneak.windowAllows &&
        afterSneak.pairAllows &&
        afterSneak.staleAllows &&
        afterSneak.bandAllows &&
        afterSneak.firstDeny === "market.fx_fresh" &&
        afterSneak.quotes === quotesBeforeSneak,
      1,
      "a window already closed is market.fx_fresh — not a written corpse",
      rfqId,
    ),
    expect(
      quoted.replayed !== true && rt.quotes.size === 1,
      2,
      "an open window still quotes — the deny did not occupy the room",
      quoteId,
    ),
    expect(
      settled.replayed !== true &&
        payout === expectedPayout &&
        usdAfter === usdBefore - fx.amount &&
        usdcAfter === usdcBefore + expectedPayout &&
        rt.consumedQuotes.has(quoteId),
      3,
      "an open window still converts — a later lapse stays market.not_expired",
      String(payout),
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
