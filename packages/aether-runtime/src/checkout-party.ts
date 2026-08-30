import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { TROLLEY_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface CheckoutPartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface CheckoutPartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadCheckoutParty(path: string): CheckoutPartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as CheckoutPartyScenario;
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

function matchingLines(price: { amount: number; currency: "USD_SIM" }) {
  return [
    {
      sku: "research.brief",
      description: "research.brief",
      quantity: 1,
      unitAmount: price,
    },
  ];
}

export function runCheckoutParty(scenario: CheckoutPartyScenario): CheckoutPartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = TROLLEY_TLDR;
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
    spec: "someone else's checkout is not yours to fill",
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
    spec: "a live unused checkout still on the table",
    price: livePrice,
  });
  const unusedHire = must(
    rt.dispatch(cmd("hire.create", desk.id, { quoteId: second.quoteId, intentId })),
    "unused hire",
  );
  const unusedHireId = (unusedHire.data as { id: string }).id;
  must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId: unusedHireId })), "accept unused");
  const unusedBeforeSneak = rt.hires.get(unusedHireId);
  const cartsBeforeSneak = rt.carts.size;
  const paymentsBeforeSneak = rt.payments.size;

  const sneak = rt.dispatch(
    cmd("mandate.issue_cart", otherDesk.id, {
      intentId,
      merchantId: vendor.id,
      hireId: unusedHireId,
      line_items: matchingLines(livePrice),
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.checkout_party"),
    knownHireAllows: allowedRule(sneak, "hire.known"),
    knownIntentAllows: allowedRule(sneak, "mandate.known_intent"),
    matchAllows: allowedRule(sneak, "hire.cart_matches"),
    uniqueCartAllows: allowedRule(sneak, "hire.unique_cart"),
    dumpAllows: allowedRule(sneak, "mandate.cart_party"),
    spikeAllows: allowedRule(sneak, "mandate.payment_party"),
    ripAllows: allowedRule(sneak, "mandate.party"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    knownAllows: allowedRule(sneak, "identity.known"),
    freshAllows: allowedRule(sneak, "mandate.not_expired"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    carts: rt.carts.size,
    payments: rt.payments.size,
    unusedCartId: rt.hires.get(unusedHireId)?.cartId,
    funded: rt.hires.get(hireId)?.state,
  };

  const legalCartAttempt = rt.dispatch(
    cmd("mandate.issue_cart", desk.id, {
      intentId,
      merchantId: vendor.id,
      hireId: unusedHireId,
      line_items: matchingLines(livePrice),
    }),
  );
  const legalCart = must(legalCartAttempt, "buyer cart");
  const unusedCartId = (legalCart.data as { payload: { id: MandateId } }).payload.id;
  const paymentsBeforeFloor = rt.payments.size;

  const floor = rt.dispatch(cmd("mandate.issue_payment", otherDesk.id, { cartId: unusedCartId }));
  const afterFloor = {
    denied: deniedRule(floor, "mandate.checkout_party"),
    knownCartAllows: allowedRule(floor, "mandate.known_cart"),
    uniquePaymentAllows: allowedRule(floor, "mandate.unique_payment"),
    dumpAllows: allowedRule(floor, "mandate.cart_party"),
    spikeAllows: allowedRule(floor, "mandate.payment_party"),
    ripAllows: allowedRule(floor, "mandate.party"),
    roleAllows: allowedRule(floor, "actor.role_capability"),
    knownAllows: allowedRule(floor, "identity.known"),
    freshAllows: allowedRule(floor, "mandate.not_expired"),
    firstDeny: floor.ok ? undefined : floor.error.decision?.remediation?.ruleId,
    payments: rt.payments.size,
  };

  const legalPaymentAttempt = rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: unusedCartId }));
  const legalPayment = must(legalPaymentAttempt, "buyer payment");
  const unusedPaymentId = (legalPayment.data as { payload: { id: MandateId } }).payload.id;
  const afterLegal = {
    cartAllows: allowedRule(legalCartAttempt, "mandate.checkout_party"),
    paymentAllows: allowedRule(legalPaymentAttempt, "mandate.checkout_party"),
    carts: rt.carts.size,
    payments: rt.payments.size,
    unusedCartId: rt.hires.get(unusedHireId)?.cartId,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after trolley deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after trolley deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        unusedHire.replayed !== true &&
        unusedBeforeSneak?.state === "accepted" &&
        unusedBeforeSneak.cartId === undefined &&
        cartsBeforeSneak >= 1 &&
        paymentsBeforeSneak >= 1,
      1,
      "a listed seller still funds a hire, and a second hire is offered and accepted with no cart yet",
      unusedHireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownHireAllows &&
        afterSneak.knownIntentAllows &&
        afterSneak.matchAllows &&
        afterSneak.uniqueCartAllows &&
        afterSneak.dumpAllows &&
        afterSneak.spikeAllows &&
        afterSneak.ripAllows &&
        afterSneak.roleAllows &&
        afterSneak.knownAllows &&
        afterSneak.freshAllows &&
        afterSneak.firstDeny === "mandate.checkout_party" &&
        afterSneak.carts === cartsBeforeSneak &&
        afterSneak.payments === paymentsBeforeSneak &&
        afterSneak.unusedCartId === undefined &&
        afterSneak.funded === "funded" &&
        afterFloor.denied &&
        afterFloor.knownCartAllows &&
        afterFloor.uniquePaymentAllows &&
        afterFloor.dumpAllows &&
        afterFloor.spikeAllows &&
        afterFloor.ripAllows &&
        afterFloor.roleAllows &&
        afterFloor.knownAllows &&
        afterFloor.freshAllows &&
        afterFloor.firstDeny === "mandate.checkout_party" &&
        afterFloor.payments === paymentsBeforeFloor,
      2,
      "filling someone else's checkout is mandate.checkout_party — not a missing cart, not dumping someone else's cart, not a second cart on the same hire",
    ),
    expect(
      legalCart.replayed !== true &&
        legalPayment.replayed !== true &&
        afterLegal.cartAllows &&
        afterLegal.paymentAllows &&
        afterLegal.carts === cartsBeforeSneak + 1 &&
        afterLegal.payments === paymentsBeforeFloor + 1 &&
        afterLegal.unusedCartId === unusedCartId &&
        unusedCartId.startsWith("mid_") &&
        unusedPaymentId.startsWith("mid_"),
      3,
      "the buyer still filled its own checkout — the deny did not occupy the hire",
      unusedCartId,
    ),
    expect(released && rt.hires.size === 2, 4, "that funded work still releases after the trolley refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
