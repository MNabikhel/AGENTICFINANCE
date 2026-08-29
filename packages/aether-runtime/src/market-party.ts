import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { FOLD_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface MarketPartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface MarketPartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadMarketParty(path: string): MarketPartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as MarketPartyScenario;
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

function withdrawLines(rt: Runtime): number {
  return rt.audit.all().filter((e) => e.action === "QUOTE_WITHDRAW").length;
}

export function runMarketParty(scenario: MarketPartyScenario): MarketPartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = FOLD_TLDR;
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
  const other = rt.alias("compute-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const firstPrice = scenario.quotes.first!;
  const livePrice = scenario.quotes.live!;

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
    spec: "someone else's bid is not yours to pull",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire before a stolen fold");
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

  const second = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a live bid still on the table",
    price: livePrice,
  });
  const liveQuoteId = second.quoteId;
  const beforeFold = withdrawLines(rt);
  const liveBeforeSneak = rt.quoteView(rt.quotes.get(liveQuoteId)!).status;

  const sneak = rt.dispatch(cmd("market.withdraw", other.id, { quoteId: liveQuoteId }));
  const afterSneak = {
    denied: deniedRule(sneak, "market.party"),
    knownAllows: allowedRule(sneak, "market.known_rfq"),
    freshAllows: allowedRule(sneak, "market.not_expired"),
    unspentAllows: allowedRule(sneak, "hire.quote_unspent"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    status: rt.quoteView(rt.quotes.get(liveQuoteId)!).status,
    folds: withdrawLines(rt),
  };

  const ghost = rt.dispatch(
    cmd("market.withdraw", vendor.id, { quoteId: "qte_01J6AETHERGHOSTQUOTE00001" }),
  );

  const folded = must(rt.dispatch(cmd("market.withdraw", vendor.id, { quoteId: liveQuoteId })), "seller folds own bid");
  const afterFold = rt.quoteView(rt.quotes.get(liveQuoteId)!);

  const reuse = rt.dispatch(cmd("hire.create", desk.id, { quoteId: liveQuoteId, intentId }));

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after fold TAP");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after fold TAP",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && liveBeforeSneak === "live",
      1,
      "the first human still sits after an $800 hire funds",
      founder.id,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownAllows &&
        afterSneak.freshAllows &&
        afterSneak.unspentAllows &&
        afterSneak.roleAllows &&
        afterSneak.firstDeny === "market.party" &&
        afterSneak.status === "live" &&
        afterSneak.folds === beforeFold,
      2,
      "a second vendor folding the research desk's live bid is market.party",
      afterSneak.firstDeny,
    ),
    expect(
      deniedRule(ghost, "market.known_rfq") &&
        allowedRule(ghost, "market.party") &&
        folded.replayed !== true &&
        afterFold.status === "withdrawn" &&
        !("status" in (rt.quotes.get(liveQuoteId) ?? {})) &&
        deniedRule(reuse, "market.not_expired") &&
        allowedRule(reuse, "hire.quote_unspent") &&
        !rt.consumedQuotes.has(liveQuoteId),
      3,
      "the seller still folds its own bid; hiring that folded quote is market.not_expired",
      reuse.ok ? undefined : reuse.error.decision?.remediation?.ruleId,
    ),
    expect(released && rt.hires.get(hireId)?.state === "released", 4, "that funded work still released"),
  ];

  return {
    ok: results.every((r) => r.ok),
    results,
    snapshot: snap,
    runtime: rt,
  };
}
