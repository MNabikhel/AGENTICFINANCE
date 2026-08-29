import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { MATCH_TLDR, analog } from "./story.js";
import { mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface CartMatchScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
  cheap: { amount: number; currency: "USD_SIM" };
}

export interface CartMatchReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadCartMatch(path: string): CartMatchScenario {
  return JSON.parse(readFileSync(path, "utf8")) as CartMatchScenario;
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

export function runCartMatch(scenario: CartMatchScenario): CartMatchReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = MATCH_TLDR;
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
    spec: "a cheaper cart is not a discount",
    price,
    intentId,
  });
  const hire = must(offered.attempt, "hire");
  const hireId = (hire.data as { id: string }).id as HireId;
  must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
  const cartsBeforeCheap = rt.carts.size;

  const cheap = rt.dispatch(
    cmd("mandate.issue_cart", desk.id, {
      intentId,
      merchantId: vendor.id,
      hireId,
      line_items: lines(scenario.cheap.amount, "discounted"),
    }),
  );
  const afterCheap = {
    denied: deniedRule(cheap, "hire.cart_matches"),
    carts: rt.carts.size,
    cartId: rt.hires.get(hireId)?.cartId,
  };

  const matched = must(
    rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        hireId,
        line_items: lines(price.amount, "matches the hire"),
      }),
    ),
    "matching cart",
  );
  const matchedCartId = (matched.data as { payload: { id: MandateId } }).payload.id;
  const cartsAfterMatch = rt.carts.size;

  const second = rt.dispatch(
    cmd("mandate.issue_cart", desk.id, {
      intentId,
      merchantId: vendor.id,
      hireId,
      line_items: lines(price.amount, "second matching cart"),
    }),
  );

  const pay = must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId: matchedCartId })), "payment");
  const payId = (pay.data as { payload: { id: MandateId } }).payload.id;
  const funded = must(rt.dispatch(cmd("hire.fund", desk.id, { hireId, paymentMandateId: payId })), "fund");
  const afterFund = rt.hires.get(hireId);
  const escrow = afterFund ? rt.ledger.balance(afterFund.escrowAccountId) : undefined;

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterCheap.denied && afterCheap.carts === cartsBeforeCheap && afterCheap.cartId === undefined,
      1,
      "cheap cart is hire.cart_matches",
      hireId,
    ),
    expect(
      rt.hires.get(hireId)?.cartId === matchedCartId && cartsAfterMatch === cartsBeforeCheap + 1,
      2,
      "matching cart allows — the deny did not occupy unique_cart",
      matchedCartId,
    ),
    expect(
      funded.replayed !== true &&
        afterFund?.state === "funded" &&
        escrow === price.amount &&
        rt.ledger.balance(desk.accountId) === deskOpen - price.amount,
      3,
      "fund moves the hire price, not a penny",
      String(escrow),
    ),
    expect(
      deniedRule(second, "hire.unique_cart") && rt.carts.size === cartsAfterMatch,
      4,
      "second matching cart is hire.unique_cart",
      matchedCartId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
