import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { HireContract, MandateId } from "@aether/types";

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
});
