import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { INK_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface CurrencyMatchScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface CurrencyMatchReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadCurrencyMatch(path: string): CurrencyMatchScenario {
  return JSON.parse(readFileSync(path, "utf8")) as CurrencyMatchScenario;
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

export function runCurrencyMatch(scenario: CurrencyMatchScenario): CurrencyMatchReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = INK_TLDR;
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
  const secondPrice = scenario.quotes.second!;

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
  const deskOpen = rt.ledger.balance(desk.accountId);

  const first = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a cart label is not the hire's money",
    price: firstPrice,
    intentId,
  });
  const hired = must(first.attempt, "hire before sticker");
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
  const deskAfterFirst = rt.ledger.balance(desk.accountId);

  const second = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a USDC sticker is not an $800 hire",
    price: secondPrice,
    intentId,
  });
  const hired2 = must(second.attempt, "second hire listed");
  const hire2 = (hired2.data as { id: string }).id as HireId;
  must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId: hire2 })), "accept second");

  const loose = must(
    rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        line_items: [
          {
            sku: "research.brief",
            description: "a cart label is not the hire's money",
            quantity: 1,
            unitAmount: { amount: secondPrice.amount, currency: "USDC_SIM" },
          },
        ],
      }),
    ),
    "loose USDC cart",
  );
  const looseCartId = (loose.data as { payload: { id: MandateId } }).payload.id;
  const loosePay = must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: looseCartId })), "loose USDC payment");
  const loosePayId = (loosePay.data as { payload: { id: MandateId } }).payload.id;
  const cartsBeforeSneak = rt.carts.size;
  const paysBeforeSneak = rt.payments.size;

  const sneak = rt.dispatch(
    cmd("hire.fund", desk.id, {
      hireId: hire2,
      cartId: looseCartId,
      paymentMandateId: loosePayId,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "payment.currency_match"),
    mixAllows: allowedRule(sneak, "ledger.same_currency"),
    pricedAllows: allowedRule(sneak, "market.sku_currency"),
    chainAllows: allowedRule(sneak, "mandate.chain_integrity"),
    rangeAllows: allowedRule(sneak, "payment.amount_range"),
    stateAllows: allowedRule(sneak, "hire.state"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    cartId: rt.hires.get(hire2)?.cartId,
    cash: rt.ledger.balance(desk.accountId),
    carts: rt.carts.size,
    pays: rt.payments.size,
  };

  const bound = must(
    rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        hireId: hire2,
        line_items: [
          {
            sku: "research.brief",
            description: "a USD cart still occupies",
            quantity: 1,
            unitAmount: { amount: secondPrice.amount, currency: "USD_SIM" },
          },
        ],
      }),
    ),
    "USD cart after ink deny",
  );
  const boundCartId = (bound.data as { payload: { id: MandateId } }).payload.id;
  const boundPay = must(
    rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: boundCartId })),
    "USD payment after ink deny",
  );
  const funded2 = must(
    rt.dispatch(
      cmd("hire.fund", desk.id, {
        hireId: hire2,
        paymentMandateId: (boundPay.data as { payload: { id: MandateId } }).payload.id,
      }),
    ),
    "fund after ink deny",
  );

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after ink deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after ink deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && deskAfterFirst === deskOpen - firstPrice.amount,
      1,
      "the first human still sits after an $800 hire funds",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.mixAllows &&
        afterSneak.pricedAllows &&
        afterSneak.chainAllows &&
        afterSneak.rangeAllows &&
        afterSneak.stateAllows &&
        afterSneak.firstDeny === "payment.currency_match" &&
        afterSneak.cartId === undefined &&
        afterSneak.cash === deskAfterFirst &&
        afterSneak.carts === cartsBeforeSneak &&
        afterSneak.pays === paysBeforeSneak,
      2,
      "funding a USD hire with a USDC cart is payment.currency_match — a mixed journal is not this deny, a USDC quote is not this deny, a loose USD pointer is not this deny",
      hire2,
    ),
    expect(
      funded2.replayed !== true &&
        rt.hires.get(hire2)?.state === "funded" &&
        rt.hires.get(hire2)?.cartId === boundCartId &&
        rt.ledger.balance(desk.accountId) === deskAfterFirst - secondPrice.amount,
      3,
      "a USD cart still binds and funds — the sticker did not occupy the hire",
      hire2,
    ),
    expect(released && rt.hires.size === 2, 4, "that first funded work still releases after the sticker is refused", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
