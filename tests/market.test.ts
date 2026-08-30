import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { CATALOG, fxPairSettles } from "@aether/market";
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
    expect(rfq.error.decision.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
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

  it("refuses an RFQ that invites a missing seller as identity.known, not a closed room nobody can quote", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const before = rt.rfqs.size;
    const r = rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "one pager",
        invitedSellerIds: ["aid_01J6AETHERGHOSTSELLER00001"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.rfqs.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(auditBefore);
    const live = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, {
          sku: "research.brief",
          spec: "retry with a live guest",
          invitedSellerIds: [vendor.id],
        }),
      ),
      "live rfq",
    );
    expect((live.data as { invitedSellerIds: string[] }).invitedSellerIds).toEqual([vendor.id]);
  });

  it("refuses a mixed live-and-ghost invite list as identity.known", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const before = rt.rfqs.size;
    const r = rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "one pager",
        invitedSellerIds: [vendor.id, "aid_01J6AETHERGHOSTSELLER00001"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
    expect(rt.rfqs.size).toBe(before);
  });

  it("still names known_sku first when the catalog miss is also a ghost invite", () => {
    const rt = boot();
    const { desk } = economy(rt);
    const before = rt.rfqs.size;
    const r = rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "lunch.tacos",
        spec: "not a listed good",
        invitedSellerIds: ["aid_01J6AETHERGHOSTSELLER00001"],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.known_sku");
    expect(rt.rfqs.size).toBe(before);
  });
});

describe("known RFQ", () => {
  it("refuses a quote against a missing RFQ as known_rfq, not known_sku", () => {
    const rt = boot();
    const { vendor } = economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const r = rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: "rfq_01J6AETHERGHOSTRFQ00000001",
        price: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.invited_seller")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.known_rfq");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(auditBefore);
  });

  it("refuses to hire on an unknown quote as known_rfq", () => {
    const rt = boot();
    const { desk, intentId } = economy(rt);
    const r = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId: "qte_01J6AETHERGHOSTQTE00000001",
        intentId,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.known_rfq");
  });

  it("refuses to fold a missing quote as known_rfq, not a stolen bid", () => {
    const rt = boot();
    const { vendor } = economy(rt);
    const r = rt.dispatch(cmd("market.withdraw", vendor.id, { quoteId: "qte_01J6AETHERGHOSTQTE00000001" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("market.known_rfq");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(rt.audit.all().some((e) => e.action === "QUOTE_WITHDRAW")).toBe(false);
  });

  it("refuses a second vendor folding a live bid as market.party", () => {
    const rt = boot();
    const { desk, vendor, other } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "live bid",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const r = rt.dispatch(cmd("market.withdraw", other.id, { quoteId: invited.quoteId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("market.party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(rt.quoteView(rt.quotes.get(invited.quoteId)!).status).toBe("live");
    expect(rt.audit.all().some((e) => e.action === "QUOTE_WITHDRAW")).toBe(false);
  });

  it("lets a seller fold its own live bid; hiring it is not_expired", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "fold me",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const folded = must(rt.dispatch(cmd("market.withdraw", vendor.id, { quoteId: invited.quoteId })), "fold");
    expect((folded.data as { id: string }).id).toBe(invited.quoteId);
    expect(rt.quoteView(rt.quotes.get(invited.quoteId)!).status).toBe("withdrawn");
    expect("status" in (rt.quotes.get(invited.quoteId) ?? {})).toBe(false);
    expect(rt.audit.all().some((e) => e.action === "QUOTE_WITHDRAW")).toBe(true);
    const hire = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(hire.ok).toBe(false);
    if (hire.ok) return;
    expect(hire.error.decision?.remediation?.ruleId).toBe("market.not_expired");
    expect(hire.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
  });
});

describe("rfq close", () => {
  it("refuses to shut a missing room as known_rfq, not a stolen close", () => {
    const rt = boot();
    const { desk } = economy(rt);
    const r = rt.dispatch(cmd("market.close", desk.id, { rfqId: "rfq_01J6AETHERGHOSTRFQ00000001" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("market.known_rfq");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.rfq_party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(rt.audit.all().some((e) => e.action === "RFQ_CLOSE")).toBe(false);
  });

  it("refuses a second desk shutting a live room as market.rfq_party", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
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
    const otherDesk = rt.alias("other-desk");
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "live room",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const rfqId = (invited.rfq.data as { id: string }).id;
    const r = rt.dispatch(cmd("market.close", otherDesk.id, { rfqId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("market.rfq_party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.party")?.verdict).toBe("allow");
    expect(rt.rfqView(rt.rfqs.get(rfqId)!).status).toBe("live");
    expect(rt.audit.all().some((e) => e.action === "RFQ_CLOSE")).toBe(false);
  });

  it("lets a buyer shut its own live room; hiring a quote on it is not_expired", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "shut me",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const rfqId = (invited.rfq.data as { id: string }).id;
    const shut = must(rt.dispatch(cmd("market.close", desk.id, { rfqId })), "shut");
    expect((shut.data as { id: string }).id).toBe(rfqId);
    expect(rt.rfqView(rt.rfqs.get(rfqId)!).status).toBe("closed");
    expect("status" in (rt.rfqs.get(rfqId) ?? {})).toBe(false);
    expect(rt.quoteView(rt.quotes.get(invited.quoteId)!).status).toBe("expired");
    expect(rt.audit.all().some((e) => e.action === "RFQ_CLOSE")).toBe(true);
    const hire = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(hire.ok).toBe(false);
    if (hire.ok) return;
    expect(hire.error.decision?.remediation?.ruleId).toBe("market.not_expired");
    expect(hire.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(hire.error.decision?.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
  });
});

describe("rfq hire party", () => {
  it("refuses a second desk hiring a live unused quote as hire.room_party", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
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
    const otherDesk = rt.alias("other-desk");
    const otherIntent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: otherDesk.id,
          task: "poach",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
        }),
      ),
      "other intent",
    );
    const otherIntentId = (otherIntent.data as { payload: { id: MandateId } }).payload.id;
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "live unused quote",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const before = rt.hires.size;
    const r = rt.dispatch(cmd("hire.create", otherDesk.id, { quoteId: invited.quoteId, intentId: otherIntentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.room_party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.rfq_party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
    expect(rt.hires.size).toBe(before);
    expect(rt.consumedQuotes.has(invited.quoteId)).toBe(false);
    const legal = must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })), "buyer hire");
    expect((legal.data as HireContract).id.startsWith("hid_")).toBe(true);
  });

  it("lets treasury hire from the buyer's live room", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
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
    const treasury = rt.alias("treasury");
    const treaIntent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: treasury.id,
          task: "allocator hire",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
        }),
      ),
      "treasury intent",
    );
    const treaIntentId = (treaIntent.data as { payload: { id: MandateId } }).payload.id;
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "treasury may hire",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const trea = must(
      rt.dispatch(cmd("hire.create", treasury.id, { quoteId: invited.quoteId, intentId: treaIntentId })),
      "treasury hire",
    );
    expect((trea.data as HireContract).buyerId).toBe(treasury.id);
  });

  it("still names hire.quote_unspent first when a stranger's second hire would also poach", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
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
    const otherDesk = rt.alias("other-desk");
    const otherIntent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: otherDesk.id,
          task: "poach spent",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
        }),
      ),
      "other intent",
    );
    const otherIntentId = (otherIntent.data as { payload: { id: MandateId } }).payload.id;
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "already hired",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })), "buyer hire");
    const r = rt.dispatch(cmd("hire.create", otherDesk.id, { quoteId: invited.quoteId, intentId: otherIntentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.quote_unspent");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("deny");
  });

  it("refuses a second desk hiring against a live unused slip as hire.slip_party", () => {
    const rt = boot();
    const { founder, vendor, intentId } = economy(rt);
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
    const otherDesk = rt.alias("other-desk");
    const invited = inviteQuote(rt, {
      buyer: otherDesk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "own room, foreign slip",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const before = rt.hires.size;
    const r = rt.dispatch(cmd("hire.create", otherDesk.id, { quoteId: invited.quoteId, intentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.slip_party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(rt.hires.size).toBe(before);
    expect(rt.consumedQuotes.has(invited.quoteId)).toBe(false);
    const own = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: otherDesk.id,
          task: "own slip",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
        }),
      ),
      "own slip",
    );
    const ownId = (own.data as { payload: { id: MandateId } }).payload.id;
    const legal = must(
      rt.dispatch(cmd("hire.create", otherDesk.id, { quoteId: invited.quoteId, intentId: ownId })),
      "subject hire",
    );
    expect((legal.data as HireContract).id.startsWith("hid_")).toBe(true);
  });

  it("lets treasury hire against another desk's unused slip", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
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
    const treasury = rt.alias("treasury");
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
    const otherDesk = rt.alias("other-desk");
    const invited = inviteQuote(rt, {
      buyer: otherDesk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "treasury allocator slip",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const trea = must(
      rt.dispatch(cmd("hire.create", treasury.id, { quoteId: invited.quoteId, intentId })),
      "treasury slip hire",
    );
    expect((trea.data as HireContract).buyerId).toBe(treasury.id);
    expect((trea.data as HireContract).intentId).toBe(intentId);
    expect(desk.id).not.toBe(treasury.id);
  });

  it("still names hire.room_party first when a foreign room would also wear a foreign slip", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
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
    const otherDesk = rt.alias("other-desk");
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "foreign room and foreign slip",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const r = rt.dispatch(cmd("hire.create", otherDesk.id, { quoteId: invited.quoteId, intentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.room_party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("deny");
  });

  it("still names mandate.known_intent first when a ghost slip would also be a guise", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
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
    const otherDesk = rt.alias("other-desk");
    const invited = inviteQuote(rt, {
      buyer: otherDesk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "ghost slip",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const r = rt.dispatch(
      cmd("hire.create", otherDesk.id, {
        quoteId: invited.quoteId,
        intentId: "mid_01J6AETHERGHOSTINTENT00001",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_intent");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
  });

  it("still names actor.role_capability first when a founder would also wear a desk slip", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "founder cannot hire.create",
      price: { amount: 40_000, currency: "USD_SIM" },
    });
    const r = rt.dispatch(cmd("hire.create", founder.id, { quoteId: invited.quoteId, intentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.role_capability");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.slip_party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.room_party")?.verdict).toBe("allow");
  });
});

describe("mandate.child_party", () => {
  function nestWorld() {
    const rt = boot();
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
      { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 4 },
      { key: "other-desk", displayName: "Other Desk", role: "procurement", autonomyLevel: 4 },
      { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
    ] as const) {
      must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
    }
    const desk = rt.alias("desk");
    const otherDesk = rt.alias("other-desk");
    const vendor = rt.alias("vendor");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 4 })), "kya desk");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: otherDesk.id, maxAutonomy: 4 })), "kya other");
    const payees = {
      type: "payment.allowed_payees" as const,
      allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
    };
    const parent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "parent",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
            { type: "aether.allowed_skus", allowed: ["research.brief"] },
            payees,
          ],
        }),
      ),
      "parent",
    );
    return {
      rt,
      founder,
      desk,
      otherDesk,
      parentId: (parent.data as { payload: { id: MandateId } }).payload.id,
      payees,
    };
  }

  it("refuses a second desk nesting under the research desk's parent as mandate.child_party", () => {
    const { rt, otherDesk, parentId, payees } = nestWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", otherDesk.id, {
        subjectId: otherDesk.id,
        parentId,
        task: "cuckoo",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.child_party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(rt.intents.size).toBe(1);
  });

  it("still names mandate.known_parent first when a ghost parent would also be a cuckoo", () => {
    const { rt, otherDesk, payees } = nestWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", otherDesk.id, {
        subjectId: otherDesk.id,
        parentId: "mid_01J6AETHERGHOSTPARENT00001",
        task: "ghost",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_parent");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
  });

  it("allows a founder nesting under a desk parent as mandate.child_party", () => {
    const { rt, founder, parentId, payees } = nestWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: founder.id,
        parentId,
        task: "founder nest",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.decision.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
  });

  it("allows the parent subject nesting a tighter child as mandate.child_party", () => {
    const { rt, desk, parentId, payees } = nestWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", desk.id, {
        subjectId: desk.id,
        parentId,
        task: "subject nest",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.decision.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
  });

  it("allows treasury nesting under a desk parent as mandate.child_party", () => {
    const { rt, founder, parentId, payees } = nestWorld();
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
    const treasury = rt.alias("treasury");
    const r = rt.dispatch(
      cmd("mandate.issue_intent", treasury.id, {
        subjectId: treasury.id,
        parentId,
        task: "treasury nest",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.decision.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
  });

  it("still names mandate.parent_fresh first when a dead parent would also be a cuckoo", () => {
    const { rt, founder, otherDesk, parentId, payees } = nestWorld();
    must(rt.dispatch(cmd("mandate.revoke", founder.id, { intentId: parentId })), "rip parent");
    const r = rt.dispatch(
      cmd("mandate.issue_intent", otherDesk.id, {
        subjectId: otherDesk.id,
        parentId,
        task: "ripped",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.parent_fresh");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("deny");
  });
});

describe("mandate.root_party", () => {
  function rootWorld() {
    const rt = boot();
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
      { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 4 },
      { key: "other-desk", displayName: "Other Desk", role: "procurement", autonomyLevel: 4 },
      { key: "scout", displayName: "Scout", role: "procurement", autonomyLevel: 3 },
      { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
      { key: "treasury", displayName: "Treasury", role: "treasury", autonomyLevel: 3 },
    ] as const) {
      must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
    }
    const desk = rt.alias("desk");
    const otherDesk = rt.alias("other-desk");
    const scout = rt.alias("scout");
    const vendor = rt.alias("vendor");
    const treasury = rt.alias("treasury");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 4 })), "kya desk");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: otherDesk.id, maxAutonomy: 4 })), "kya other");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, maxAutonomy: 3 })), "kya scout");
    const payees = {
      type: "payment.allowed_payees" as const,
      allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
    };
    const parent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "parent",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
            { type: "aether.allowed_skus", allowed: ["research.brief"] },
            payees,
          ],
        }),
      ),
      "parent",
    );
    return {
      rt,
      founder,
      desk,
      otherDesk,
      scout,
      vendor,
      treasury,
      parentId: (parent.data as { payload: { id: MandateId } }).payload.id,
      payees,
    };
  }

  it("refuses a second desk minting a root in the research desk's name as mandate.root_party", () => {
    const { rt, otherDesk, desk, payees } = rootWorld();
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", otherDesk.id, {
        subjectId: desk.id,
        task: "forge",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.root_party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.child_party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe("allow");
    expect(rt.intents.size).toBe(before);
  });

  it("still names identity.known first when a ghost subject would also be a forge", () => {
    const { rt, otherDesk, payees } = rootWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", otherDesk.id, {
        subjectId: "aid_01J6AETHERGHOSTSUBJECT00001",
        task: "ghost",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
  });

  it("still names mandate.child_party first when a nested foreign child would also be a forge", () => {
    const { rt, otherDesk, parentId, payees } = rootWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", otherDesk.id, {
        subjectId: otherDesk.id,
        parentId,
        task: "cuckoo",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.child_party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
  });

  it("still names ladder.min_level first when a junior foreign root would also be a forge", () => {
    const { rt, scout, desk, payees } = rootWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", scout.id, {
        subjectId: desk.id,
        task: "junior",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("ladder.min_level");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("deny");
  });

  it("still names actor.role_capability first when a vendor foreign root would also be a forge", () => {
    const { rt, vendor, desk, payees } = rootWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", vendor.id, {
        subjectId: desk.id,
        task: "vendor",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.role_capability");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("deny");
  });

  it("allows a founder minting a root for a desk as mandate.root_party", () => {
    const { rt, founder, desk, payees } = rootWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "founder root",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.decision.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
  });

  it("allows the named subject minting a self-root as mandate.root_party", () => {
    const { rt, desk, payees } = rootWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", desk.id, {
        subjectId: desk.id,
        task: "self root",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.decision.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
    expect((r.value.data as { payload: { parentId?: string } }).payload.parentId).toBeUndefined();
  });

  it("allows treasury minting a root for a desk as mandate.root_party", () => {
    const { rt, treasury, desk, payees } = rootWorld();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", treasury.id, {
        subjectId: desk.id,
        task: "treasury root",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "aether.allowed_skus", allowed: ["research.brief"] },
          payees,
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.decision.trace.find((t) => t.ruleId === "mandate.root_party")?.verdict).toBe("allow");
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

  it("refuses a role that is not an agent role before minting anyone", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const before = rt.identity.all().length;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("identity.register", founder.id, { key: "chaos", displayName: "Chaos", role: "god" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("role");
    expect(r.error.decision).toBeUndefined();
    expect(rt.identity.all()).toHaveLength(before);
    expect(rt.clock.now()).toBe(clockBefore);
  });

  it("refuses an approval decision that is not approved or rejected before policy", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const r = rt.dispatch(
      cmd("approval.resolve", founder.id, { approvalId: "apd_01J6AETHERGHOSTTICKET0001", decision: "maybe" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("decision");
    expect(r.error.decision).toBeUndefined();
    expect(rt.clock.now()).toBe(clockBefore);
    expect(rt.audit.length).toBe(auditBefore);
  });

  it("refuses a numeric agentId as command.malformed, not a mutate throw after yes", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const r = rt.dispatch(cmd("identity.freeze", founder.id, { agentId: 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("agentId");
    expect(r.error.decision).toBeUndefined();
    expect(rt.clock.now()).toBe(clockBefore);
    expect(rt.audit.length).toBe(auditBefore);
  });
});

describe("catalog currency", () => {
  it("refuses a USD-only SKU quoted in USDC as sku_currency, not a later mixed journal", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, { sku: "research.brief", spec: "one pager", invitedSellerIds: [vendor.id] }),
      ),
      "rfq",
    );
    const clockBefore = rt.clock.now();
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
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.sku_currency")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_rfq")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.fx_pair")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("market.sku_currency");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.quotes.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("fxPairSettles", () => {
  const usd = { amount: 80_000, currency: "USD_SIM" as const };
  const usdc = { amount: 80_000, currency: "USDC_SIM" as const };
  const window = { from: "USD_SIM" as const, to: "USDC_SIM" as const };

  it("accepts the catalog FX SKU priced in from", () => {
    expect(fxPairSettles("fx.usd_sim.usdc_sim", usd, window)).toBe(true);
  });

  it("rejects a research SKU wearing an FX window", () => {
    expect(fxPairSettles("research.brief", usd, window)).toBe(false);
  });

  it("rejects a swapped pair or a price in to", () => {
    expect(fxPairSettles("fx.usd_sim.usdc_sim", usd, { from: "USDC_SIM", to: "USD_SIM" })).toBe(false);
    expect(fxPairSettles("fx.usd_sim.usdc_sim", usdc, window)).toBe(false);
  });
});
