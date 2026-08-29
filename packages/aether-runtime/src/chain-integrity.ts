import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { CHAIN_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ChainIntegrityScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  afterCart: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface ChainIntegrityReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadChainIntegrity(path: string): ChainIntegrityScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ChainIntegrityScenario;
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

export function runChainIntegrity(scenario: ChainIntegrityScenario): ChainIntegrityReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = CHAIN_TLDR;
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
    spec: "a dead cart is not a check",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire live cart");
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
    spec: "fund after the cart window",
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
  must(
    rt.dispatch(
      cmd("mandate.issue_payment", desk.id, {
        cartId: (sneakCart.data as { payload: { id: string } }).payload.id,
      }),
    ),
    "payment sneak",
  );

  rt.clock.set(scenario.afterCart);

  const fundAttempt = rt.dispatch(cmd("hire.fund", desk.id, { hireId: sneakId }));
  const afterSneak = {
    denied: deniedRule(fundAttempt, "mandate.chain_integrity"),
    expiredAlso: deniedRule(fundAttempt, "mandate.not_expired"),
    boundAllows: allowedRule(fundAttempt, "hire.bound_cart"),
    stateAllows: allowedRule(fundAttempt, "hire.state"),
    cashAllows: allowedRule(fundAttempt, "ledger.sufficient"),
    knownAllows: allowedRule(fundAttempt, "hire.known"),
    firstDeny: fundAttempt.ok ? undefined : fundAttempt.error.decision?.remediation?.ruleId,
    sneakState: rt.hires.get(sneakId)?.state,
    cash: rt.ledger.balanceByName("desk:cash").amount,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after chain deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after chain deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(hired.replayed !== true && fundedState === "funded", 1, "a live cart still funds a hire", hireId),
    expect(
      afterSneak.denied &&
        afterSneak.expiredAlso &&
        afterSneak.boundAllows &&
        afterSneak.stateAllows &&
        afterSneak.cashAllows &&
        afterSneak.knownAllows &&
        afterSneak.firstDeny === "mandate.chain_integrity" &&
        afterSneak.sneakState === "accepted" &&
        afterSneak.cash === cashAfterFund,
      2,
      "a dead cart is mandate.chain_integrity — not occupancy, not empty cash, not an illegal arrow",
      sneakId,
    ),
    expect(
      released && rt.hires.get(hireId as HireId)?.state === "released",
      3,
      "that funded work still releases after the cart dies",
      hireId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
