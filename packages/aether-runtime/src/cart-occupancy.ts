import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { CART_TLDR, analog } from "./story.js";
import { mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface CartOccupancyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface CartOccupancyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadCartOccupancy(path: string): CartOccupancyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as CartOccupancyScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

function lines(amount: number, description: string) {
  return [
    {
      sku: "research.brief",
      description,
      quantity: 1,
      unitAmount: { amount, currency: "USD_SIM" as const },
    },
  ];
}

export function runCartOccupancy(scenario: CartOccupancyScenario): CartOccupancyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = CART_TLDR;
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
  const price = scenario.quotes.once!;

  const offered = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "occupancy is a bind, not a field on fund",
    price,
    intentId,
  });
  const hire = must(offered.attempt, "hire");
  const hireId = (hire.data as { id: string }).id as HireId;
  must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");

  const looseCart = must(
    rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        line_items: lines(price.amount, "loose cart is not a pointer"),
      }),
    ),
    "loose cart",
  );
  const looseCartId = (looseCart.data as { payload: { id: MandateId } }).payload.id;
  const loosePay = must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: looseCartId })), "loose payment");
  const loosePayId = (loosePay.data as { payload: { id: MandateId } }).payload.id;

  const fundBody = { hireId, cartId: looseCartId, paymentMandateId: loosePayId };
  const pointer = rt.dispatch(cmd("hire.fund", desk.id, fundBody));
  const afterPointer = {
    denied: deniedRule(pointer, "hire.bound_cart"),
    cartId: rt.hires.get(hireId)?.cartId,
    cash: rt.ledger.balance(desk.accountId),
  };

  const boundCart = must(
    rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        hireId,
        line_items: lines(price.amount, "bound cart occupies the hire"),
      }),
    ),
    "bound cart",
  );
  const boundCartId = (boundCart.data as { payload: { id: MandateId } }).payload.id;
  const cartsAfterBind = rt.carts.size;

  const secondCart = rt.dispatch(
    cmd("mandate.issue_cart", desk.id, {
      intentId,
      merchantId: vendor.id,
      hireId,
      line_items: lines(price.amount, "second cart is not a pointer swap"),
    }),
  );

  const boundPay = must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: boundCartId })), "bound payment");
  const boundPayId = (boundPay.data as { payload: { id: MandateId } }).payload.id;
  const paysAfterBind = rt.payments.size;

  const secondPay = rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: boundCartId }));

  const occupied = rt.dispatch(cmd("hire.fund", desk.id, fundBody));
  const occupiedAllow = occupied.ok === true && occupied.value.replayed !== true;
  const afterFund = rt.hires.get(hireId);

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterPointer.denied && afterPointer.cartId === undefined && afterPointer.cash === deskOpen,
      1,
      "fund with a loose cartId is hire.bound_cart",
      hireId,
    ),
    expect(
      deniedRule(secondCart, "hire.unique_cart") &&
        rt.carts.size === cartsAfterBind &&
        rt.hires.get(hireId)?.cartId === boundCartId,
      2,
      "second cart on the same hire is hire.unique_cart",
      boundCartId,
    ),
    expect(
      deniedRule(secondPay, "mandate.unique_payment") && rt.payments.size === paysAfterBind,
      3,
      "second payment on that cart is mandate.unique_payment",
      boundPayId,
    ),
    expect(
      occupiedAllow &&
        afterFund?.state === "funded" &&
        afterFund.cartId === boundCartId &&
        rt.ledger.balance(desk.accountId) === deskOpen - price.amount,
      4,
      "the same fund command after occupancy allows — body cartId is not a pointer",
      afterFund?.cartId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
