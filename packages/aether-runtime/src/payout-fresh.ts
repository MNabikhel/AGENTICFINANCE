import { readFileSync } from "node:fs";
import { fxPayout } from "@aether/market";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { PIP_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface PayoutFreshScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  validUntil: string;
  sneak: { amount: number; rateE6: number };
  zero: { amount: number; rateE6: number };
  legal: { amount: number; rateE6: number };
  open: { amount: number; rateE6: number };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface PayoutFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadPayoutFresh(path: string): PayoutFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as PayoutFreshScenario;
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

function fxBody(
  mmId: string,
  rfqId: string,
  amount: number,
  rateE6: number,
  validUntil: string,
) {
  return cmd("market.quote", mmId, {
    rfqId,
    price: { amount, currency: "USD_SIM" },
    fx: {
      from: "USD_SIM",
      to: "USDC_SIM",
      rateE6,
      validUntil,
    },
    rateE6,
  });
}

export function runPayoutFresh(scenario: PayoutFreshScenario): PayoutFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = PIP_TLDR;
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
  const treasury = rt.alias("treasury");
  const mm = rt.alias("mm");
  const auditor = rt.alias("auditor");
  const price = scenario.quotes.hire!;

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
    "desk intent",
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
    spec: "a conversion that pays nothing is not an FX window",
    price,
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
    unitAmount: price.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;

  const rfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "a conversion that pays nothing is not an FX window",
        invitedSellerIds: [mm.id],
      }),
    ),
    "fx rfq",
  );
  const rfqId = (rfq.data as { id: string }).id;
  const quotesBeforeSneak = rt.quotes.size;

  const sneak = rt.dispatch(
    fxBody(mm.id, rfqId, scenario.sneak.amount, scenario.sneak.rateE6, scenario.validUntil),
  );
  const zero = rt.dispatch(
    fxBody(mm.id, rfqId, scenario.zero.amount, scenario.zero.rateE6, scenario.validUntil),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "market.payout_fresh"),
    zeroDenied: deniedRule(zero, "market.payout_fresh"),
    bornAllows: allowedRule(sneak, "market.fx_fresh"),
    windowAllows: allowedRule(sneak, "market.fx_window"),
    pairAllows: allowedRule(sneak, "market.fx_pair"),
    staleAllows: allowedRule(sneak, "market.not_expired"),
    bandAllows: allowedRule(sneak, "mm.spread_bound"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    zeroFirst: zero.ok ? undefined : zero.error.decision?.remediation?.ruleId,
    quotes: rt.quotes.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalAttempt = rt.dispatch(
    fxBody(mm.id, rfqId, scenario.legal.amount, scenario.legal.rateE6, scenario.validUntil),
  );
  const legal = must(legalAttempt, "low-band two-cent window");
  const legalId = (legal.data as { id: string }).id;
  const openAttempt = rt.dispatch(
    fxBody(mm.id, rfqId, scenario.open.amount, scenario.open.rateE6, scenario.validUntil),
  );
  const open = must(openAttempt, "par one-cent window");
  const openId = (open.data as { id: string }).id;
  const afterLegal = {
    pipAllows: allowedRule(legalAttempt, "market.payout_fresh"),
    openAllows: allowedRule(openAttempt, "market.payout_fresh"),
    quotes: rt.quotes.size,
  };

  const usdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcBefore = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId: legalId })), "settle two-cent window");
  const payout = (settled.data as { payout: number }).payout;
  const usdAfter = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const expectedPayout = fxPayout(scenario.legal.amount, scenario.legal.rateE6);

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after pip deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after pip deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        rfq.replayed !== true &&
        rfqId.startsWith("rfq_") &&
        quotesBeforeSneak === 1,
      1,
      "a listed seller still funds a hire, and an FX room still opens, with no empty conversion written yet",
      rfqId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.zeroDenied &&
        afterSneak.bornAllows &&
        afterSneak.windowAllows &&
        afterSneak.pairAllows &&
        afterSneak.staleAllows &&
        afterSneak.bandAllows &&
        afterSneak.firstDeny === "market.payout_fresh" &&
        afterSneak.zeroFirst === "market.payout_fresh" &&
        afterSneak.quotes === quotesBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "minting a conversion that pays nothing is market.payout_fresh — not a dead window, not a swapped pair, not a 200bps band miss",
    ),
    expect(
      legal.replayed !== true &&
        open.replayed !== true &&
        afterLegal.pipAllows &&
        afterLegal.openAllows &&
        afterLegal.quotes === quotesBeforeSneak + 2 &&
        legalId.startsWith("qte_") &&
        openId.startsWith("qte_"),
      3,
      "a two-cent window at the low band still mints, and a one-cent window at par still mints — the deny did not occupy the room",
      legalId,
    ),
    expect(
      settled.replayed !== true &&
        payout === expectedPayout &&
        expectedPayout > 0 &&
        usdAfter === usdBefore - scenario.legal.amount &&
        usdcAfter === usdcBefore + expectedPayout &&
        rt.consumedQuotes.has(legalId) &&
        !rt.consumedQuotes.has(openId),
      4,
      "the two-cent window still converts — a conversion that pays a cent is a window",
      String(payout),
    ),
    expect(released && rt.hires.size === 1, 5, "that funded work still releases after the pip refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 6, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
