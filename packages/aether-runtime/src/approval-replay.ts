import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SOUR_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ApprovalReplayScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface ApprovalReplayReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadApprovalReplay(path: string): ApprovalReplayScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ApprovalReplayScenario;
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

function escalatedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (!attempt.ok) return false;
  return (
    attempt.value.kind === "escalated" &&
    attempt.value.decision.trace.some((t) => t.ruleId === ruleId && t.verdict === "escalate") === true
  );
}

export function runApprovalReplay(scenario: ApprovalReplayScenario): ApprovalReplayReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SOUR_TLDR;
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
  const pausePrice = scenario.quotes.pause!;

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
    spec: "under the auto-approve threshold",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire under threshold");
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
  const hiresBeforePause = rt.hires.size;

  const paused = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "above the auto-approve threshold",
    price: pausePrice,
    intentId,
  });
  const ticket = paused.attempt.ok && paused.attempt.value.kind === "escalated" ? paused.attempt.value.ticket : undefined;
  const held = Boolean(ticket && rt.reservedQuotes.get(paused.quoteId) === ticket.id);
  const hiresAfterPause = rt.hires.size;
  const quote = rt.quotes.get(paused.quoteId);

  // Quote TTL is one hour. Ticket TTL is one day. A dead ticket is pause TAP.
  if (quote) rt.clock.set(quote.expiresAt);

  const sneak = ticket
    ? rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" }))
    : rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: "apd_missing", decision: "approved" }));
  const store = ticket ? rt.approvals.get(ticket.id) : undefined;
  const afterSneak = {
    denied: deniedRule(sneak, "approval.replay"),
    knownAllows: allowedRule(sneak, "approval.known"),
    pendingAllows: allowedRule(sneak, "approval.pending"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    liveAllows: allowedRule(sneak, "actor.not_frozen"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    consumed: rt.consumedQuotes.has(paused.quoteId),
    reserved: rt.reservedQuotes.has(paused.quoteId),
    pending: store?.status === "pending",
  };

  const rejected = ticket
    ? must(
        rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "rejected" })),
        "reject after sour deny",
      )
    : undefined;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after sour deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after sour deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && hiresBeforePause === 1,
      1,
      "desk hire.create allows and funds under the auto-approve threshold",
      hireId,
    ),
    expect(
      escalatedRule(paused.attempt, "approval.threshold") &&
        Boolean(ticket) &&
        held &&
        hiresAfterPause === hiresBeforePause &&
        afterSneak.denied &&
        afterSneak.knownAllows &&
        afterSneak.pendingAllows &&
        afterSneak.roleAllows &&
        afterSneak.liveAllows &&
        afterSneak.firstDeny === "approval.replay" &&
        afterSneak.hires === hiresBeforePause &&
        afterSneak.consumed === false &&
        afterSneak.reserved === true &&
        afterSneak.pending,
      2,
      "yes after the paused quote dies is approval.replay — not a missing ticket, not a dead ticket; the quote stays held",
      paused.quoteId,
    ),
    expect(
      rejected !== undefined &&
        rejected.replayed !== true &&
        rt.approvals.get(ticket!.id)?.status === "rejected" &&
        rt.reservedQuotes.has(paused.quoteId) === false &&
        rt.consumedQuotes.has(paused.quoteId) === false,
      3,
      "reject still frees the quote — a grown-up no is not a late hire",
      ticket?.id,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the sour refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
