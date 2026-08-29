import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { PEN_TLDR, analog } from "./story.js";
import { mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface HumanSignatureScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface HumanSignatureReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadHumanSignature(path: string): HumanSignatureScenario {
  return JSON.parse(readFileSync(path, "utf8")) as HumanSignatureScenario;
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
  const decision = attempt.ok ? attempt.value.decision : attempt.error.decision;
  return decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "escalate") === true;
}

export function runHumanSignature(scenario: HumanSignatureScenario): HumanSignatureReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = PEN_TLDR;
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
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 1 },
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
    spec: "junior desk still hires with a grown-up pause",
    price: firstPrice,
    intentId,
  });
  const createPaused =
    live.attempt.ok && live.attempt.value.kind === "escalated" ? live.attempt.value.ticket : undefined;
  const created = must(
    createPaused
      ? rt.dispatch(cmd("approval.resolve", founder.id, { approvalId: createPaused.id, decision: "approved" }))
      : live.attempt,
    "approve junior hire.create",
  );
  const hireId = ((created.data as { hire?: { id?: string }; id?: string }).hire?.id ??
    (created.data as { id?: string }).id) as string;

  must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
  const cart = must(
    rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        hireId,
        line_items: [
          {
            sku: "research.brief",
            description: "research.brief",
            quantity: 1,
            unitAmount: { amount: firstPrice.amount, currency: "USD_SIM" },
          },
        ],
      }),
    ),
    "cart",
  );
  const payment = must(
    rt.dispatch(
      cmd("mandate.issue_payment", desk.id, {
        cartId: (cart.data as { payload: { id: string } }).payload.id,
      }),
    ),
    "payment",
  );
  const fundAttempt = rt.dispatch(
    cmd("hire.fund", desk.id, {
      hireId,
      paymentMandateId: (payment.data as { payload: { id: string } }).payload.id,
    }),
  );
  const fundPaused =
    fundAttempt.ok && fundAttempt.value.kind === "escalated" ? fundAttempt.value.ticket : undefined;
  const funded = must(
    fundPaused
      ? rt.dispatch(cmd("approval.resolve", founder.id, { approvalId: fundPaused.id, decision: "approved" }))
      : fundAttempt,
    "approve junior hire.fund",
  );
  const fundedState = rt.hires.get(hireId)?.state;
  const ticketsBeforeSneak = rt.approvals.size;
  const pendingBeforeSneak = [...rt.approvals.values()].filter((t) => t.status === "pending").length;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  const nonce = `nonce-${hireId}`;
  const sneak = rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce }));
  const afterSneak = {
    denied: deniedRule(sneak, "human.signature_present"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    subjectAllows: allowedRule(sneak, "mandate.subject_is_actor"),
    partyAllows: allowedRule(sneak, "hire.party"),
    rungPauses: escalatedRule(sneak, "ladder.min_level"),
    signatureCreateAllows: allowedRule(live.attempt, "human.signature_present"),
    signatureFundAllows: allowedRule(fundAttempt, "human.signature_present"),
    createPauses: escalatedRule(live.attempt, "ladder.min_level"),
    fundPauses: escalatedRule(fundAttempt, "ladder.min_level"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    ticket: sneak.ok && sneak.value.kind === "escalated" ? sneak.value.ticket : undefined,
    hires: rt.hires.size,
    state: rt.hires.get(hireId)?.state,
    nonceSettled: rt.nonces.has(nonce),
    tickets: rt.approvals.size,
    pending: [...rt.approvals.values()].filter((t) => t.status === "pending").length,
    deskLevel: rt.alias("desk").autonomyLevel,
    frozen: rt.alias("desk").frozen,
  };

  must(rt.dispatch(cmd("hire.release", treasury.id, { hireId })), "treasury release after pen deny");
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      createPaused !== undefined &&
        fundPaused !== undefined &&
        funded.replayed !== true &&
        fundedState === "funded" &&
        afterSneak.signatureCreateAllows &&
        afterSneak.signatureFundAllows &&
        afterSneak.createPauses &&
        afterSneak.fundPauses &&
        ticketsBeforeSneak === 2 &&
        pendingBeforeSneak === 0,
      1,
      "junior desk hire.create and fund are grown-up pauses — signature still allows",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.roleAllows &&
        afterSneak.subjectAllows &&
        afterSneak.partyAllows &&
        afterSneak.rungPauses &&
        afterSneak.firstDeny === "human.signature_present" &&
        afterSneak.ticket === undefined &&
        afterSneak.hires === 1 &&
        afterSneak.state === "delivered" &&
        afterSneak.nonceSettled === false &&
        afterSneak.tickets === ticketsBeforeSneak &&
        afterSneak.pending === 0 &&
        afterSneak.deskLevel === 1 &&
        afterSneak.frozen === false,
      2,
      "junior envelope.submit is human.signature_present — not a missing subject, not a badge, not a grown-up pause",
      hireId,
    ),
    expect(
      released && rt.hires.size === 1 && rt.alias("desk").autonomyLevel === 1,
      3,
      "treasury still releases that funded work; the junior desk stays L1",
      hireId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
