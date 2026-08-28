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
  return { founder, desk, vendor, intentId: (intent.data as { payload: { id: MandateId } }).payload.id };
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
