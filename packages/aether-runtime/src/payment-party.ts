import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SPIKE_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface PaymentPartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface PaymentPartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadPaymentParty(path: string): PaymentPartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as PaymentPartyScenario;
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

function spikeLines(rt: Runtime): number {
  return rt.audit.all().filter((e) => e.action === "PAYMENT_REVOKE").length;
}

export function runPaymentParty(scenario: PaymentPartyScenario): PaymentPartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SPIKE_TLDR;
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
    spec: "someone else's unused payment is not yours to spike",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire before a stolen spike");
  const hireId = (hired.data as { id: string }).id;
  const funded = fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const fundedPaymentId = funded.paymentId as MandateId;

  const second = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a live unused check still on the table",
    price: livePrice,
  });
  const unusedHire = must(
    rt.dispatch(cmd("hire.create", desk.id, { quoteId: second.quoteId, intentId })),
    "unused hire",
  );
  const unusedHireId = (unusedHire.data as { id: string }).id;
  must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId: unusedHireId })), "accept unused");
  const unusedCart = must(
    rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        hireId: unusedHireId,
        line_items: [
          {
            sku: "research.brief",
            description: "research.brief",
            quantity: 1,
            unitAmount: livePrice,
          },
        ],
      }),
    ),
    "unused cart",
  );
  const unusedCartId = (unusedCart.data as { payload: { id: MandateId } }).payload.id;
  const unusedPayment = must(
    rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: unusedCartId })),
    "unused payment",
  );
  const unusedPaymentId = (unusedPayment.data as { payload: { id: MandateId } }).payload.id;
  const beforeSpike = spikeLines(rt);
  const liveBeforeSneak = rt.paymentView(rt.payments.get(unusedPaymentId)!).status;
  const boundBeforeSneak = rt.cartView(rt.carts.get(unusedCartId)!).status;

  const sneak = rt.dispatch(cmd("mandate.revoke_payment", otherDesk.id, { paymentId: unusedPaymentId }));
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.payment_party"),
    knownAllows: allowedRule(sneak, "mandate.known_payment"),
    freshAllows: allowedRule(sneak, "mandate.not_expired"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    dumpPartyAllows: allowedRule(sneak, "mandate.cart_party"),
    ripPartyAllows: allowedRule(sneak, "mandate.party"),
    foldPartyAllows: allowedRule(sneak, "market.party"),
    shutPartyAllows: allowedRule(sneak, "market.rfq_party"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    status: rt.paymentView(rt.payments.get(unusedPaymentId)!).status,
    spikes: spikeLines(rt),
  };

  const ghost = rt.dispatch(
    cmd("mandate.revoke_payment", desk.id, { paymentId: "mid_01J6AETHERGHOSTPAY00000096" }),
  );

  const spiked = must(
    rt.dispatch(cmd("mandate.revoke_payment", desk.id, { paymentId: unusedPaymentId })),
    "buyer spikes own unused payment",
  );
  const afterSpike = rt.paymentView(rt.payments.get(unusedPaymentId)!);
  const occupancyFreed = rt.cartView(rt.carts.get(unusedCartId)!).status === "live";

  const fundSpiked = rt.dispatch(cmd("hire.fund", desk.id, { hireId: unusedHireId }));

  const reissueAttempt = rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: unusedCartId }));
  const reissue = must(reissueAttempt, "reissue after spike");

  const spikeFunded = rt.dispatch(cmd("mandate.revoke_payment", desk.id, { paymentId: fundedPaymentId }));

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after spike TAP");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after spike TAP",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        liveBeforeSneak === "live" &&
        boundBeforeSneak === "bound",
      1,
      "the first human still sits after an $800 hire funds",
      founder.id,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownAllows &&
        afterSneak.freshAllows &&
        afterSneak.roleAllows &&
        afterSneak.dumpPartyAllows &&
        afterSneak.ripPartyAllows &&
        afterSneak.foldPartyAllows &&
        afterSneak.shutPartyAllows &&
        afterSneak.firstDeny === "mandate.payment_party" &&
        afterSneak.status === "live" &&
        afterSneak.spikes === beforeSpike,
      2,
      "a second desk spiking the research desk's unused check is mandate.payment_party",
      afterSneak.firstDeny,
    ),
    expect(
      deniedRule(ghost, "mandate.known_payment") &&
        allowedRule(ghost, "mandate.payment_party") &&
        allowedRule(ghost, "mandate.cart_party") &&
        allowedRule(ghost, "mandate.party") &&
        spiked.replayed !== true &&
        afterSpike.status === "revoked" &&
        occupancyFreed &&
        !("status" in (rt.payments.get(unusedPaymentId) ?? {})) &&
        deniedRule(fundSpiked, "mandate.not_expired") &&
        allowedRule(fundSpiked, "hire.bound_cart") &&
        allowedRule(fundSpiked, "mandate.unique_payment") &&
        allowedRule(fundSpiked, "mandate.chain_integrity") &&
        allowedRule(fundSpiked, "mandate.cart_party") &&
        reissue.replayed !== true &&
        allowedRule(reissueAttempt, "mandate.unique_payment") &&
        spikeFunded.ok === false &&
        deniedRule(spikeFunded, "mandate.not_expired") &&
        rt.revokedPayments.has(unusedPaymentId) &&
        !rt.revokedPayments.has(fundedPaymentId),
      3,
      "the buyer still spikes its own unused check; funding that spiked payment is mandate.not_expired",
      fundSpiked.ok ? undefined : fundSpiked.error.decision?.remediation?.ruleId,
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
