import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SWAP_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface FxPairScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<
    string,
    { amount: number; currency: "USD_SIM"; rateE6?: number; validUntil?: string }
  >;
}

export interface FxPairReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadFxPair(path: string): FxPairScenario {
  return JSON.parse(readFileSync(path, "utf8")) as FxPairScenario;
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

export function runFxPair(scenario: FxPairScenario): FxPairReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SWAP_TLDR;
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
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const hirePrice = scenario.quotes.hire!;
  const fx = scenario.quotes.fx!;

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

  const live = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a swapped pair is not a silent journal of the books this rail actually posts",
    price: hirePrice,
    intentId,
  });
  const hired = must(live.attempt, "hire listed seller");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: hirePrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;

  const rfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "a swapped pair is not a silent journal of the books this rail actually posts",
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
        from: "USDC_SIM",
        to: "USD_SIM",
        rateE6: fx.rateE6!,
        validUntil: fx.validUntil!,
      },
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "market.fx_pair"),
    skuAllows: allowedRule(sneak, "market.known_sku"),
    roomAllows: allowedRule(sneak, "market.known_rfq"),
    inviteAllows: allowedRule(sneak, "market.invited_seller"),
    pricedAllows: allowedRule(sneak, "market.sku_currency"),
    paneAllows: allowedRule(sneak, "market.fx_window"),
    bornAllows: allowedRule(sneak, "market.fx_fresh"),
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
          rateE6: fx.rateE6!,
          validUntil: fx.validUntil!,
        },
      }),
    ),
    "live window",
  );
  const quoteId = (quoted.data as { id: string }).id;
  const expectedPayout = Math.trunc((fx.amount * fx.rateE6!) / 1_000_000);
  const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "settle after swap deny");
  const payout = (settled.data as { payout: number }).payout;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after swap deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after swap deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(hired.replayed !== true && fundedState === "funded", 1, "a listed seller still funds a hire", hireId),
    expect(
      afterSneak.denied &&
        afterSneak.skuAllows &&
        afterSneak.roomAllows &&
        afterSneak.inviteAllows &&
        afterSneak.pricedAllows &&
        afterSneak.paneAllows &&
        afterSneak.bornAllows &&
        afterSneak.bandAllows &&
        afterSneak.firstDeny === "market.fx_pair" &&
        afterSneak.quotes === quotesBeforeSneak,
      2,
      "a swapped pair is market.fx_pair — not a missing window, not a corpse mint, not a USDC price on research",
      rfqId,
    ),
    expect(
      quoted.replayed !== true &&
        rt.consumedQuotes.has(quoteId) &&
        payout === expectedPayout &&
        rt.ledger.balanceByName("research-vendor:usdc").amount === expectedPayout,
      3,
      "a real window still quotes and converts — the deny did not occupy the room",
      quoteId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the swap refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
