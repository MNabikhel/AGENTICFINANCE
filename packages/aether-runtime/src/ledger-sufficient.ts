import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { CASH_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface LedgerSufficientScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface LedgerSufficientReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadLedgerSufficient(path: string): LedgerSufficientScenario {
  return JSON.parse(readFileSync(path, "utf8")) as LedgerSufficientScenario;
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

export function runLedgerSufficient(scenario: LedgerSufficientScenario): LedgerSufficientReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = CASH_TLDR;
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
    spec: "empty cash is not a negative book",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire listed cash");
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
  const cashAfterFund = rt.ledger.balanceByName("desk:cash").amount;

  const sneak = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "second hire against an empty book",
    price: sneakPrice,
    intentId,
  });
  const sneakHired = must(sneak.attempt, "hire.create still writes");
  const sneakId = (sneakHired.data as { id: string }).id;
  must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId: sneakId })), "accept sneak");
  const sneakCart = must(
    rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        hireId: sneakId,
        line_items: [
          {
            sku: "research.brief",
            description: "research.brief",
            quantity: 1,
            unitAmount: sneakPrice,
          },
        ],
      }),
    ),
    "cart sneak",
  );
  const sneakPayment = must(
    rt.dispatch(
      cmd("mandate.issue_payment", desk.id, {
        cartId: (sneakCart.data as { payload: { id: string } }).payload.id,
      }),
    ),
    "payment sneak",
  );
  const fundAttempt = rt.dispatch(
    cmd("hire.fund", desk.id, {
      hireId: sneakId,
      paymentMandateId: (sneakPayment.data as { payload: { id: string } }).payload.id,
    }),
  );
  const afterSneak = {
    denied: deniedRule(fundAttempt, "ledger.sufficient"),
    currencyAllows: allowedRule(fundAttempt, "ledger.same_currency"),
    bookAllows: allowedRule(fundAttempt, "ledger.operating_book"),
    stateAllows: allowedRule(fundAttempt, "hire.state"),
    knownAllows: allowedRule(fundAttempt, "hire.known"),
    firstDeny: fundAttempt.ok ? undefined : fundAttempt.error.decision?.remediation?.ruleId,
    sneakState: rt.hires.get(sneakId)?.state,
    cash: rt.ledger.balanceByName("desk:cash").amount,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after cash deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after cash deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && cashAfterFund === 0,
      1,
      "listed cash still funds a hire that empties the book",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.currencyAllows &&
        afterSneak.bookAllows &&
        afterSneak.stateAllows &&
        afterSneak.knownAllows &&
        afterSneak.firstDeny === "ledger.sufficient" &&
        afterSneak.sneakState === "accepted" &&
        afterSneak.cash === 0,
      2,
      "empty cash is ledger.sufficient — not a mixed journal, not a mint, not an illegal arrow",
      sneakId,
    ),
    expect(released && rt.hires.get(hireId)?.state === "released", 3, "that funded work still releases after the book refuses", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
