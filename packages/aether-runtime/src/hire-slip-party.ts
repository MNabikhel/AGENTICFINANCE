import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { GUISE_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface HireSlipPartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface HireSlipPartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadHireSlipParty(path: string): HireSlipPartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as HireSlipPartyScenario;
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

export function runHireSlipParty(scenario: HireSlipPartyScenario): HireSlipPartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = GUISE_TLDR;
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

  const unused = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "Someone else's unused slip is not yours to hire against.",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "unused desk slip",
  );
  const unusedId = (unused.data as { payload: { id: MandateId } }).payload.id;

  const otherIntent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: otherDesk.id,
        task: "Hiring from someone else's room is a different object.",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "other intent",
  );
  const otherIntentId = (otherIntent.data as { payload: { id: MandateId } }).payload.id;

  const ripped = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "A ripped slip is a different object.",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "rip target",
  );
  const rippedId = (ripped.data as { payload: { id: MandateId } }).payload.id;
  must(rt.dispatch(cmd("mandate.revoke", founder.id, { intentId: rippedId })), "rip unused desk slip");

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
    spec: "someone else's unused slip is not yours to hire against",
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

  const thiefRoom = inviteQuote(rt, {
    buyer: otherDesk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a live unused slip still on the table",
    price: livePrice,
  });
  const hiresBeforeSneak = rt.hires.size;
  const quoteUnspentBefore = !rt.consumedQuotes.has(thiefRoom.quoteId);

  const ripRoom = inviteQuote(rt, {
    buyer: otherDesk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a ripped slip is not this deny",
    price: livePrice,
  });
  const rippedAttempt = rt.dispatch(
    cmd("hire.create", otherDesk.id, { quoteId: ripRoom.quoteId, intentId: rippedId }),
  );

  const poachRoom = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "someone else's room is a different object",
    price: livePrice,
  });
  const poach = rt.dispatch(
    cmd("hire.create", otherDesk.id, { quoteId: poachRoom.quoteId, intentId: otherIntentId }),
  );

  const ghost = rt.dispatch(
    cmd("hire.create", otherDesk.id, {
      quoteId: thiefRoom.quoteId,
      intentId: "mid_01J6AETHERGHOSTINTENT00001",
    }),
  );

  const sneak = rt.dispatch(cmd("hire.create", otherDesk.id, { quoteId: thiefRoom.quoteId, intentId: unusedId }));
  const afterSneak = {
    denied: deniedRule(sneak, "hire.slip_party"),
    knownIntentAllows: allowedRule(sneak, "mandate.known_intent"),
    roomAllows: allowedRule(sneak, "hire.room_party"),
    unspentAllows: allowedRule(sneak, "hire.quote_unspent"),
    freshAllows: allowedRule(sneak, "market.not_expired"),
    notFxAllows: allowedRule(sneak, "hire.not_fx"),
    selfAllows: allowedRule(sneak, "hire.no_self_deal"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    partyAllows: allowedRule(sneak, "hire.party"),
    subjectAllows: allowedRule(sneak, "mandate.subject_is_actor"),
    trolleyAllows: allowedRule(sneak, "mandate.checkout_party"),
    ripAllows: allowedRule(sneak, "mandate.party"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    quoteSpent: rt.consumedQuotes.has(thiefRoom.quoteId),
    funded: rt.hires.get(hireId)?.state,
    ghostFirst: ghost.ok ? undefined : ghost.error.decision?.remediation?.ruleId,
    ghostSlipAllows: allowedRule(ghost, "hire.slip_party"),
    rippedFirst: rippedAttempt.ok ? undefined : rippedAttempt.error.decision?.remediation?.ruleId,
    rippedSlipDenies: deniedRule(rippedAttempt, "hire.slip_party"),
    poachFirst: poach.ok ? undefined : poach.error.decision?.remediation?.ruleId,
    poachSlipAllows: allowedRule(poach, "hire.slip_party"),
  };

  const legalRoom = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "the named subject still hires against its own unused slip",
    price: livePrice,
  });
  const legalAttempt = rt.dispatch(cmd("hire.create", desk.id, { quoteId: legalRoom.quoteId, intentId: unusedId }));
  const legal = must(legalAttempt, "subject hire");
  const unusedHireId = (legal.data as { id: string }).id;
  const afterLegal = {
    slipAllows: allowedRule(legalAttempt, "hire.slip_party"),
    hires: rt.hires.size,
    quoteSpent: rt.consumedQuotes.has(legalRoom.quoteId),
    thiefQuoteSpent: rt.consumedQuotes.has(thiefRoom.quoteId),
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after guise deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after guise deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        unusedId.startsWith("mid_") &&
        thiefRoom.quoteId.startsWith("qte_") &&
        hiresBeforeSneak === 1 &&
        quoteUnspentBefore,
      1,
      "a listed seller still funds a hire, and a second unused slip sits on the research desk",
      unusedId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownIntentAllows &&
        afterSneak.roomAllows &&
        afterSneak.unspentAllows &&
        afterSneak.freshAllows &&
        afterSneak.notFxAllows &&
        afterSneak.selfAllows &&
        afterSneak.roleAllows &&
        afterSneak.partyAllows &&
        afterSneak.subjectAllows &&
        afterSneak.trolleyAllows &&
        afterSneak.ripAllows &&
        afterSneak.firstDeny === "hire.slip_party" &&
        afterSneak.hires === hiresBeforeSneak &&
        afterSneak.quoteSpent === false &&
        afterSneak.funded === "funded" &&
        afterSneak.ghostFirst === "mandate.known_intent" &&
        afterSneak.ghostSlipAllows &&
        afterSneak.rippedFirst === "mandate.not_expired" &&
        afterSneak.rippedSlipDenies &&
        afterSneak.poachFirst === "hire.room_party" &&
        afterSneak.poachSlipAllows,
      2,
      "hiring against someone else's unused slip is hire.slip_party — not a missing slip, not a ripped slip, not hiring from someone else's room",
    ),
    expect(
      legal.replayed !== true &&
        afterLegal.slipAllows &&
        afterLegal.hires === hiresBeforeSneak + 1 &&
        afterLegal.quoteSpent &&
        afterLegal.thiefQuoteSpent === false &&
        unusedHireId.startsWith("hid_"),
      3,
      "the named subject still hired against its own unused slip — the deny did not occupy the slip",
      unusedHireId,
    ),
    expect(released && rt.hires.size === 2, 4, "that funded work still releases after the guise refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
