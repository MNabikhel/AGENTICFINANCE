import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SUBJECT_TLDR, analog } from "./story.js";
import { mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface IntentSubjectScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface IntentSubjectReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadIntentSubject(path: string): IntentSubjectScenario {
  return JSON.parse(readFileSync(path, "utf8")) as IntentSubjectScenario;
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

export function runIntentSubject(scenario: IntentSubjectScenario): IntentSubjectReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SUBJECT_TLDR;
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
    { key: "desk-b", displayName: "Desk B", role: "procurement", autonomyLevel: 3 },
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
  const deskB = rt.alias("desk-b");
  const vendor = rt.alias("research-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const hirePrice = scenario.quotes.hire!;

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
    spec: "this slip is not yours to spend",
    price: hirePrice,
    intentId,
  });
  const hired = must(live.attempt, "hire listed subject");
  const hireId = (hired.data as { id: string }).id;
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
            unitAmount: hirePrice,
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
  const paymentMandateId = (payment.data as { payload: { id: string } }).payload.id;
  const cashBeforeSneak = rt.ledger.balanceByName("desk:cash").amount;

  const sneak = rt.dispatch(
    cmd("hire.fund", deskB.id, {
      hireId,
      paymentMandateId,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.subject_is_actor"),
    knownAllows: allowedRule(sneak, "hire.known"),
    stateAllows: allowedRule(sneak, "hire.state"),
    boundAllows: allowedRule(sneak, "hire.bound_cart"),
    cashAllows: allowedRule(sneak, "ledger.sufficient"),
    chainAllows: allowedRule(sneak, "mandate.chain_integrity"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    partyAllows: allowedRule(sneak, "hire.party"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    state: rt.hires.get(hireId)?.state,
    cash: rt.ledger.balanceByName("desk:cash").amount,
  };

  must(
    rt.dispatch(cmd("hire.fund", desk.id, { hireId, paymentMandateId })),
    "fund after subject deny",
  );
  const fundedState = rt.hires.get(hireId)?.state;
  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after subject deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after subject deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && afterSneak.state === "accepted" && cashBeforeSneak === scenario.allocation.amount,
      1,
      "listed subject still binds a hire",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownAllows &&
        afterSneak.stateAllows &&
        afterSneak.boundAllows &&
        afterSneak.cashAllows &&
        afterSneak.chainAllows &&
        afterSneak.roleAllows &&
        afterSneak.partyAllows &&
        afterSneak.firstDeny === "mandate.subject_is_actor" &&
        afterSneak.state === "accepted" &&
        afterSneak.cash === cashBeforeSneak,
      2,
      "a stranger's fund is mandate.subject_is_actor — not a broken chain, not empty cash, not the other side of the table",
      deskB.id,
    ),
    expect(
      fundedState === "funded" && released && rt.hires.size === 1,
      3,
      "the named subject still funds and that work still releases",
      hireId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
