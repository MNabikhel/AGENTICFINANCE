import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { MAKER_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface MmKnownScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  mmOpening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<
    string,
    { amount: number; currency: "USD_SIM"; rateE6?: number; validUntil?: string }
  >;
}

export interface MmKnownReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadMmKnown(path: string): MmKnownScenario {
  return JSON.parse(readFileSync(path, "utf8")) as MmKnownScenario;
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

export function runMmKnown(scenario: MmKnownScenario): MmKnownReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = MAKER_TLDR;
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
    spec: "a window is not a journal against nobody",
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
  const noMmBooksBefore =
    !rt.ledger.accountsByName.has("market_maker:cash_usd") &&
    !rt.ledger.accountsByName.has("market_maker:cash_usdc");

  const rfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "fx.usd_sim.usdc_sim",
        spec: "a window is not a journal against nobody",
        invitedSellerIds: [vendor.id],
      }),
    ),
    "fx rfq",
  );
  const quoted = must(
    rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: fx.amount, currency: "USD_SIM" },
        fx: {
          from: "USD_SIM",
          to: "USDC_SIM",
          rateE6: fx.rateE6!,
          validUntil: fx.validUntil!,
        },
      }),
    ),
    "fx quote",
  );
  const quoteId = (quoted.data as { id: string }).id;
  const vendorUsdBefore = rt.ledger.balanceByName("research-vendor:cash").amount;

  const sneak = rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId }));
  const afterSneak = {
    denied: deniedRule(sneak, "mm.known"),
    stockAllows: allowedRule(sneak, "mm.inventory"),
    walletAllows: allowedRule(sneak, "ledger.known_account"),
    quoteAllows: allowedRule(sneak, "market.fx_quote"),
    pairAllows: allowedRule(sneak, "market.fx_pair"),
    bandAllows: allowedRule(sneak, "mm.spread_bound"),
    cashAllows: allowedRule(sneak, "ledger.sufficient"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    consumed: rt.consumedQuotes.has(quoteId),
    vendorUsd: rt.ledger.balanceByName("research-vendor:cash").amount,
    noMaker: ![...rt.identity.all()].some((a) => a.role === "market_maker"),
    noMmBooks:
      !rt.ledger.accountsByName.has("market_maker:cash_usd") &&
      !rt.ledger.accountsByName.has("market_maker:cash_usdc"),
  };

  must(
    rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "mm",
        displayName: "Market Maker",
        role: "market_maker",
        autonomyLevel: 2,
      }),
    ),
    "register maker after sneak",
  );
  rt.seedOpening(scenario.mmOpening);

  const expectedPayout = Math.trunc((fx.amount * fx.rateE6!) / 1_000_000);
  const settled = must(rt.dispatch(cmd("market.fx_settle", vendor.id, { quoteId })), "settle after maker sits");
  const payout = (settled.data as { payout: number }).payout;
  const vendorUsdcAfter = rt.ledger.balanceByName("research-vendor:usdc").amount;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after maker deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after maker deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && noMakerBefore && noMmBooksBefore,
      1,
      "the first human still sits after an $800 hire funds with nobody on the window",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.stockAllows &&
        afterSneak.walletAllows &&
        afterSneak.quoteAllows &&
        afterSneak.pairAllows &&
        afterSneak.bandAllows &&
        afterSneak.cashAllows &&
        afterSneak.roleAllows &&
        afterSneak.firstDeny === "mm.known" &&
        afterSneak.consumed === false &&
        afterSneak.vendorUsd === vendorUsdBefore &&
        afterSneak.noMaker &&
        afterSneak.noMmBooks,
      2,
      "settling a live window with no maker is mm.known — empty inventory is not this deny, a missing dest book is not this deny",
      quoteId,
    ),
    expect(
      settled.replayed !== true &&
        rt.consumedQuotes.has(quoteId) &&
        payout === expectedPayout &&
        vendorUsdcAfter === expectedPayout,
      3,
      "the same window still converts after a maker sits — the deny did not consume it",
      quoteId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the empty pit is refused", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
