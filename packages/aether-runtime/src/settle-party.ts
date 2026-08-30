import { readFileSync } from "node:fs";
import { fxPayout } from "@aether/market";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SNARE_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface SettlePartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  mmOpening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  validUntil: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<
    string,
    { amount: number; currency: "USD_SIM"; rateE6?: number }
  >;
}

export interface SettlePartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadSettleParty(path: string): SettlePartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as SettlePartyScenario;
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

function fxQuote(speakerId: string, rfqId: string, amount: number, rateE6: number, validUntil: string) {
  return cmd("market.quote", speakerId, {
    rfqId,
    price: { amount, currency: "USD_SIM" },
    fx: {
      from: "USD_SIM",
      to: "USDC_SIM",
      rateE6,
      validUntil,
    },
  });
}

export function runSettleParty(scenario: SettlePartyScenario): SettlePartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SNARE_TLDR;
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
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 4 },
    { key: "research-vendor", displayName: "Research Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "other-vendor", displayName: "Other Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "compute-vendor", displayName: "Compute Vendor", role: "compute_vendor", autonomyLevel: 2 },
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
  const other = rt.alias("other-vendor");
  const compute = rt.alias("compute-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const hirePrice = scenario.quotes.hire!;
  const fx = scenario.quotes.fx!;
  const makerAmt = scenario.quotes.maker!;
  const rateE6 = fx.rateE6!;

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
    spec: "someone else's conversion window is not yours to settle",
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
  const noMakerBefore = ![...rt.identity.all()].some((a) => a.role === "market_maker");

  const rfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "someone else's conversion window is not yours to settle",
        invitedSellerIds: [vendor.id, other.id],
      }),
    ),
    "fx rfq",
  );
  const rfqId = (rfq.data as { id: string }).id;

  const quoted = must(
    rt.dispatch(fxQuote(vendor.id, rfqId, fx.amount, rateE6, scenario.validUntil)),
    "vendor fx window",
  );
  const vendorQuoteId = (quoted.data as { id: string }).id;
  const quotesBeforeSneak = rt.quotes.size;

  const emptyMaker = rt.dispatch(cmd("market.fx_settle", other.id, { quoteId: vendorQuoteId }));
  const ghost = rt.dispatch(cmd("market.fx_settle", other.id, { quoteId: "qte_01J6AETHERGHOSTQUOTE0000001" }));
  const deskSneak = rt.dispatch(cmd("market.fx_settle", desk.id, { quoteId: vendorQuoteId }));
  const computeSneak = rt.dispatch(cmd("market.fx_settle", compute.id, { quoteId: vendorQuoteId }));
  const treasuryEmpty = rt.dispatch(cmd("market.fx_settle", treasury.id, { quoteId: vendorQuoteId }));

  must(
    rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "mm",
        displayName: "Market Maker",
        role: "market_maker",
        autonomyLevel: 2,
      }),
    ),
    "register maker after empty-pit sneak",
  );
  rt.seedOpening(scenario.mmOpening);
  const mm = rt.alias("mm");

  const sneak = rt.dispatch(cmd("market.fx_settle", other.id, { quoteId: vendorQuoteId }));
  const wash = rt.dispatch(cmd("market.fx_settle", mm.id, { quoteId: vendorQuoteId }));
  const treasurySneak = rt.dispatch(cmd("market.fx_settle", treasury.id, { quoteId: vendorQuoteId }));
  const afterSneak = {
    denied: deniedRule(sneak, "market.settle_party"),
    quoteAllows: allowedRule(sneak, "market.fx_quote"),
    makerAllows: allowedRule(sneak, "mm.known"),
    walletAllows: allowedRule(sneak, "ledger.known_account"),
    cashAllows: allowedRule(sneak, "ledger.sufficient"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    consumed: rt.consumedQuotes.has(vendorQuoteId),
    funded: rt.hires.get(hireId)?.state,
    emptyFirst: emptyMaker.ok ? undefined : emptyMaker.error.decision?.remediation?.ruleId,
    emptySettleDenies: deniedRule(emptyMaker, "market.settle_party"),
    ghostFirst: ghost.ok ? undefined : ghost.error.decision?.remediation?.ruleId,
    ghostSettleAllows: allowedRule(ghost, "market.settle_party"),
    deskFirst: deskSneak.ok ? undefined : deskSneak.error.decision?.remediation?.ruleId,
    deskSettleDenies: deniedRule(deskSneak, "market.settle_party"),
    computeFirst: computeSneak.ok ? undefined : computeSneak.error.decision?.remediation?.ruleId,
    computeSettleDenies: deniedRule(computeSneak, "market.settle_party"),
    treasuryEmptyFirst: treasuryEmpty.ok ? undefined : treasuryEmpty.error.decision?.remediation?.ruleId,
    treasuryEmptySettleAllows: allowedRule(treasuryEmpty, "market.settle_party"),
    washDenied: deniedRule(wash, "market.settle_party"),
    washFirst: wash.ok ? undefined : wash.error.decision?.remediation?.ruleId,
    treasuryFirst: treasurySneak.ok ? undefined : treasurySneak.error.decision?.remediation?.ruleId,
    treasurySettleAllows: allowedRule(treasurySneak, "market.settle_party"),
    quotes: rt.quotes.size,
    otherUsd: rt.ledger.balanceByName("other-vendor:cash").amount,
    vendorUsd: rt.ledger.balanceByName("research-vendor:cash").amount,
  };

  const usdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcBefore = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const legalAttempt = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId: vendorQuoteId }));
  const legal = must(legalAttempt, "seller converts own window");
  const payout = (legal.data as { payout: number }).payout;
  const expectedPayout = fxPayout(fx.amount, rateE6);
  const usdAfter = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;

  const makerRfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "a maker window still converts",
        invitedSellerIds: [mm.id, vendor.id],
      }),
    ),
    "maker rfq",
  );
  const makerQuoted = must(
    rt.dispatch(fxQuote(mm.id, (makerRfq.data as { id: string }).id, makerAmt.amount, rateE6, scenario.validUntil)),
    "maker window",
  );
  const makerQuoteId = (makerQuoted.data as { id: string }).id;
  const pitAttempt = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId: makerQuoteId }));
  const pit = must(pitAttempt, "seller converts maker window");
  const pitPayout = (pit.data as { payout: number }).payout;
  const afterLegal = {
    settleAllows: allowedRule(legalAttempt, "market.settle_party"),
    pitAllows: allowedRule(pitAttempt, "market.settle_party"),
    consumedVendor: rt.consumedQuotes.has(vendorQuoteId),
    consumedMaker: rt.consumedQuotes.has(makerQuoteId),
    quotes: rt.quotes.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after snare deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after snare deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        noMakerBefore &&
        quoted.replayed !== true &&
        vendorQuoteId.startsWith("qte_") &&
        quotesBeforeSneak >= 1,
      1,
      "a listed seller still funds a hire, and a vendor still minted a conversion window with nobody on the pit",
      vendorQuoteId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.quoteAllows &&
        afterSneak.makerAllows &&
        afterSneak.walletAllows &&
        afterSneak.cashAllows &&
        afterSneak.roleAllows &&
        afterSneak.firstDeny === "market.settle_party" &&
        afterSneak.consumed === false &&
        afterSneak.funded === "funded" &&
        afterSneak.quotes === quotesBeforeSneak &&
        afterSneak.emptyFirst === "mm.known" &&
        afterSneak.emptySettleDenies &&
        afterSneak.ghostFirst === "market.fx_quote" &&
        afterSneak.ghostSettleAllows &&
        afterSneak.deskFirst === "actor.role_capability" &&
        afterSneak.deskSettleDenies &&
        afterSneak.computeFirst === "ledger.known_account" &&
        afterSneak.computeSettleDenies &&
        afterSneak.treasuryEmptyFirst === "ledger.known_account" &&
        afterSneak.treasuryEmptySettleAllows &&
        afterSneak.washDenied &&
        afterSneak.washFirst === "market.settle_party" &&
        afterSneak.treasuryFirst === "ledger.known_account" &&
        afterSneak.treasurySettleAllows &&
        afterSneak.otherUsd === scenario.opening["other-vendor:cash"]!.amount &&
        afterSneak.vendorUsd === scenario.opening["research-vendor:cash"]!.amount,
      2,
      "settling someone else's conversion window is market.settle_party — not a missing maker, not a missing quote, not a missing dest book, not a vendor verb",
    ),
    expect(
      legal.replayed !== true &&
        afterLegal.settleAllows &&
        afterLegal.pitAllows &&
        afterLegal.consumedVendor &&
        afterLegal.consumedMaker &&
        afterLegal.quotes === quotesBeforeSneak + 1 &&
        payout === expectedPayout &&
        pitPayout === fxPayout(makerAmt.amount, rateE6) &&
        usdAfter === usdBefore - fx.amount &&
        usdcAfter === usdcBefore + expectedPayout,
      3,
      "the named seller still converted its own window — and still converted a maker window",
      vendorQuoteId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the snare refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
