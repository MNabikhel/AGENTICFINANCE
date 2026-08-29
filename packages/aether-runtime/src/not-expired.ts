import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { STALE_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface NotExpiredScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  afterQuote: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface NotExpiredReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadNotExpired(path: string): NotExpiredScenario {
  return JSON.parse(readFileSync(path, "utf8")) as NotExpiredScenario;
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

export function runNotExpired(scenario: NotExpiredScenario): NotExpiredReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = STALE_TLDR;
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
  const firstPrice = scenario.quotes.first!;
  const sneakPrice = scenario.quotes.sneak!;

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
    spec: "a stale quote is not a hire",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire live quote");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;

  const sneak = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "hour-old price",
    price: sneakPrice,
  });
  const sneakRfqId = (sneak.rfq.data as { id: string }).id;
  const hiresBeforeSneak = rt.hires.size;
  const quotesBeforeSneak = rt.quotes.size;

  rt.clock.set(scenario.afterQuote);

  const sneakHire = rt.dispatch(cmd("hire.create", desk.id, { quoteId: sneak.quoteId, intentId }));
  const afterSneak = {
    denied: deniedRule(sneakHire, "market.not_expired"),
    skuAllows: allowedRule(sneakHire, "market.known_sku"),
    roomAllows: allowedRule(sneakHire, "market.known_rfq"),
    invitedAllows: allowedRule(sneakHire, "market.invited_seller"),
    unspentAllows: allowedRule(sneakHire, "hire.quote_unspent"),
    notFxAllows: allowedRule(sneakHire, "hire.not_fx"),
    bornAllows: allowedRule(sneakHire, "market.fx_fresh"),
    firstDeny: sneakHire.ok ? undefined : sneakHire.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    quotes: rt.quotes.size,
    consumed: rt.consumedQuotes.has(sneak.quoteId),
  };

  const freshQuoted = must(
    rt.dispatch(cmd("market.quote", vendor.id, { rfqId: sneakRfqId, price: sneakPrice })),
    "fresh quote on the live room",
  );
  const freshQuoteId = (freshQuoted.data as { id: string }).id;
  const freshHired = must(
    rt.dispatch(cmd("hire.create", desk.id, { quoteId: freshQuoteId, intentId })),
    "hire fresh quote",
  );
  const freshHireId = (freshHired.data as { id: string }).id;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after stale deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after stale deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(hired.replayed !== true && fundedState === "funded", 1, "a live quote still funds a hire", hireId),
    expect(
      afterSneak.denied &&
        afterSneak.skuAllows &&
        afterSneak.roomAllows &&
        afterSneak.invitedAllows &&
        afterSneak.unspentAllows &&
        afterSneak.notFxAllows &&
        afterSneak.bornAllows &&
        afterSneak.firstDeny === "market.not_expired" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.quotes === quotesBeforeSneak &&
        afterSneak.consumed === false,
      2,
      "a lapsed quote is market.not_expired — not a spent promise, not a ghost room, not a corpse FX window",
      sneak.quoteId,
    ),
    expect(
      freshHired.replayed !== true &&
        rt.hires.size === hiresBeforeSneak + 1 &&
        Boolean(rt.hires.get(freshHireId as HireId)) &&
        !rt.consumedQuotes.has(sneak.quoteId),
      3,
      "a fresh quote on that still-live room still hires — the hour is not a freeze",
      freshHireId,
    ),
    expect(released && rt.hires.get(hireId)?.state === "released", 4, "that funded work still releases after the quote dies", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
