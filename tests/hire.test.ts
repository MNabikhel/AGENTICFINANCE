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

describe("parent freshness", () => {
  it("refuses a child of an expired parent as mandate.parent_fresh, not a written slip", () => {
    const rt = boot();
    const { desk, intentId } = economy(rt);
    const founder = rt.alias("ops-human");
    rt.clock.set("2026-09-05T00:00:00.000Z");
    const before = rt.intents.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        parentId: intentId,
        task: "hand down after the parent died",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.parent_fresh");
    expect(r.error.decision?.remediation?.kind).toBe("issue_intent");
    expect(rt.intents.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("whose parent is dead"))).toBe(true);
  });

  it("still writes a tighter child while the parent lives", () => {
    const rt = boot();
    const { desk, intentId } = economy(rt);
    const founder = rt.alias("ops-human");
    const before = rt.intents.size;
    const r = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          parentId: intentId,
          task: "hand down a smaller budget",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        }),
      ),
      "child",
    );
    expect(r.decision.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(rt.intents.size).toBe(before + 1);
    expect((r.data as { payload: { parentId?: string } }).payload.parentId).toBe(intentId);
  });

  it("refuses a new hire against a live child after the parent dies as mandate.parent_fresh", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const founder = rt.alias("ops-human");
    rt.clock.set("2026-09-03T00:00:00.000Z");
    const child = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          parentId: intentId,
          task: "hand down before the parent dies",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        }),
      ),
      "child",
    );
    const childId = (child.data as { payload: { id: MandateId } }).payload.id;
    rt.clock.set("2026-09-05T00:00:00.000Z");
    const late = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "too late",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId: childId,
    });
    expect(late.attempt.ok).toBe(false);
    if (late.attempt.ok) return;
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("deny");
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
    expect(late.attempt.error.decision?.remediation?.ruleId).toBe("mandate.parent_fresh");
  });

  it("lets a funded child hire finish after the parent dies", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const founder = rt.alias("ops-human");
    rt.clock.set("2026-09-03T12:00:00.000Z");
    const child = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          parentId: intentId,
          task: "hand down before the parent dies",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100_000 }],
        }),
      ),
      "child",
    );
    const childId = (child.data as { payload: { id: MandateId } }).payload.id;
    const offeredChild = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId: childId,
    });
    expect(offeredChild.attempt.ok).toBe(true);
    if (!offeredChild.attempt.ok) return;
    const hireId = (offeredChild.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId: childId,
      qty: 1,
      unitAmount: 80_000,
    });
    rt.clock.set("2026-09-04T06:00:00.000Z");
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
    expect(delivered.ok && delivered.value.decision.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe(
      "allow",
    );
  });
});

describe("kya parent hop freshness on spend", () => {
  const NOON = "2026-08-28T12:00:00.000Z";
  const AFTER_NOON = "2026-08-28T18:00:00.000Z";

  function nestedScout(rt: ReturnType<typeof boot>) {
    const { desk, vendor } = economy(rt);
    const founder = rt.alias("ops-human");
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 3,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    rt.seedOpening({ "scout:cash": { amount: 1_500_000, currency: "USD_SIM" } });
    const parent = must(
      rt.dispatch(
        cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3, expiresAt: NOON }),
      ),
      "parent hop",
    );
    const parentId = (parent.data as { id: string }).id;
    must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, parentId, maxAutonomy: 3 })),
      "nested hop",
    );
    const intent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: scout.id,
          task: "buy as nested scout",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
        }),
      ),
      "scout intent",
    );
    return {
      founder,
      desk,
      vendor,
      scout,
      parentId,
      intentId: (intent.data as { payload: { id: MandateId } }).payload.id,
    };
  }

  it("still hires against a nested hop while the parent hop lives", () => {
    const rt = boot();
    const { scout, vendor, intentId } = nestedScout(rt);
    const live = offerHire(rt, {
      buyer: scout.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(live.attempt.ok).toBe(true);
    if (!live.attempt.ok) return;
    expect(live.attempt.value.decision.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
  });

  it("refuses a new hire against a nested hop after the parent hop dies as kya.parent_fresh", () => {
    const rt = boot();
    const { scout, vendor, intentId } = nestedScout(rt);
    rt.clock.set(AFTER_NOON);
    const late = offerHire(rt, {
      buyer: scout.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "too late",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(late.attempt.ok).toBe(false);
    if (late.attempt.ok) return;
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(late.attempt.error.decision?.remediation?.ruleId).toBe("kya.parent_fresh");
  });

  it("refuses to fund a nested hire after the parent hop dies as kya.parent_fresh", () => {
    const rt = boot();
    const { scout, vendor, intentId } = nestedScout(rt);
    const live = offerHire(rt, {
      buyer: scout.id,
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
    const { paymentId } = cartAndPay(rt, { hireId, buyer: scout.id, seller: vendor.id, intentId });
    rt.clock.set(AFTER_NOON);
    const r = rt.dispatch(cmd("hire.fund", scout.id, { hireId, paymentMandateId: paymentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.parent_fresh");
  });

  it("lets a funded nested hire finish after the parent hop dies", () => {
    const rt = boot();
    const { scout, vendor, intentId } = nestedScout(rt);
    const live = offerHire(rt, {
      buyer: scout.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(live.attempt.ok).toBe(true);
    if (!live.attempt.ok) return;
    const hireId = (live.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: scout.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    rt.clock.set(AFTER_NOON);
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
    expect(delivered.ok && delivered.value.decision.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe(
      "allow",
    );
    const released = rt.dispatch(cmd("hire.release", scout.id, { hireId }));
    expect(released.ok).toBe(true);
    expect(released.ok && released.value.decision.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe(
      "allow",
    );
  });
});

describe("kya hop freshness on complete after fund", () => {
  const NOON = "2026-08-28T12:00:00.000Z";
  const AFTER_NOON = "2026-08-28T18:00:00.000Z";

  function timedDesk(rt: ReturnType<typeof boot>) {
    const { desk, vendor, intentId } = economy(rt);
    const founder = rt.alias("ops-human");
    must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3, expiresAt: NOON })),
      "timed hop",
    );
    return { founder, desk, vendor, intentId };
  }

  function fundedTimed(rt: ReturnType<typeof boot>) {
    const { founder, desk, vendor, intentId } = timedDesk(rt);
    const live = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    if (!live.attempt.ok) throw new Error("expected hire.create allow while hop lives");
    const hireId = (live.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    return { founder, desk, vendor, intentId, hireId };
  }

  it("still hires against a timed hop while it lives", () => {
    const rt = boot();
    const { desk, vendor, intentId } = timedDesk(rt);
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
    expect(live.attempt.value.decision.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
  });

  it("refuses a new hire after the hop dies as kya.attestation_fresh", () => {
    const rt = boot();
    const { desk, vendor, intentId } = timedDesk(rt);
    rt.clock.set(AFTER_NOON);
    const late = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "too late",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(late.attempt.ok).toBe(false);
    if (late.attempt.ok) return;
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("deny");
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
    expect(late.attempt.error.decision?.remediation?.ruleId).toBe("kya.attestation_fresh");
  });

  it("refuses to fund after the hop dies as kya.attestation_fresh", () => {
    const rt = boot();
    const { desk, vendor, intentId } = timedDesk(rt);
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
    rt.clock.set(AFTER_NOON);
    const r = rt.dispatch(cmd("hire.fund", desk.id, { hireId, paymentMandateId: paymentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.attestation_fresh");
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
  });

  it("lets a funded hire finish after the hop dies", () => {
    const rt = boot();
    const { desk, vendor, hireId } = fundedTimed(rt);
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    rt.clock.set(AFTER_NOON);
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;
    expect(delivered.value.decision.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    const released = rt.dispatch(cmd("hire.release", desk.id, { hireId }));
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.value.decision.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(released.value.decision.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(rt.hires.get(hireId)?.state).toBe("released");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);
    expect(rt.ledger.balanceByName("vendor:cash").amount).toBe(80_000);
  });

  it("refunds a funded hire after the hop dies", () => {
    const rt = boot();
    const { desk, hireId } = fundedTimed(rt);
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    rt.clock.set(AFTER_NOON);
    const refund = rt.dispatch(cmd("hire.refund", desk.id, { hireId }));
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    expect(refund.value.decision.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(rt.hires.get(hireId)?.state).toBe("refunded");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash + 80_000);
  });

  it("submits envelope after the hop dies", () => {
    const rt = boot();
    const { desk, vendor, hireId } = fundedTimed(rt);
    rt.clock.set(AFTER_NOON);
    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver");
    must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
    const submitted = rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}-late-kya` }));
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.value.decision.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(submitted.value.decision.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(rt.hires.get(hireId)?.state).toBe("released");
  });

  it("still names kya.chain_intact on release after revoke", () => {
    const rt = boot();
    const { founder, desk, vendor, hireId } = fundedTimed(rt);
    must(rt.dispatch(cmd("kya.revoke", founder.id, { delegateId: desk.id })), "revoke");
    rt.clock.set(AFTER_NOON);
    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver");
    const vendorCash = rt.ledger.balanceByName("vendor:cash").amount;
    const r = rt.dispatch(cmd("hire.release", desk.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.chain_intact");
    expect(rt.hires.get(hireId)?.state).toBe("delivered");
    expect(rt.ledger.balanceByName("vendor:cash").amount).toBe(vendorCash);
  });

  it("still names kya.principal_not_frozen on release after the founder is frozen", () => {
    const rt = boot();
    const { founder, desk, vendor, hireId } = fundedTimed(rt);
    must(rt.dispatch(cmd("identity.freeze", founder.id, { agentId: founder.id })), "freeze founder");
    rt.clock.set(AFTER_NOON);
    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver");
    const vendorCash = rt.ledger.balanceByName("vendor:cash").amount;
    const r = rt.dispatch(cmd("hire.release", desk.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.principal_not_frozen")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.attestation_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.not_frozen")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.principal_not_frozen");
    expect(rt.hires.get(hireId)?.state).toBe("delivered");
    expect(rt.ledger.balanceByName("vendor:cash").amount).toBe(vendorCash);
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

  it("refuses to quote an FX SKU without a window as fx_window, not a hireable good", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
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
    const before = rt.quotes.size;
    const r = rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80_000, currency: "USDC_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_window")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.not_fx")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.fx_window");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.quotes.size).toBe(before);
  });
});
