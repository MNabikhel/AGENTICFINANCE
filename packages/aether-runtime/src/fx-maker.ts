import { readFileSync } from "node:fs";
import { fxPayout } from "@aether/market";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { QUOIN_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface FxMakerScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  validUntil: string;
  sneak: { amount: number; rateE6: number };
  flip: { amount: number; rateE6: number };
  legal: { amount: number; rateE6: number };
  open: { amount: number; rateE6: number };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface FxMakerReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadFxMaker(path: string): FxMakerScenario {
  return JSON.parse(readFileSync(path, "utf8")) as FxMakerScenario;
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
  speakerId: string,
  rfqId: string,
  amount: number,
  rateE6: number,
  validUntil: string,
) {
  return cmd("market.quote", speakerId, {
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

export function runFxMaker(scenario: FxMakerScenario): FxMakerReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = QUOIN_TLDR;
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
    { key: "compute-vendor", displayName: "Compute Vendor", role: "compute_vendor", autonomyLevel: 2 },
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
  const compute = rt.alias("compute-vendor");
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
    spec: "a vendor's conversion is not a market-maker window",
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
        spec: "a vendor's conversion is not a market-maker window",
        invitedSellerIds: [mm.id, vendor.id, compute.id],
      }),
    ),
    "fx rfq",
  );
  const rfqId = (rfq.data as { id: string }).id;
  const quotesBeforeSneak = rt.quotes.size;

  const sneak = rt.dispatch(
    fxBody(vendor.id, rfqId, scenario.sneak.amount, scenario.sneak.rateE6, scenario.validUntil),
  );
  const flip = rt.dispatch(
    fxBody(compute.id, rfqId, scenario.flip.amount, scenario.flip.rateE6, scenario.validUntil),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "market.fx_party"),
    flipDenied: deniedRule(flip, "market.fx_party"),
    inviteAllows: allowedRule(sneak, "market.invited_seller"),
    bornAllows: allowedRule(sneak, "market.fx_fresh"),
    windowAllows: allowedRule(sneak, "market.fx_window"),
    pairAllows: allowedRule(sneak, "market.fx_pair"),
    pipAllows: allowedRule(sneak, "market.payout_fresh"),
    bandAllows: allowedRule(sneak, "mm.spread_bound"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    flipFirst: flip.ok ? undefined : flip.error.decision?.remediation?.ruleId,
    quotes: rt.quotes.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalAttempt = rt.dispatch(
    fxBody(mm.id, rfqId, scenario.legal.amount, scenario.legal.rateE6, scenario.validUntil),
  );
  const legal = must(legalAttempt, "maker in-band window");
  const legalId = (legal.data as { id: string }).id;
  const openAttempt = rt.dispatch(
    fxBody(mm.id, rfqId, scenario.open.amount, scenario.open.rateE6, scenario.validUntil),
  );
  const open = must(openAttempt, "maker par window");
  const openId = (open.data as { id: string }).id;
  const afterLegal = {
    partyAllows: allowedRule(legalAttempt, "market.fx_party"),
    openAllows: allowedRule(openAttempt, "market.fx_party"),
    quotes: rt.quotes.size,
  };

  const usdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcBefore = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId: legalId })), "settle maker window");
  const payout = (settled.data as { payout: number }).payout;
  const usdAfter = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const expectedPayout = fxPayout(scenario.legal.amount, scenario.legal.rateE6);

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after quoin deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after quoin deny",
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
      "a listed seller still funds a hire, and an FX room still opens with the vendor invited, with no vendor conversion written yet",
      rfqId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.flipDenied &&
        afterSneak.inviteAllows &&
        afterSneak.bornAllows &&
        afterSneak.windowAllows &&
        afterSneak.pairAllows &&
        afterSneak.pipAllows &&
        afterSneak.bandAllows &&
        afterSneak.roleAllows &&
        afterSneak.firstDeny === "market.fx_party" &&
        afterSneak.flipFirst === "market.fx_party" &&
        afterSneak.quotes === quotesBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "minting an FX window as a vendor is market.fx_party — not a closed guest list, not a 200bps band miss, not a conversion that pays nothing",
    ),
    expect(
      legal.replayed !== true &&
        open.replayed !== true &&
        afterLegal.partyAllows &&
        afterLegal.openAllows &&
        afterLegal.quotes === quotesBeforeSneak + 2 &&
        legalId.startsWith("qte_") &&
        openId.startsWith("qte_"),
      3,
      "the market maker still mints an in-band window, and a par window still mints — the deny did not occupy the room",
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
      "the maker's window still converts — a vendor's conversion is not that window",
      String(payout),
    ),
    expect(released && rt.hires.size === 1, 5, "that funded work still releases after the quoin refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 6, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
