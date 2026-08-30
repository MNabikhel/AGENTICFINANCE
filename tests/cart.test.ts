import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { offerHire, fundHire } from "../packages/aether-runtime/src/hire-flow.ts";
import { DAY_MS, DAY_SEC, type HireContract, type MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISCART00000001",
    dailyLimit: 10_000_000,
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

function economy(rt: Runtime) {
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
  rt.seedOpening({ "procurement:cash": { amount: 1_500_000, currency: "USD_SIM" } });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
        ],
      }),
    ),
    "intent",
  );
  return { desk, vendor, intentId: (intent.data as { payload: { id: MandateId } }).payload.id };
}

describe("hire cart match", () => {
  it("refuses a cart whose total is not the hire price", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
    const cheap = rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        hireId,
        line_items: [
          {
            sku: "research.brief",
            description: "discounted",
            quantity: 1,
            unitAmount: { amount: 1, currency: "USD_SIM" },
          },
        ],
      }),
    );
    expect(cheap.ok).toBe(false);
    if (cheap.ok) return;
    expect(cheap.error.decision?.trace.find((t) => t.ruleId === "hire.cart_matches")?.verdict).toBe("deny");
  });

  it("accepts a cart that totals the hire in integer cents", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
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
              description: "page 1",
              quantity: 2,
              unitAmount: { amount: 40_000, currency: "USD_SIM" },
            },
          ],
        }),
      ),
      "cart",
    );
    expect((cart.data as { payload: { total: { amount: number } } }).payload.total.amount).toBe(80_000);
  });

  it("refuses a second cart on the same hire as hire.unique_cart, not a pointer swap", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
    const lines = [
      {
        sku: "research.brief",
        description: "page 1",
        quantity: 2,
        unitAmount: { amount: 40_000, currency: "USD_SIM" },
      },
    ];
    const first = must(
      rt.dispatch(cmd("mandate.issue_cart", desk.id, { intentId, merchantId: vendor.id, hireId, line_items: lines })),
      "cart",
    );
    const firstId = (first.data as { payload: { id: string } }).payload.id;
    const before = rt.carts.size;
    const r = rt.dispatch(
      cmd("mandate.issue_cart", desk.id, { intentId, merchantId: vendor.id, hireId, line_items: lines }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.unique_cart")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.carts.size).toBe(before);
    expect(rt.hires.get(hireId)?.cartId).toBe(firstId);
  });

  it("refuses a second payment on the same cart as mandate.unique_payment, not a second check", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cart = must(
      rt.dispatch(
        cmd("mandate.issue_cart", desk.id, {
          intentId,
          merchantId: vendor.id,
          line_items: [
            {
              sku: "research.brief",
              description: "page 1",
              quantity: 1,
              unitAmount: { amount: 80_000, currency: "USD_SIM" },
            },
          ],
        }),
      ),
      "cart",
    );
    const cartId = (cart.data as { payload: { id: string } }).payload.id;
    const first = must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId })), "payment");
    const firstId = (first.data as { payload: { id: string } }).payload.id;
    const before = rt.payments.size;
    const r = rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_cart")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.unique_payment");
    expect(rt.payments.size).toBe(before);
    expect(rt.payments.has(firstId as MandateId)).toBe(true);
  });

  it("refuses a cart line with no amount as command.malformed, not a mutate throw", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const clockBefore = rt.clock.now();
    const before = rt.carts.size;
    const r = rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        line_items: [{}],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("line_items[0]");
    expect(r.error.decision).toBeUndefined();
    expect(rt.carts.size).toBe(before);
    expect(rt.clock.now()).toBe(clockBefore);
  });

  it("refuses a cart line whose cents overflow as command.malformed, not a throw after yes", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const clockBefore = rt.clock.now();
    const before = rt.carts.size;
    const r = rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        line_items: [
          {
            sku: "research.brief",
            description: "too many cents",
            quantity: 2,
            unitAmount: { amount: Number.MAX_SAFE_INTEGER, currency: "USD_SIM" },
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("line_items[0].unitAmount.amount");
    expect(r.error.decision).toBeUndefined();
    expect(rt.carts.size).toBe(before);
    expect(rt.clock.now()).toBe(clockBefore);
  });

  it("refuses mixed USD and USDC cart lines as command.malformed, not a silent relabel", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const clockBefore = rt.clock.now();
    const before = rt.carts.size;
    const r = rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: vendor.id,
        line_items: [
          {
            sku: "research.brief",
            description: "usd",
            quantity: 1,
            unitAmount: { amount: 40_000, currency: "USD_SIM" },
          },
          {
            sku: "research.brief",
            description: "usdc",
            quantity: 1,
            unitAmount: { amount: 40_000, currency: "USDC_SIM" },
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("line_items[1].unitAmount.currency");
    expect(r.error.decision).toBeUndefined();
    expect(rt.carts.size).toBe(before);
    expect(rt.clock.now()).toBe(clockBefore);
  });

  it("refuses to fund a hire whose cart was never bound as hire.bound_cart, not a throw at release", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
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
    const cart = must(
      rt.dispatch(
        cmd("mandate.issue_cart", desk.id, {
          intentId,
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
      ),
      "unbound cart",
    );
    const cartId = (cart.data as { payload: { id: string } }).payload.id;
    const payment = must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId })), "payment");
    const paymentId = (payment.data as { payload: { id: string } }).payload.id;
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("hire.fund", desk.id, { hireId, cartId, paymentMandateId: paymentId }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.bound_cart")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.cart_matches")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.unique_cart")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.bound_cart");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.hires.get(hireId)?.cartId).toBeUndefined();
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("payment exp", () => {
  it("writes payment exp one day in unix seconds, not milliseconds", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cart = must(
      rt.dispatch(
        cmd("mandate.issue_cart", desk.id, {
          intentId,
          merchantId: vendor.id,
          line_items: [
            {
              sku: "research.brief",
              description: "page 1",
              quantity: 1,
              unitAmount: { amount: 80_000, currency: "USD_SIM" },
            },
          ],
        }),
      ),
      "cart",
    );
    const cartId = (cart.data as { payload: { id: string } }).payload.id;
    const issued = must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId })), "payment");
    const payment = issued.data as { payload: { iat: number; exp: number } };
    expect(payment.payload.exp - payment.payload.iat).toBe(DAY_SEC);
    expect(payment.payload.exp - payment.payload.iat).not.toBe(DAY_MS);
  });

  it("refuses to fund after the one-day window; chain_integrity names it first", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
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
              description: "one pager",
              quantity: 1,
              unitAmount: { amount: 80_000, currency: "USD_SIM" },
            },
          ],
        }),
      ),
      "cart",
    );
    const cartId = (cart.data as { payload: { id: string } }).payload.id;
    must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId })), "payment");
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    rt.clock.set(new Date(Date.parse(rt.clock.now()) + DAY_MS + 3_600_000).toISOString());
    const r = rt.dispatch(cmd("hire.fund", desk.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.bound_cart")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.chain_integrity");
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);
  });

  it("completes a funded hire after the cart window", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    rt.clock.set(new Date(Date.parse(rt.clock.now()) + DAY_MS + 3_600_000).toISOString());
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;
    expect(delivered.value.decision.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(delivered.value.decision.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    const released = rt.dispatch(cmd("hire.release", desk.id, { hireId }));
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.value.decision.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(rt.hires.get(hireId)?.state).toBe("released");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);
    expect(rt.ledger.balanceByName("vendor:cash").amount).toBe(80_000);
  });

  it("refunds a funded hire after the cart window", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    rt.clock.set(new Date(Date.parse(rt.clock.now()) + DAY_MS + 3_600_000).toISOString());
    const refund = rt.dispatch(cmd("hire.refund", desk.id, { hireId }));
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    expect(refund.value.decision.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(rt.hires.get(hireId)?.state).toBe("refunded");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash + 80_000);
  });

  it("submits envelope after the cart window", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    rt.clock.set(new Date(Date.parse(rt.clock.now()) + DAY_MS + 3_600_000).toISOString());
    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver");
    must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
    const submitted = rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}-late` }));
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.value.decision.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(submitted.value.decision.trace.find((t) => t.ruleId === "mandate.chain_integrity")?.verdict).toBe("allow");
    expect(rt.hires.get(hireId)?.state).toBe("released");
  });

  it("still refuses a first payment on a stale unpaid cart as mandate.not_expired", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cart = must(
      rt.dispatch(
        cmd("mandate.issue_cart", desk.id, {
          intentId,
          merchantId: vendor.id,
          line_items: [
            {
              sku: "research.brief",
              description: "page 1",
              quantity: 1,
              unitAmount: { amount: 80_000, currency: "USD_SIM" },
            },
          ],
        }),
      ),
      "cart",
    );
    const cartId = (cart.data as { payload: { id: string } }).payload.id;
    const before = rt.payments.size;
    rt.clock.set(new Date(Date.parse(rt.clock.now()) + DAY_MS + 3_600_000).toISOString());
    const r = rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.not_expired");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("allow");
    expect(rt.payments.size).toBe(before);
  });

  it("still names hire.state first when refunding delivered work after the cart window", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver");
    rt.clock.set(new Date(Date.parse(rt.clock.now()) + DAY_MS + 3_600_000).toISOString());
    const r = rt.dispatch(cmd("hire.refund", desk.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.state");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
  });
});

describe("checkout party", () => {
  function matchingLines() {
    return [
      {
        sku: "research.brief",
        description: "page 1",
        quantity: 1,
        unitAmount: { amount: 80_000, currency: "USD_SIM" as const },
      },
    ];
  }

  function roster(rt: Runtime) {
    const { desk, vendor, intentId } = economy(rt);
    const founder = rt.alias("ops-human");
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "other-desk",
          displayName: "Other Desk",
          role: "procurement",
          autonomyLevel: 3,
        }),
      ),
      "other-desk",
    );
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "treasury",
          displayName: "Treasury",
          role: "treasury",
          autonomyLevel: 3,
        }),
      ),
      "treasury",
    );
    return { desk, vendor, intentId, founder, otherDesk: rt.alias("other-desk"), treasury: rt.alias("treasury") };
  }

  function acceptedHire(rt: Runtime, desk: ReturnType<Runtime["alias"]>, vendor: ReturnType<Runtime["alias"]>, intentId: MandateId) {
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) throw new Error("offer");
    const hireId = (offered.attempt.value.data as HireContract).id;
    must(rt.dispatch(cmd("hire.accept", vendor.id, { hireId })), "accept");
    return hireId;
  }

  it("refuses another desk filling a live hire as mandate.checkout_party, not a mint", () => {
    const rt = boot();
    const { desk, vendor, intentId, otherDesk } = roster(rt);
    const hireId = acceptedHire(rt, desk, vendor, intentId);
    const before = rt.carts.size;
    const sneak = rt.dispatch(
      cmd("mandate.issue_cart", otherDesk.id, {
        intentId,
        merchantId: vendor.id,
        hireId,
        line_items: matchingLines(),
      }),
    );
    expect(sneak.ok).toBe(false);
    if (sneak.ok) return;
    expect(sneak.error.decision?.remediation?.ruleId).toBe("mandate.checkout_party");
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.unique_cart")?.verdict).toBe("allow");
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.cart_matches")?.verdict).toBe("allow");
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "mandate.cart_party")?.verdict).toBe("allow");
    expect(rt.carts.size).toBe(before);
    expect(rt.hires.get(hireId)?.cartId).toBeUndefined();
    const cart = must(
      rt.dispatch(
        cmd("mandate.issue_cart", desk.id, {
          intentId,
          merchantId: vendor.id,
          hireId,
          line_items: matchingLines(),
        }),
      ),
      "buyer cart",
    );
    const cartId = (cart.data as { payload: { id: string } }).payload.id;
    const paymentsBefore = rt.payments.size;
    const floor = rt.dispatch(cmd("mandate.issue_payment", otherDesk.id, { cartId }));
    expect(floor.ok).toBe(false);
    if (floor.ok) return;
    expect(floor.error.decision?.remediation?.ruleId).toBe("mandate.checkout_party");
    expect(floor.error.decision?.trace.find((t) => t.ruleId === "mandate.unique_payment")?.verdict).toBe("allow");
    expect(floor.error.decision?.trace.find((t) => t.ruleId === "mandate.payment_party")?.verdict).toBe("allow");
    expect(rt.payments.size).toBe(paymentsBefore);
    must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId })), "buyer payment");
    expect(rt.payments.size).toBe(paymentsBefore + 1);
  });

  it("lets treasury fill the buyer's unused checkout", () => {
    const rt = boot();
    const { desk, vendor, intentId, treasury } = roster(rt);
    const hireId = acceptedHire(rt, desk, vendor, intentId);
    const trea = must(
      rt.dispatch(
        cmd("mandate.issue_cart", treasury.id, {
          intentId,
          merchantId: vendor.id,
          hireId,
          line_items: matchingLines(),
        }),
      ),
      "treasury cart",
    );
    expect((trea.data as { payload: { id: string } }).payload.id.startsWith("mid_")).toBe(true);
  });

  it("still names hire.unique_cart first when a stranger's second cart would also fill", () => {
    const rt = boot();
    const { desk, vendor, intentId, otherDesk } = roster(rt);
    const hireId = acceptedHire(rt, desk, vendor, intentId);
    must(
      rt.dispatch(
        cmd("mandate.issue_cart", desk.id, {
          intentId,
          merchantId: vendor.id,
          hireId,
          line_items: matchingLines(),
        }),
      ),
      "buyer cart",
    );
    const r = rt.dispatch(
      cmd("mandate.issue_cart", otherDesk.id, {
        intentId,
        merchantId: vendor.id,
        hireId,
        line_items: matchingLines(),
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.unique_cart");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.checkout_party")?.verdict).toBe("deny");
  });
});
