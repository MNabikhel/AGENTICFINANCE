import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { CATALOG } from "@aether/market";
import { inviteQuote, offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { HireContract, MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISMKT00000001",
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
    { key: "vendor-b", displayName: "Other Vendor", role: "data_vendor", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  rt.seedOpening({ "procurement:cash": { amount: 1_500_000, currency: "USD_SIM" } });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const other = rt.alias("vendor-b");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          {
            type: "payment.allowed_payees",
            allowed: [
              { id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" },
              { id: other.id, name: other.displayName, website: "https://other.aether.test" },
            ],
          },
        ],
      }),
    ),
    "intent",
  );
  return { founder, desk, vendor, other, intentId: (intent.data as { payload: { id: MandateId } }).payload.id };
}

describe("market catalog", () => {
  it("lists hireable SKUs and refuses unknown ones", () => {
    const rt = boot();
    const { desk } = economy(rt);
    const listed = must(rt.dispatch(cmd("market.catalog", desk.id, {})), "catalog");
    expect(Object.keys((listed.data as { skus: typeof CATALOG }).skus)).toContain("research.brief");
    const rfq = rt.dispatch(
      cmd("market.rfq", desk.id, { sku: "lunch.tacos", spec: "not a listed good", invitedSellerIds: [] }),
    );
    expect(rfq.ok).toBe(false);
    if (rfq.ok) return;
    expect(rfq.error.decision.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("deny");
    expect(rfq.error.decision.remediation?.kind).toBe("none");
  });
});

describe("quote expiry", () => {
  it("refuses to hire on a stale quote", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    rt.clock.set("2026-08-28T02:00:00.000Z");
    const late = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.decision.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("deny");
  });
});

describe("audit.query", () => {
  it("returns notary lines for a hire id", () => {
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
    const q = must(rt.dispatch(cmd("audit.query", desk.id, { subjectId: hireId })), "query");
    const data = q.data as { records: { action: string; subjects: { id: string }[] }[]; matched: number };
    expect(data.matched).toBeGreaterThan(0);
    expect(data.records.every((r) => r.subjects.some((s) => s.id === hireId))).toBe(true);
    expect(data.records.some((r) => r.action === "HIRE_TRANSITION")).toBe(true);
  });
});

describe("RFQ invites", () => {
  it("refuses a quote from a seller who was not invited", () => {
    const rt = boot();
    const { desk, vendor, other } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, {
          sku: "research.brief",
          spec: "one pager",
          invitedSellerIds: [vendor.id],
        }),
      ),
      "rfq",
    );
    const sneak = rt.dispatch(
      cmd("market.quote", other.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(sneak.ok).toBe(false);
    if (sneak.ok) return;
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("deny");
    expect(sneak.error.decision?.remediation?.kind).toBe("none");
  });

  it("lets any seller quote an open RFQ (empty invite list)", () => {
    const rt = boot();
    const { desk, other } = economy(rt);
    const rfq = must(
      rt.dispatch(cmd("market.rfq", desk.id, { sku: "research.brief", spec: "open desk", invitedSellerIds: [] })),
      "open rfq",
    );
    const quoted = must(
      rt.dispatch(
        cmd("market.quote", other.id, {
          rfqId: (rfq.data as { id: string }).id,
          price: { amount: 50_000, currency: "USD_SIM" },
        }),
      ),
      "open quote",
    );
    expect((quoted.data as { sellerId: string }).sellerId).toBe(other.id);
  });
});

describe("command schema", () => {
  it("refuses missing required fields before policy or the clock", () => {
    const rt = boot();
    const { desk, intentId } = economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const r = rt.dispatch(cmd("hire.create", desk.id, { intentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("quoteId");
    expect(r.error.decision).toBeUndefined();
    expect(rt.clock.now()).toBe(clockBefore);
    expect(rt.audit.length).toBe(auditBefore);
  });

  it("does not cache a malformed command under an idempotency key", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const key = "hire-once";
    const missing = rt.dispatch(cmd("hire.create", desk.id, { intentId }, key));
    expect(missing.ok).toBe(false);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    const created = must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }, key)), "create");
    expect((created.data as HireContract).state).toBe("offered");
  });

  it("refuses a quote whose price is not integer cents", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "research.brief", spec: "one pager", invitedSellerIds: [vendor.id] }),
      ),
      "rfq",
    );
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: (rfq.data as { id: string }).id,
        price: { amount: 80.5, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.detail).toContain("price.amount");
    expect(r.error.decision).toBeUndefined();
    expect(rt.clock.now()).toBe(clockBefore);
  });
});
