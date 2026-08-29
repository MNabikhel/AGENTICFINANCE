import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SHUT_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface RfqPartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface RfqPartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadRfqParty(path: string): RfqPartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as RfqPartyScenario;
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

function closeLines(rt: Runtime): number {
  return rt.audit.all().filter((e) => e.action === "RFQ_CLOSE").length;
}

export function runRfqParty(scenario: RfqPartyScenario): RfqPartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SHUT_TLDR;
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
    spec: "someone else's room is not yours to close",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire before a stolen shut");
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
    spec: "a live room still on the table",
    price: livePrice,
  });
  const liveRfqId = (second.rfq.data as { id: string }).id;
  const liveQuoteId = second.quoteId;
  const beforeShut = closeLines(rt);
  const liveBeforeSneak = rt.rfqView(rt.rfqs.get(liveRfqId)!).status;

  const sneak = rt.dispatch(cmd("market.close", otherDesk.id, { rfqId: liveRfqId }));
  const afterSneak = {
    denied: deniedRule(sneak, "market.rfq_party"),
    knownAllows: allowedRule(sneak, "market.known_rfq"),
    freshAllows: allowedRule(sneak, "market.not_expired"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    foldPartyAllows: allowedRule(sneak, "market.party"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    status: rt.rfqView(rt.rfqs.get(liveRfqId)!).status,
    shuts: closeLines(rt),
  };

  const ghost = rt.dispatch(
    cmd("market.close", desk.id, { rfqId: "rfq_01J6AETHERGHOSTRFQ00000001" }),
  );

  const shut = must(rt.dispatch(cmd("market.close", desk.id, { rfqId: liveRfqId })), "buyer shuts own room");
  const afterShut = rt.rfqView(rt.rfqs.get(liveRfqId)!);

  const reuse = rt.dispatch(cmd("hire.create", desk.id, { quoteId: liveQuoteId, intentId }));

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after shut TAP");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after shut TAP",
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
        afterSneak.roleAllows &&
        afterSneak.foldPartyAllows &&
        afterSneak.firstDeny === "market.rfq_party" &&
        afterSneak.status === "live" &&
        afterSneak.shuts === beforeShut,
      2,
      "a second desk shutting the research desk's live room is market.rfq_party",
      afterSneak.firstDeny,
    ),
    expect(
      deniedRule(ghost, "market.known_rfq") &&
        allowedRule(ghost, "market.rfq_party") &&
        allowedRule(ghost, "market.party") &&
        shut.replayed !== true &&
        afterShut.status === "closed" &&
        !("status" in (rt.rfqs.get(liveRfqId) ?? {})) &&
        deniedRule(reuse, "market.not_expired") &&
        allowedRule(reuse, "hire.quote_unspent") &&
        rt.closedRfqs.has(liveRfqId) &&
        !rt.closedRfqs.has((live.rfq.data as { id: string }).id),
      3,
      "the buyer still shuts its own room; hiring that shut room's quote is market.not_expired",
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
