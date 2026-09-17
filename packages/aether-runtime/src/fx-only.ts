import { readFileSync } from "node:fs";
import { fxPayout } from "@aether/market";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { HAWK_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface FxOnlyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  mmOpening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  validUntil: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM"; rateE6?: number }>;
}

export interface FxOnlyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadFxOnly(path: string): FxOnlyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as FxOnlyScenario;
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

export function runFxOnly(scenario: FxOnlyScenario): FxOnlyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = HAWK_TLDR;
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
  rt.seedOpening(scenario.mmOpening);

  const desk = rt.alias("desk");
  const vendor = rt.alias("research-vendor");
  const mm = rt.alias("mm");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const hirePrice = scenario.quotes.hire!;
  const goodPrice = scenario.quotes.good!;
  const fx = scenario.quotes.fx!;
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
    spec: "a maker's quote is a window, not a good",
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

  const room = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "a maker's quote is a window, not a good",
        invitedSellerIds: [vendor.id, mm.id],
      }),
    ),
    "hawk room",
  );
  const roomId = (room.data as { id: string }).id;
  const quotesBeforeSneak = rt.quotes.size;

  const hawk = rt.dispatch(
    cmd("market.quote", mm.id, { rfqId: roomId, price: { amount: goodPrice.amount, currency: "USD_SIM" } }),
  );

  const ghost = rt.dispatch(
    cmd("market.quote", mm.id, {
      rfqId: "rfq_01J6AETHERGHOSTROOM00000001",
      price: { amount: goodPrice.amount, currency: "USD_SIM" },
    }),
  );

  const shutRoom = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "a shut room is not this deny",
        invitedSellerIds: [mm.id],
      }),
    ),
    "shut room",
  );
  const shutRoomId = (shutRoom.data as { id: string }).id;
  must(rt.dispatch(cmd("market.close", desk.id, { rfqId: shutRoomId })), "close shut room");
  const shut = rt.dispatch(
    cmd("market.quote", mm.id, { rfqId: shutRoomId, price: { amount: goodPrice.amount, currency: "USD_SIM" } }),
  );

  const closedList = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "an uninvited maker is not this deny",
        invitedSellerIds: [vendor.id],
      }),
    ),
    "closed guest list",
  );
  const closedListId = (closedList.data as { id: string }).id;
  const uninvited = rt.dispatch(
    cmd("market.quote", mm.id, { rfqId: closedListId, price: { amount: goodPrice.amount, currency: "USD_SIM" } }),
  );

  const fxRoom = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "a maker still quotes an FX window",
        invitedSellerIds: [mm.id],
      }),
    ),
    "fx room",
  );
  const fxRoomId = (fxRoom.data as { id: string }).id;
  const windowless = rt.dispatch(
    cmd("market.quote", mm.id, { rfqId: fxRoomId, price: { amount: fx.amount, currency: "USD_SIM" } }),
  );

  const afterSneak = {
    denied: deniedRule(hawk, "mm.fx_only"),
    firstDeny: hawk.ok ? undefined : hawk.error.decision?.remediation?.ruleId,
    roomAllows: allowedRule(hawk, "market.known_rfq"),
    skuAllows: allowedRule(hawk, "market.known_sku"),
    freshAllows: allowedRule(hawk, "market.not_expired"),
    inviteAllows: allowedRule(hawk, "market.invited_seller"),
    roleAllows: allowedRule(hawk, "actor.role_capability"),
    bandAllows: allowedRule(hawk, "mm.spread_bound"),
    ghostFirst: ghost.ok ? undefined : ghost.error.decision?.remediation?.ruleId,
    ghostFxOnlyAllows: allowedRule(ghost, "mm.fx_only"),
    shutFirst: shut.ok ? undefined : shut.error.decision?.remediation?.ruleId,
    shutFxOnlyDenies: deniedRule(shut, "mm.fx_only"),
    uninvitedFirst: uninvited.ok ? undefined : uninvited.error.decision?.remediation?.ruleId,
    uninvitedFxOnlyDenies: deniedRule(uninvited, "mm.fx_only"),
    windowlessFirst: windowless.ok ? undefined : windowless.error.decision?.remediation?.ruleId,
    windowlessFxOnlyAllows: allowedRule(windowless, "mm.fx_only"),
    quotes: rt.quotes.size,
    funded: rt.hires.get(hireId)?.state,
  };

  const vendorGoodAttempt = rt.dispatch(
    cmd("market.quote", vendor.id, { rfqId: roomId, price: { amount: goodPrice.amount, currency: "USD_SIM" } }),
  );
  const vendorGood = must(vendorGoodAttempt, "vendor still quotes the good");

  const makerFxAttempt = rt.dispatch(
    cmd("market.quote", mm.id, {
      rfqId: fxRoomId,
      price: { amount: fx.amount, currency: "USD_SIM" },
      fx: { from: "USD_SIM", to: "USDC_SIM", rateE6, validUntil: scenario.validUntil },
    }),
  );
  const makerFx = must(makerFxAttempt, "maker still quotes an FX window");
  const makerQuoteId = (makerFx.data as { id: string }).id;

  const usdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcBefore = rt.ledger.balanceByName("research-vendor:usdc").amount;
  const settleAttempt = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId: makerQuoteId }));
  const settled = must(settleAttempt, "vendor converts maker window");
  const payout = (settled.data as { payout: number }).payout;
  const expectedPayout = fxPayout(fx.amount, rateE6);
  const usdAfter = rt.ledger.balanceByName("research-vendor:cash").amount;
  const usdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;

  const afterLegal = {
    vendorGoodAllows: allowedRule(vendorGoodAttempt, "mm.fx_only"),
    makerFxAllows: allowedRule(makerFxAttempt, "mm.fx_only"),
    consumedMaker: rt.consumedQuotes.has(makerQuoteId),
    quotes: rt.quotes.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after hawk deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after hawk deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        roomId.startsWith("rfq_") &&
        quotesBeforeSneak >= 1,
      1,
      "a listed seller still funds a hire, and a research room is open with the maker on the guest list",
      roomId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.firstDeny === "mm.fx_only" &&
        afterSneak.roomAllows &&
        afterSneak.skuAllows &&
        afterSneak.freshAllows &&
        afterSneak.inviteAllows &&
        afterSneak.roleAllows &&
        afterSneak.bandAllows &&
        afterSneak.quotes === quotesBeforeSneak &&
        afterSneak.funded === "funded" &&
        afterSneak.ghostFirst === "market.known_rfq" &&
        afterSneak.ghostFxOnlyAllows &&
        afterSneak.shutFirst === "market.not_expired" &&
        afterSneak.shutFxOnlyDenies &&
        afterSneak.uninvitedFirst === "market.invited_seller" &&
        afterSneak.uninvitedFxOnlyDenies &&
        afterSneak.windowlessFirst === "market.fx_window" &&
        afterSneak.windowlessFxOnlyAllows,
      2,
      "a maker quoting a good is mm.fx_only — not a ghost room, not a shut room, not an uninvited maker, not a windowless FX quote",
    ),
    expect(
      vendorGood.replayed !== true &&
        makerFx.replayed !== true &&
        afterLegal.vendorGoodAllows &&
        afterLegal.makerFxAllows &&
        afterLegal.consumedMaker &&
        afterLegal.quotes === quotesBeforeSneak + 2 &&
        payout === expectedPayout &&
        usdAfter === usdBefore - fx.amount &&
        usdcAfter === usdcBefore + expectedPayout,
      3,
      "the research vendor still quoted the good, the maker still quoted an FX window, and that window still converted",
      makerQuoteId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the hawk refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
