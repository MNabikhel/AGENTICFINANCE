import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { POACH_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface HireRoomPartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface HireRoomPartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadHireRoomParty(path: string): HireRoomPartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as HireRoomPartyScenario;
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

export function runHireRoomParty(scenario: HireRoomPartyScenario): HireRoomPartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = POACH_TLDR;
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
    { key: "other-desk", displayName: "Other Desk", role: "procurement", autonomyLevel: 3 },
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
  const otherDesk = rt.alias("other-desk");
  const vendor = rt.alias("research-vendor");
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

  const otherIntent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: otherDesk.id,
        task: "Someone else's room is not yours to hire from.",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "other intent",
  );
  const otherIntentId = (otherIntent.data as { payload: { id: MandateId } }).payload.id;

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
    spec: "someone else's room is not yours to hire from",
    price: firstPrice,
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
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;

  const second = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a live unused quote still on the table",
    price: livePrice,
  });
  const hiresBeforeSneak = rt.hires.size;
  const quoteUnspentBefore = !rt.consumedQuotes.has(second.quoteId);

  const shutRoom = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a shut room is not this deny",
    price: livePrice,
  });
  const shutRfqId = (shutRoom.rfq.data as { id: string }).id;
  must(rt.dispatch(cmd("market.close", desk.id, { rfqId: shutRfqId })), "buyer shuts a spare room");
  const shut = rt.dispatch(cmd("hire.create", otherDesk.id, { quoteId: shutRoom.quoteId, intentId: otherIntentId }));

  const ghost = rt.dispatch(
    cmd("hire.create", otherDesk.id, {
      quoteId: "qte_01J6AETHERGHOSTQUOTE0000001",
      intentId: otherIntentId,
    }),
  );

  const sneak = rt.dispatch(cmd("hire.create", otherDesk.id, { quoteId: second.quoteId, intentId: otherIntentId }));
  const afterSneak = {
    denied: deniedRule(sneak, "hire.room_party"),
    knownRfqAllows: allowedRule(sneak, "market.known_rfq"),
    unspentAllows: allowedRule(sneak, "hire.quote_unspent"),
    freshAllows: allowedRule(sneak, "market.not_expired"),
    notFxAllows: allowedRule(sneak, "hire.not_fx"),
    selfAllows: allowedRule(sneak, "hire.no_self_deal"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    shutAllows: allowedRule(sneak, "market.rfq_party"),
    partyAllows: allowedRule(sneak, "hire.party"),
    subjectAllows: allowedRule(sneak, "mandate.subject_is_actor"),
    trolleyAllows: allowedRule(sneak, "mandate.checkout_party"),
    knownIntentAllows: allowedRule(sneak, "mandate.known_intent"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    quoteSpent: rt.consumedQuotes.has(second.quoteId),
    funded: rt.hires.get(hireId)?.state,
    ghostFirst: ghost.ok ? undefined : ghost.error.decision?.remediation?.ruleId,
    ghostRoomAllows: allowedRule(ghost, "hire.room_party"),
    shutFirst: shut.ok ? undefined : shut.error.decision?.remediation?.ruleId,
    shutRoomDenies: deniedRule(shut, "hire.room_party"),
  };

  const legalAttempt = rt.dispatch(cmd("hire.create", desk.id, { quoteId: second.quoteId, intentId }));
  const legal = must(legalAttempt, "buyer hire");
  const unusedHireId = (legal.data as { id: string }).id;
  const afterLegal = {
    roomAllows: allowedRule(legalAttempt, "hire.room_party"),
    hires: rt.hires.size,
    quoteSpent: rt.consumedQuotes.has(second.quoteId),
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after poach deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after poach deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        second.quoteId.startsWith("qte_") &&
        hiresBeforeSneak === 1 &&
        quoteUnspentBefore,
      1,
      "a listed seller still funds a hire, and a second quote sits unused on the research desk's room",
      second.quoteId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownRfqAllows &&
        afterSneak.unspentAllows &&
        afterSneak.freshAllows &&
        afterSneak.notFxAllows &&
        afterSneak.selfAllows &&
        afterSneak.roleAllows &&
        afterSneak.shutAllows &&
        afterSneak.partyAllows &&
        afterSneak.subjectAllows &&
        afterSneak.trolleyAllows &&
        afterSneak.knownIntentAllows &&
        afterSneak.firstDeny === "hire.room_party" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.quoteSpent === false &&
        afterSneak.funded === "funded" &&
        afterSneak.ghostFirst === "market.known_rfq" &&
        afterSneak.ghostRoomAllows &&
        afterSneak.shutFirst === "market.not_expired" &&
        afterSneak.shutRoomDenies,
      2,
      "hiring from someone else's room is hire.room_party — not a missing room, not a spent quote, not shutting someone else's room",
    ),
    expect(
      legal.replayed !== true &&
        afterLegal.roomAllows &&
        afterLegal.hires === hiresBeforeSneak + 1 &&
        afterLegal.quoteSpent &&
        unusedHireId.startsWith("hid_"),
      3,
      "the buyer still hired its own quote — the deny did not occupy the room",
      unusedHireId,
    ),
    expect(released && rt.hires.size === 2, 4, "that funded work still releases after the poach refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
