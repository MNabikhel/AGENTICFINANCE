import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { fundHire, inviteQuote, offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { HireContract, MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISHIRE0000001",
    dailyLimit: 10_000_000,
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

function economy(rt: Runtime, cash = 1_500_000) {
  must(
    rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    ),
    "founder",
  );
  const founder = rt.alias("ops-human");
  for (const a of [
    { key: "procurement", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  rt.seedOpening({ "procurement:cash": { amount: cash, currency: "USD_SIM" } });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
      }),
    ),
    "intent",
  );
  return { desk, vendor, intentId: (intent.data as { payload: { id: MandateId } }).payload.id };
}

describe("known hire", () => {
  it("refuses to accept a missing hire as hire.known, not a mutate throw", () => {
    const rt = boot();
    const { vendor } = economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const r = rt.dispatch(
      cmd("hire.accept", vendor.id, { hireId: "hid_01J6AETHERGHOSTHIRE0000001" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.known");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(auditBefore);
  });

  it("refuses to fund a missing hire as hire.known, not a broken chain", () => {
    const rt = boot();
    const { desk } = economy(rt);
    const r = rt.dispatch(
      cmd("hire.fund", desk.id, { hireId: "hid_01J6AETHERGHOSTHIRE0000001" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.known");
  });
});

describe("known intent", () => {
  it("refuses to hire against a missing slip as known_intent, not a missing handshake", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    const r = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId: invited.quoteId,
        intentId: "mid_01J6AETHERGHOSTINTENT00001",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_intent");
    expect(rt.consumedQuotes.has(invited.quoteId)).toBe(false);
  });

  it("refuses a cart against a missing slip as known_intent, not a mutate throw", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId: "mid_01J6AETHERGHOSTINTENT00001",
        merchantId: vendor.id,
        line_items: [
          {
            sku: "research.brief",
            description: "one pager",
            quantity: 1,
            unitAmount: { amount: 80_000, currency: "USD_SIM" },
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_intent");
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("known cart", () => {
  it("refuses a payment against a missing cart as known_cart, not a mutate throw", () => {
    const rt = boot();
    const { desk } = economy(rt);
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("mandate.issue_payment", desk.id, { cartId: "mid_01J6AETHERGHOSTCART0000001" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_cart");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("known parent", () => {
  it("refuses a sub-intent against a missing parent as known_parent, not a mutate throw", () => {
    const rt = boot();
    const { desk } = economy(rt);
    const founder = rt.alias("ops-human");
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        parentId: "mid_01J6AETHERGHOSTPARENT00001",
        task: "hand down to nobody",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_parent");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.intents.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(auditBefore);
  });
});

function offered(rt: ReturnType<typeof boot>) {
  const { desk, vendor, intentId } = economy(rt);
  const live = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "one pager",
    price: { amount: 80_000, currency: "USD_SIM" },
    intentId,
  });
  if (!live.attempt.ok) throw new Error("expected hire.create allow");
  return { desk, vendor, intentId, hireId: (live.attempt.value.data as HireContract).id };
}

function cartAndPay(rt: ReturnType<typeof boot>, input: { hireId: string; buyer: string; seller: string; intentId: string }) {
  const cart = must(
    rt.dispatch(
      cmd("mandate.issue_cart", input.buyer, {
        intentId: input.intentId,
        merchantId: input.seller,
        hireId: input.hireId,
        line_items: [
          {
            sku: "research.brief",
            description: "one pager",
            quantity: 1,
            unitAmount: { amount: 80_000, currency: "USD_SIM" },
          },
        ],
      }),
    ),
    "cart",
  );
  const payment = must(
    rt.dispatch(cmd("mandate.issue_payment", input.buyer, { cartId: (cart.data as { payload: { id: string } }).payload.id })),
    "payment",
  );
  return { paymentId: (payment.data as { payload: { id: string } }).payload.id };
}

describe("hire state", () => {
  it("refuses a second accept as hire.state, not a mutate throw", () => {
    const rt = boot();
    const { vendor, hireId } = offered(rt);
    must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("hire.accept", vendor.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.escrow_required")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.state");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("accepted");
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses to fund an offered hire as hire.state, not a 409 after allow", () => {
    const rt = boot();
    const { desk, vendor, intentId, hireId } = offered(rt);
    const { paymentId } = cartAndPay(rt, { hireId, buyer: desk.id, seller: vendor.id, intentId });
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    const r = rt.dispatch(cmd("hire.fund", desk.id, { hireId, paymentMandateId: paymentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.state");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("offered");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);
  });

  it("refuses to refund after deliver as hire.state, and does not unwind escrow", () => {
    const rt = boot();
    const { desk, vendor, intentId, hireId } = offered(rt);
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { ok: true } })), "deliver");
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    const r = rt.dispatch(cmd("hire.refund", desk.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.state");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("delivered");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);
    expect(rt.spentByIntent.get(intentId)).toBe(80_000);
  });

  it("refuses to release before deliver as hire.state", () => {
    const rt = boot();
    const { desk, vendor, intentId, hireId } = offered(rt);
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    const vendorCash = rt.ledger.balanceByName("vendor:cash").amount;
    const r = rt.dispatch(cmd("hire.release", desk.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.state");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("funded");
    expect(rt.ledger.balanceByName("vendor:cash").amount).toBe(vendorCash);
    expect(rt.receipts.size).toBe(0);
  });

  it("refuses payment-required before deliver as hire.state, not a 402", () => {
    const rt = boot();
    const { vendor, intentId, hireId, desk } = offered(rt);
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    const r = rt.dispatch(cmd("envelope.require", vendor.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.state");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("funded");

    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { ok: true } })), "deliver");
    const required = must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
    expect(required.kind).toBe("allow");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("delivered");
  });

  it("refuses a second fund with a new key as hire.state, and still replays the first", () => {
    const rt = boot();
    const { desk, vendor, intentId, hireId } = offered(rt);
    must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
    const { paymentId } = cartAndPay(rt, { hireId, buyer: desk.id, seller: vendor.id, intentId });
    const body = { hireId, paymentMandateId: paymentId };
    must(rt.dispatch(cmd("hire.fund", desk.id, body)), "fund");
    const cash = rt.ledger.balanceByName("procurement:cash").amount;

    const replay = rt.dispatch(cmd("hire.fund", desk.id, body));
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.replayed).toBe(true);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);

    const r = rt.dispatch(cmd("hire.fund", desk.id, body, "second-fund"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("deny");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("funded");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);
  });
});

describe("escrow cash", () => {
  it("refuses to fund when the buyer cannot cover escrow as ledger.sufficient, not a negative book", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt, 10_000);
    const live = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(live.attempt.ok).toBe(true);
    if (!live.attempt.ok) return;
    const hireId = (live.attempt.value.data as HireContract).id;
    must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
    const { paymentId } = cartAndPay(rt, { hireId, buyer: desk.id, seller: vendor.id, intentId });
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("hire.fund", desk.id, { hireId, paymentMandateId: paymentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.sufficient");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(10_000);
    expect(rt.ledger.balance(rt.hires.get(hireId)!.escrowAccountId)).toBe(0);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses to fund a USDC hire from USD cash as ledger.same_currency, not a mixed journal", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const founder = rt.alias("ops-human");
    const intent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy fx window as a hire",
          constraints: [],
        }),
      ),
      "usdc intent",
    );
    const intentId = (intent.data as { payload: { id: MandateId } }).payload.id;
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, {
          sku: "fx.usd_sim.usdc_sim",
          spec: "window",
          invitedSellerIds: [vendor.id],
        }),
      ),
      "fx rfq",
    );
    const quoted = must(
      rt.dispatch(
        cmd("market.quote", vendor.id, {
          rfqId: (rfq.data as { id: string }).id,
          price: { amount: 80_000, currency: "USDC_SIM" },
        }),
      ),
      "usdc quote",
    );
    const created = must(
      rt.dispatch(
        cmd("hire.create", desk.id, {
          quoteId: (quoted.data as { id: string }).id,
          intentId,
        }),
      ),
      "hire",
    );
    const hireId = (created.data as HireContract).id;
    must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
    const cart = must(
      rt.dispatch(
        cmd("mandate.issue_cart", desk.id, {
          intentId,
          merchantId: vendor.id,
          hireId,
          line_items: [
            {
              sku: "fx.usd_sim.usdc_sim",
              description: "window",
              quantity: 1,
              unitAmount: { amount: 80_000, currency: "USDC_SIM" },
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
    const journalsBefore = rt.journals.length;
    const cashBefore = rt.ledger.balanceByName("procurement:cash").amount;
    const r = rt.dispatch(
      cmd("hire.fund", desk.id, {
        hireId,
        paymentMandateId: (payment.data as { payload: { id: string } }).payload.id,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.same_currency");
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
    expect(rt.journals.length).toBe(journalsBefore);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cashBefore);
    expect(rt.ledger.balance(rt.hires.get(hireId)!.escrowAccountId)).toBe(0);
  });
});
