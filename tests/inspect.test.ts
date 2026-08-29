import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { offerHire, completeHire, inviteQuote, fundHire } from "../packages/aether-runtime/src/hire-flow.ts";
import { AetherMcp } from "../packages/aether-mcp/src/host.ts";
import { HOUR_MS, type ApprovalTicket, type CartMandate, type DelegationAttestation, type HireContract, type MandateId, type Receipt, type Rfq, type Signed } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISGET00000001",
    dailyLimit: 10_000_000,
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

function economy(rt: Runtime, max = 700_000) {
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
    { key: "treasury", displayName: "Treasury", role: "treasury", autonomyLevel: 3 },
    { key: "procurement", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  rt.seedOpening({
    "procurement:cash": { amount: 2_000_000, currency: "USD_SIM" },
    "treasury:cash": { amount: 5_000_000, currency: "USD_SIM" },
  });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max },
          { type: "payment.budget", currency: "USD_SIM", max: 2_000_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
        ],
      }),
    ),
    "intent",
  );
  return {
    founder,
    desk,
    vendor,
    treasury: rt.alias("treasury"),
    intentId: (intent.data as { payload: { id: MandateId } }).payload.id,
  };
}

function issueCart(
  rt: Runtime,
  input: { buyer: string; seller: string; intentId: MandateId; hireId?: string },
) {
  const cart = must(
    rt.dispatch(
      cmd("mandate.issue_cart", input.buyer, {
        intentId: input.intentId,
        merchantId: input.seller,
        ...(input.hireId ? { hireId: input.hireId } : {}),
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
  return (cart.data as { payload: { id: string } }).payload.id;
}

describe("inspect", () => {
  it("fetches a hire by id and an agent by alias", () => {
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
    const hire = rt.inspect(hireId);
    expect(hire?.type).toBe("hire");
    expect((hire?.value as HireContract).state).toBe("offered");
    const agent = rt.inspect("procurement");
    expect(agent?.type).toBe("agent");
    expect((agent?.value as { displayName: string }).displayName).toBe("Desk");
  });
});

describe("approval expiry", () => {
  it("refuses to resolve a ticket after expiresAt and does not trap retries", () => {
    const rt = boot();
    const { desk, vendor, treasury, intentId } = economy(rt, 700_000);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    expect(offered.attempt.value.kind).toBe("escalated");
    const ticket = offered.attempt.value.ticket as ApprovalTicket;
    expect(ticket.status).toBe("pending");
    expect(rt.inspect(ticket.id)?.type).toBe("approval");

    rt.clock.set("2026-08-30T00:00:00.000Z");
    const late = rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" }));
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.error.status).toBe(422);
    expect(late.error.error.type).toContain("policy.deny");
    expect(late.error.decision?.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("deny");
    expect(late.error.decision?.remediation?.ruleId).toBe("approval.pending");
    expect(rt.approvals.get(ticket.id)?.status).toBe("expired");

    const retry = rt.dispatch(cmd("hire.create", desk.id, { quoteId: offered.quoteId, intentId }));
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error.decision.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("deny");
    expect(rt.approvals.get(ticket.id)?.status).toBe("expired");
  });

  it("labels an expired ticket expired in inspect, not pending", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt, 700_000);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const ticket = offered.attempt.value.ticket as ApprovalTicket;
    expect((rt.inspect(ticket.id)?.value as ApprovalTicket).status).toBe("pending");
    rt.approvals.set(ticket.id, { ...ticket, expiresAt: rt.clock.now() });
    expect(rt.approvals.get(ticket.id)?.status).toBe("pending");
    expect((rt.inspect(ticket.id)?.value as ApprovalTicket).status).toBe("expired");
    expect(rt.snapshotState().approvals.find((a) => a.id === ticket.id)?.status).toBe("expired");
  });
});

describe("delegation inspect", () => {
  it("labels an expired hop expired in inspect, not live, and does not write status into the store", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const issued = must(
      rt.dispatch(
        cmd("kya.attest", founder.id, {
          delegateId: desk.id,
          maxAutonomy: 3,
          expiresAt: "2026-08-28T12:00:00.000Z",
        }),
      ),
      "attest",
    );
    const hop = issued.data as DelegationAttestation;
    expect((rt.inspect(hop.id)?.value as { status: string }).status).toBe("live");
    expect(rt.kyaSnapshot().edges.find((e) => e.to === desk.id)?.status).toBe("live");
    expect("status" in (rt.kya.attestations.get(hop.id) ?? {})).toBe(false);

    rt.clock.set("2026-08-29T00:00:00.000Z");
    expect((rt.inspect(hop.id)?.value as { status: string }).status).toBe("expired");
    expect(rt.kyaSnapshot().edges.find((e) => e.to === desk.id)?.status).toBe("expired");
    expect(rt.kya.attestations.get(hop.id)?.revokedAt).toBeUndefined();
    expect("status" in (rt.kya.attestations.get(hop.id) ?? {})).toBe(false);

    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 2 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
  });

  it("labels a revoked hop revoked even after the window has closed", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const issued = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
      "attest",
    );
    const hop = issued.data as DelegationAttestation;
    must(rt.dispatch(cmd("kya.revoke", founder.id, { attestationId: hop.id })), "revoke");
    rt.clock.set("2027-09-01T00:00:00.000Z");
    expect((rt.inspect(hop.id)?.value as { status: string }).status).toBe("revoked");
    expect(rt.kyaSnapshot().edges.find((e) => e.to === desk.id)?.status).toBe("revoked");
  });
});

describe("quote inspect", () => {
  it("labels a live quote live and does not write status into the store", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    expect((rt.inspect(invited.quoteId)?.value as { status: string }).status).toBe("live");
    expect(rt.snapshotState().quotes.find((q) => q.id === invited.quoteId)?.status).toBe("live");
    expect("status" in (rt.quotes.get(invited.quoteId) ?? {})).toBe(false);
  });

  it("labels a hired quote spent, not live", () => {
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
    expect((rt.inspect(offered.quoteId)?.value as { status: string }).status).toBe("spent");
    expect(rt.snapshotState().quotes.find((q) => q.id === offered.quoteId)?.status).toBe("spent");
    expect("status" in (rt.quotes.get(offered.quoteId) ?? {})).toBe(false);
  });

  it("labels a quote held by an open hire ticket held, not live", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt, 700_000);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    expect(offered.attempt.value.kind).toBe("escalated");
    expect((rt.inspect(offered.quoteId)?.value as { status: string }).status).toBe("held");
    expect(rt.snapshotState().quotes.find((q) => q.id === offered.quoteId)?.status).toBe("held");
    expect("status" in (rt.quotes.get(offered.quoteId) ?? {})).toBe(false);
  });

  it("labels a stale quote expired, not live", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    rt.clock.set("2026-08-28T02:00:00.000Z");
    expect((rt.inspect(invited.quoteId)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().quotes.find((q) => q.id === invited.quoteId)?.status).toBe("expired");
    expect("status" in (rt.quotes.get(invited.quoteId) ?? {})).toBe(false);
  });

  it("labels a live RFQ live, without writing status into the store", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    const rfqId = (invited.rfq.data as { id: string }).id;
    expect((rt.inspect(rfqId)?.value as { status: string }).status).toBe("live");
    expect(rt.snapshotState().rfqs.find((r) => r.id === rfqId)?.status).toBe("live");
    expect("status" in (rt.rfqs.get(rfqId) ?? {})).toBe(false);
  });

  it("labels a stale RFQ expired, not an open room", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    const rfqId = (invited.rfq.data as { id: string }).id;
    rt.clock.set("2026-08-29T00:01:00.000Z");
    expect((rt.inspect(rfqId)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().rfqs.find((r) => r.id === rfqId)?.status).toBe("expired");
    expect("status" in (rt.rfqs.get(rfqId) ?? {})).toBe(false);
    const late = rt.dispatch(
      cmd("market.quote", vendor.id, { rfqId, price: { amount: 90_000, currency: "USD_SIM" } }),
    );
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.decision?.remediation?.ruleId).toBe("market.not_expired");
  });

  it("labels a hire quote expired when the parent RFQ dies while the quote envelope still lives", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    const rfqId = (invited.rfq.data as { id: string }).id;
    const rfq = rt.rfqs.get(rfqId) as Rfq;
    rt.rfqs.set(rfqId, { ...rfq, expiresAt: rt.clock.now() });
    expect((rt.inspect(rfqId)?.value as { status: string }).status).toBe("expired");
    expect((rt.inspect(invited.quoteId)?.value as { status: string }).status).toBe("expired");
    expect("status" in (rt.quotes.get(invited.quoteId) ?? {})).toBe(false);
    const hire = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(hire.ok).toBe(false);
    if (hire.ok) return;
    expect(hire.error.decision?.remediation?.ruleId).toBe("market.not_expired");
  });

  it("labels a spent hire quote spent even after the parent RFQ dies", () => {
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
    const rfqId = (offered.rfq.data as { id: string }).id;
    const rfq = rt.rfqs.get(rfqId) as Rfq;
    rt.rfqs.set(rfqId, { ...rfq, expiresAt: rt.clock.now() });
    expect((rt.inspect(offered.quoteId)?.value as { status: string }).status).toBe("spent");
  });

  it("labels a held hire quote held even after the parent RFQ dies", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt, 700_000);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    expect(offered.attempt.value.kind).toBe("escalated");
    const rfqId = (offered.rfq.data as { id: string }).id;
    const rfq = rt.rfqs.get(rfqId) as Rfq;
    rt.rfqs.set(rfqId, { ...rfq, expiresAt: rt.clock.now() });
    expect((rt.inspect(offered.quoteId)?.value as { status: string }).status).toBe("held");
  });

  it("labels a spent quote spent even after the window has closed", () => {
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
    rt.clock.set("2026-08-28T02:00:00.000Z");
    expect((rt.inspect(offered.quoteId)?.value as { status: string }).status).toBe("spent");
  });

  it("does not expire an FX quote when the parent RFQ dies — the window lives on the quote", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "mm-room",
          displayName: "Market Maker",
          role: "market_maker",
          autonomyLevel: 2,
        }),
      ),
      "mm-room",
    );
    const mm = rt.alias("mm-room");
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, {
          sku: "fx.usd_sim.usdc_sim",
          spec: "window",
          invitedSellerIds: [mm.id],
        }),
      ),
      "fx rfq",
    );
    const quoted = must(
      rt.dispatch(
        cmd("market.quote", mm.id, {
          rfqId: (rfq.data as { id: string }).id,
          price: { amount: 80_000, currency: "USD_SIM" },
          fx: {
            from: "USD_SIM",
            to: "USDC_SIM",
            rateE6: 998_000,
            validUntil: "2026-08-28T12:00:00.000Z",
          },
        }),
      ),
      "fx quote",
    );
    const rfqId = (rfq.data as { id: string }).id;
    const quoteId = (quoted.data as { id: string }).id;
    const room = rt.rfqs.get(rfqId) as Rfq;
    rt.rfqs.set(rfqId, { ...room, expiresAt: rt.clock.now() });
    expect((rt.inspect(rfqId)?.value as { status: string }).status).toBe("expired");
    expect((rt.inspect(quoteId)?.value as { status: string }).status).toBe("live");
    expect("status" in (rt.quotes.get(quoteId) ?? {})).toBe(false);
  });

  it("does not label a quote held when the pause is already dead", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt, 700_000);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const ticket = offered.attempt.value.ticket as ApprovalTicket;
    rt.approvals.set(ticket.id, { ...ticket, expiresAt: rt.clock.now() });
    expect(rt.reservedQuotes.has(offered.quoteId)).toBe(true);
    expect((rt.inspect(offered.quoteId)?.value as { status: string }).status).toBe("live");
    expect((rt.inspect(ticket.id)?.value as ApprovalTicket).status).toBe("expired");
    expect("status" in (rt.quotes.get(offered.quoteId) ?? {})).toBe(false);
  });

  it("labels an FX quote expired when validUntil lapses inside the quote envelope", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "mm",
          displayName: "Market Maker",
          role: "market_maker",
          autonomyLevel: 2,
        }),
      ),
      "mm",
    );
    const mm = rt.alias("mm");
    const rfq = must(
      rt.dispatch(
        cmd("market.rfq", desk.id, {
          sku: "fx.usd_sim.usdc_sim",
          spec: "window",
          invitedSellerIds: [mm.id],
        }),
      ),
      "fx rfq",
    );
    const quoted = must(
      rt.dispatch(
        cmd("market.quote", mm.id, {
          rfqId: (rfq.data as { id: string }).id,
          price: { amount: 80_000, currency: "USD_SIM" },
          fx: {
            from: "USD_SIM",
            to: "USDC_SIM",
            rateE6: 998_000,
            validUntil: "2026-08-28T00:30:00.000Z",
          },
        }),
      ),
      "fx quote",
    );
    const quoteId = (quoted.data as { id: string }).id;
    expect((rt.inspect(quoteId)?.value as { status: string }).status).toBe("live");
    rt.clock.set("2026-08-28T00:45:00.000Z");
    expect((rt.inspect(quoteId)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().quotes.find((q) => q.id === quoteId)?.status).toBe("expired");
    expect("status" in (rt.quotes.get(quoteId) ?? {})).toBe(false);
  });
});

describe("cart inspect", () => {
  it("labels a live cart live and does not write status into the store", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId });
    expect((rt.inspect(cartId)?.value as { status: string }).status).toBe("live");
    expect(rt.snapshotState().carts.find((c) => c.payload.id === cartId)?.status).toBe("live");
    expect("status" in (rt.carts.get(cartId as MandateId) ?? {})).toBe(false);
  });

  it("labels a paid cart bound, not live", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId });
    must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId })), "payment");
    expect((rt.inspect(cartId)?.value as { status: string }).status).toBe("bound");
    expect(rt.snapshotState().carts.find((c) => c.payload.id === cartId)?.status).toBe("bound");
    expect("status" in (rt.carts.get(cartId as MandateId) ?? {})).toBe(false);
    const again = rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId }));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.decision?.remediation?.ruleId).toBe("mandate.unique_payment");
  });

  it("labels a hire-attached cart live until a payment occupies it", () => {
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
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId, hireId });
    expect(rt.hires.get(hireId)?.cartId).toBe(cartId);
    expect((rt.inspect(cartId)?.value as { status: string }).status).toBe("live");
  });

  it("labels a stale unpaid cart expired, not live", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId });
    rt.clock.set("2026-08-29T12:00:00.000Z");
    expect((rt.inspect(cartId)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().carts.find((c) => c.payload.id === cartId)?.status).toBe("expired");
    expect("status" in (rt.carts.get(cartId as MandateId) ?? {})).toBe(false);
  });

  it("labels a bound cart bound even after the window has closed", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId });
    must(rt.dispatch(cmd("mandate.issue_payment", desk.id, { cartId })), "payment");
    rt.clock.set("2026-08-29T12:00:00.000Z");
    expect((rt.inspect(cartId)?.value as { status: string }).status).toBe("bound");
    expect("status" in (rt.carts.get(cartId as MandateId) ?? {})).toBe(false);
  });
});

function issuePayment(rt: Runtime, cartId: string, buyer: string) {
  const payment = must(rt.dispatch(cmd("mandate.issue_payment", buyer, { cartId })), "payment");
  return (payment.data as { payload: { id: string } }).payload.id;
}

describe("payment inspect", () => {
  it("labels a live payment live and does not write status into the store", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId });
    const paymentId = issuePayment(rt, cartId, desk.id);
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("live");
    expect(rt.snapshotState().payments.find((p) => p.payload.id === paymentId)?.status).toBe("live");
    expect("status" in (rt.payments.get(paymentId as MandateId) ?? {})).toBe(false);
  });

  it("labels a funded payment funded, not live", () => {
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
    const { paymentId } = fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("funded");
    expect(rt.snapshotState().payments.find((p) => p.payload.id === paymentId)?.status).toBe("funded");
    expect("status" in (rt.payments.get(paymentId as MandateId) ?? {})).toBe(false);
    expect((rt.inspect(rt.hires.get(hireId)?.cartId ?? "")?.value as { status: string }).status).toBe("bound");
  });

  it("labels an accepted-but-unfunded payment live until escrow moves", () => {
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
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId, hireId });
    const paymentId = issuePayment(rt, cartId, desk.id);
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("live");
    expect((rt.inspect(cartId)?.value as { status: string }).status).toBe("bound");
  });

  it("labels a stale unpaid payment expired, not live", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId });
    const paymentId = issuePayment(rt, cartId, desk.id);
    rt.clock.set("2026-08-29T12:00:00.000Z");
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().payments.find((p) => p.payload.id === paymentId)?.status).toBe("expired");
    expect("status" in (rt.payments.get(paymentId as MandateId) ?? {})).toBe(false);
  });

  it("labels a payment expired when the parent cart dies while the payment exp still lives", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId });
    const cart = rt.carts.get(cartId as MandateId) as Signed<CartMandate>;
    const cartExp = Date.parse(cart.payload.expiresAt);
    rt.clock.set(new Date(cartExp - HOUR_MS).toISOString());
    const paymentId = issuePayment(rt, cartId, desk.id);
    const payment = rt.payments.get(paymentId as MandateId);
    const afterCart = new Date(cartExp + 1000).toISOString();
    expect(payment?.payload.exp).toBeGreaterThan(Math.floor(Date.parse(afterCart) / 1000));
    rt.clock.set(afterCart);
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().payments.find((p) => p.payload.id === paymentId)?.status).toBe("expired");
    expect((rt.inspect(cartId)?.value as { status: string }).status).toBe("bound");
    expect("status" in (rt.payments.get(paymentId as MandateId) ?? {})).toBe(false);
  });

  it("labels a funded payment funded even after the window has closed", () => {
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
    const { paymentId } = fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    rt.clock.set("2026-08-29T12:00:00.000Z");
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("funded");
    expect("status" in (rt.payments.get(paymentId as MandateId) ?? {})).toBe(false);
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
  });

  it("labels a refunded payment funded — the mandate was drawn", () => {
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
    const { paymentId } = fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    must(rt.dispatch(cmd("hire.refund", desk.id, { hireId })), "refund");
    expect(rt.hires.get(hireId)?.state).toBe("refunded");
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("funded");
  });

  it("still names mandate.chain_integrity when funding a stale unpaid payment", () => {
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
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId, hireId });
    const paymentId = issuePayment(rt, cartId, desk.id);
    rt.clock.set("2026-08-29T12:00:00.000Z");
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("expired");
    const r = rt.dispatch(cmd("hire.fund", desk.id, { hireId, paymentMandateId: paymentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.chain_integrity");
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
  });

  it("still names mandate.chain_integrity when funding after the parent cart dies and the payment exp still lives", () => {
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
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId, hireId });
    const cart = rt.carts.get(cartId as MandateId) as Signed<CartMandate>;
    const cartExp = Date.parse(cart.payload.expiresAt);
    rt.clock.set(new Date(cartExp - HOUR_MS).toISOString());
    const paymentId = issuePayment(rt, cartId, desk.id);
    const afterCart = new Date(cartExp + 1000).toISOString();
    expect(rt.payments.get(paymentId as MandateId)?.payload.exp).toBeGreaterThan(Math.floor(Date.parse(afterCart) / 1000));
    rt.clock.set(afterCart);
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("expired");
    const r = rt.dispatch(cmd("hire.fund", desk.id, { hireId, paymentMandateId: paymentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.chain_integrity");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("deny");
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
  });

  it("labels a funded payment funded even after the parent cart dies while the payment exp still lives", () => {
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
    const cartId = issueCart(rt, { buyer: desk.id, seller: vendor.id, intentId, hireId });
    const cart = rt.carts.get(cartId as MandateId) as Signed<CartMandate>;
    const cartExp = Date.parse(cart.payload.expiresAt);
    rt.clock.set(new Date(cartExp - HOUR_MS).toISOString());
    const paymentId = issuePayment(rt, cartId, desk.id);
    must(rt.dispatch(cmd("hire.fund", desk.id, { hireId })), "fund");
    const afterCart = new Date(cartExp + 1000).toISOString();
    expect(rt.payments.get(paymentId as MandateId)?.payload.exp).toBeGreaterThan(Math.floor(Date.parse(afterCart) / 1000));
    rt.clock.set(afterCart);
    expect((rt.inspect(paymentId)?.value as { status: string }).status).toBe("funded");
    expect((rt.inspect(cartId)?.value as { status: string }).status).toBe("bound");
    expect("status" in (rt.payments.get(paymentId as MandateId) ?? {})).toBe(false);
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
  });
});

const INTENT_DEAD = "2026-09-05T00:00:00.000Z";

describe("intent inspect", () => {
  it("labels a live intent live and does not write status into the store", () => {
    const rt = boot();
    const { intentId } = economy(rt);
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("live");
    expect(rt.snapshotState().intents.find((s) => s.payload.id === intentId)?.status).toBe("live");
    expect("status" in (rt.intents.get(intentId) ?? {})).toBe(false);
  });

  it("labels a funded intent funded, not live", () => {
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
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("funded");
    expect(rt.snapshotState().intents.find((s) => s.payload.id === intentId)?.status).toBe("funded");
    expect("status" in (rt.intents.get(intentId) ?? {})).toBe(false);
  });

  it("labels an accepted-but-unfunded intent live until escrow moves", () => {
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
    expect(rt.hires.get(hireId)?.state).toBe("accepted");
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("live");
  });

  it("labels a stale unused intent expired, not live", () => {
    const rt = boot();
    const { intentId } = economy(rt);
    rt.clock.set(INTENT_DEAD);
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().intents.find((s) => s.payload.id === intentId)?.status).toBe("expired");
    expect("status" in (rt.intents.get(intentId) ?? {})).toBe(false);
  });

  it("labels a funded intent funded even after the window has closed", () => {
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
    rt.clock.set(INTENT_DEAD);
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("funded");
    expect("status" in (rt.intents.get(intentId) ?? {})).toBe(false);
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
  });

  it("labels a refunded intent funded — the slip was drawn", () => {
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
    must(rt.dispatch(cmd("hire.refund", desk.id, { hireId })), "refund");
    expect(rt.hires.get(hireId)?.state).toBe("refunded");
    expect(rt.spentByIntent.get(intentId)).toBe(0);
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("funded");
  });

  it("still names mandate.not_expired when hiring against a stale unused intent", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    rt.clock.set(INTENT_DEAD);
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("expired");
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(false);
    if (offered.attempt.ok) return;
    expect(offered.attempt.error.decision?.remediation?.ruleId).toBe("mandate.not_expired");
  });

  it("labels a child intent expired when the parent dies while the child exp still lives", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    rt.clock.set("2026-09-03T00:00:00.000Z");
    const child = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          parentId: intentId,
          task: "hand down before the parent dies",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
            { type: "payment.budget", currency: "USD_SIM", max: 100_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "child",
    );
    const childId = (child.data as { payload: { id: MandateId } }).payload.id;
    const childExp = (child.data as { payload: { exp: number } }).payload.exp;
    rt.clock.set(INTENT_DEAD);
    expect(childExp).toBeGreaterThan(Math.floor(Date.parse(INTENT_DEAD) / 1000));
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("expired");
    expect((rt.inspect(childId)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().intents.find((s) => s.payload.id === childId)?.status).toBe("expired");
    expect("status" in (rt.intents.get(childId) ?? {})).toBe(false);
  });

  it("still names mandate.parent_fresh when hiring against a child after the parent dies and the child exp still lives", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    rt.clock.set("2026-09-03T00:00:00.000Z");
    const child = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          parentId: intentId,
          task: "hand down before the parent dies",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
            { type: "payment.budget", currency: "USD_SIM", max: 100_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "child",
    );
    const childId = (child.data as { payload: { id: MandateId; exp: number } }).payload.id;
    const childExp = (child.data as { payload: { exp: number } }).payload.exp;
    rt.clock.set(INTENT_DEAD);
    expect(childExp).toBeGreaterThan(Math.floor(Date.parse(INTENT_DEAD) / 1000));
    expect((rt.inspect(childId)?.value as { status: string }).status).toBe("expired");
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
    expect(late.attempt.error.decision?.remediation?.ruleId).toBe("mandate.parent_fresh");
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "mandate.not_expired")?.verdict).toBe("allow");
  });

  it("labels a funded child funded even after the parent dies while the child exp still lives", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    rt.clock.set("2026-09-03T00:00:00.000Z");
    const child = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          parentId: intentId,
          task: "hand down before the parent dies",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 80_000 },
            { type: "payment.budget", currency: "USD_SIM", max: 80_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "child",
    );
    const childId = (child.data as { payload: { id: MandateId; exp: number } }).payload.id;
    const childExp = (child.data as { payload: { exp: number } }).payload.exp;
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId: childId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId: childId,
      qty: 1,
      unitAmount: 80_000,
    });
    rt.clock.set(INTENT_DEAD);
    expect(childExp).toBeGreaterThan(Math.floor(Date.parse(INTENT_DEAD) / 1000));
    expect((rt.inspect(childId)?.value as { status: string }).status).toBe("funded");
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("expired");
    expect("status" in (rt.intents.get(childId) ?? {})).toBe(false);
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
  });

  it("does not let a funded child occupy the parent slip", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    const child = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          parentId: intentId,
          task: "buy one brief",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 80_000 },
            { type: "payment.budget", currency: "USD_SIM", max: 80_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "child",
    );
    const childId = (child.data as { payload: { id: MandateId } }).payload.id;
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId: childId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId: childId,
      qty: 1,
      unitAmount: 80_000,
    });
    rt.clock.set(INTENT_DEAD);
    expect((rt.inspect(childId)?.value as { status: string }).status).toBe("funded");
    expect((rt.inspect(intentId)?.value as { status: string }).status).toBe("expired");
  });
});

describe("hire inspect", () => {
  it("labels an offered hire live and does not write status into the store", () => {
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
    expect((rt.inspect(hireId)?.value as { status: string }).status).toBe("live");
    expect(rt.snapshotState().hires.find((h) => h.id === hireId)?.status).toBe("live");
    expect("status" in (rt.hires.get(hireId) ?? {})).toBe(false);
  });

  it("labels an offered hire expired when the slip dies, and accept still names mandate.not_expired", () => {
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
    rt.clock.set(INTENT_DEAD);
    expect((rt.inspect(hireId)?.value as { status: string; state: string }).status).toBe("expired");
    expect((rt.inspect(hireId)?.value as { state: string }).state).toBe("offered");
    expect(rt.snapshotState().hires.find((h) => h.id === hireId)?.status).toBe("expired");
    expect("status" in (rt.hires.get(hireId) ?? {})).toBe(false);
    const accepted = rt.dispatch(cmd("hire.accept", vendor.id, { hireId }));
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.error.decision?.remediation?.ruleId).toBe("mandate.not_expired");
  });

  it("labels a funded hire funded after the slip dies, and completing is legal", () => {
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
    rt.clock.set(INTENT_DEAD);
    expect((rt.inspect(hireId)?.value as { status: string; state: string }).status).toBe("funded");
    expect((rt.inspect(hireId)?.value as { state: string }).state).toBe("funded");
    expect("status" in (rt.hires.get(hireId) ?? {})).toBe(false);
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
    expect((rt.inspect(hireId)?.value as { status: string; state: string }).status).toBe("funded");
    expect((rt.inspect(hireId)?.value as { state: string }).state).toBe("delivered");
  });

  it("labels an offered child hire expired when the parent dies while the child exp still lives", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    rt.clock.set("2026-09-03T00:00:00.000Z");
    const child = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          parentId: intentId,
          task: "hand down before the parent dies",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 100_000 },
            { type: "payment.budget", currency: "USD_SIM", max: 100_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "child",
    );
    const childId = (child.data as { payload: { id: string; exp: number } }).payload.id;
    const childExp = (child.data as { payload: { exp: number } }).payload.exp;
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId: childId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    rt.clock.set(INTENT_DEAD);
    expect(childExp).toBeGreaterThan(Math.floor(Date.parse(INTENT_DEAD) / 1000));
    expect((rt.inspect(childId)?.value as { status: string }).status).toBe("expired");
    expect((rt.inspect(hireId)?.value as { status: string }).status).toBe("expired");
    expect("status" in (rt.hires.get(hireId) ?? {})).toBe(false);
    const accepted = rt.dispatch(cmd("hire.accept", vendor.id, { hireId }));
    expect(accepted.ok).toBe(false);
    if (accepted.ok) return;
    expect(accepted.error.decision?.remediation?.ruleId).toBe("mandate.parent_fresh");
  });
});

describe("MCP command schemas", () => {
  it("lists real body fields so agents do not guess additionalProperties", () => {
    const mcp = new AetherMcp();
    const listed = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (listed as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } })
      .result.tools;
    const hire = tools.find((t) => t.name === "aether_hire_create");
    expect(hire?.inputSchema.properties.quoteId).toBeTruthy();
    expect(hire?.inputSchema.properties.intentId).toBeTruthy();
    expect(hire?.inputSchema.properties.actor).toBeTruthy();
    expect(tools.some((t) => t.name === "aether_get")).toBe(true);

    mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    });
    const got = mcp.callTool("aether_get", { id: "ops-human" }) as { type: string; value: { displayName: string } };
    expect(got.type).toBe("agent");
    expect(got.value.displayName).toBe("Founder");

    const cmds = mcp.handle({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "aether://commands" } });
    const text = (cmds as { result: { contents: { text: string }[] } }).result.contents[0]?.text ?? "";
    expect(text).toContain("hire.create");

    const card = mcp.handle({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "aether://agent-card" } });
    const cardText = (card as { result: { contents: { text: string }[] } }).result.contents[0]?.text ?? "";
    const parsed = JSON.parse(cardText) as { spec: string; protocolVersion: string; capabilities: { liveMoney: boolean } };
    expect(parsed.spec).toBe("aether.protocol.1");
    expect(parsed.protocolVersion).toBe("0.96.0");
    expect(parsed.capabilities.liveMoney).toBe(false);
  });
});

const GHOST_RECEIPT = "rid_01J6AETHERGHOSTRECEIPT00001";

describe("receipt.known", () => {
  it("refuses a missing receipt as receipt.known, not an empty success", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("receipt.get", founder.id, { receiptId: GHOST_RECEIPT }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "receipt.known")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("receipt.known");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.inspect(GHOST_RECEIPT)).toBeUndefined();
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("still fetches a live receipt", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    completeHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
      qty: 1,
      deliverable: { n: 1 },
    });
    const live = [...rt.receipts.values()][0];
    expect(live).toBeTruthy();
    if (!live) return;
    const r = must(rt.dispatch(cmd("receipt.get", founder.id, { receiptId: live.id })), "receipt.get");
    expect((r.data as Receipt).id).toBe(live.id);
    expect((r.data as Receipt).reference).toBe(live.reference);
  });
});
