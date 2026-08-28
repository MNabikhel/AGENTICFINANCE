import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { inviteQuote, offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { Agent, HireContract, MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISQUOTE0000001",
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
    { key: "treasury", displayName: "Treasury", role: "treasury", autonomyLevel: 3 },
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
  return { founder, desk, treasury: rt.alias("treasury"), vendor, intentId: (intent.data as { payload: { id: MandateId } }).payload.id };
}

function overCapIntent(rt: Runtime, founder: Agent, desk: Agent, vendor: Agent, task: string): MandateId {
  const issued = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task,
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 700_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
        ],
      }),
    ),
    task,
  );
  return (issued.data as { payload: { id: MandateId } }).payload.id;
}

describe("hire quote is one-shot", () => {
  it("replays the same hire.create; a second key is quote_unspent", () => {
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
    const replay = must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: offered.quoteId, intentId })), "replay");
    expect(replay.replayed).toBe(true);
    expect((replay.data as HireContract).id).toBe(hireId);
    const second = rt.dispatch(cmd("hire.create", desk.id, { quoteId: offered.quoteId, intentId }, "hire-again"));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.error.status).toBe(422);
    expect(second.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("deny");
    expect(second.error.decision?.remediation?.kind).toBe("none");
    expect([...rt.hires.values()].filter((h) => h.quoteId === offered.quoteId)).toHaveLength(1);
  });

  it("refuses a second intent hiring the same quote", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
    });
    must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })), "first hire");
    const intent2 = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy the same brief again",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "intent2",
    );
    const sneak = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId: invited.quoteId,
        intentId: (intent2.data as { payload: { id: MandateId } }).payload.id,
      }),
    );
    expect(sneak.ok).toBe(false);
    if (sneak.ok) return;
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("deny");
  });

  it("does not consume a quote when hire.create is denied", () => {
    const rt = boot();
    const { founder, desk, vendor, intentId } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "too expensive",
      price: { amount: 640_000, currency: "USD_SIM" },
    });
    const denied = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.decision?.trace.find((t) => t.ruleId === "payment.amount_range")?.verdict).toBe("deny");
    const bigger = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy deep research",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 700_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "bigger slip",
    );
    const retry = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId: invited.quoteId,
        intentId: (bigger.data as { payload: { id: MandateId } }).payload.id,
      }),
    );
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.kind).toBe("escalated");
    expect(retry.value.decision.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
  });

  it("holds the quote while an approval ticket is open", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
    });
    const big = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy deep research",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 700_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "big slip",
    );
    const intentId = (big.data as { payload: { id: MandateId } }).payload.id;
    const paused = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.value.kind).toBe("escalated");
    const other = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "same quote other slip",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 700_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "other slip",
    );
    const sneak = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId: invited.quoteId,
        intentId: (other.data as { payload: { id: MandateId } }).payload.id,
      }),
    );
    expect(sneak.ok).toBe(false);
    if (sneak.ok) return;
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("deny");
    expect(sneak.error.decision?.remediation?.ruleId).toBe("hire.quote_unspent");
    expect(sneak.error.decision?.remediation?.hint).toMatch(/approval ticket/);
    expect(rt.reservedQuotes.get(invited.quoteId)).toBe(paused.value.ticket?.id);
  });

  it("releases the quote when the ticket is rejected", () => {
    const rt = boot();
    const { founder, desk, treasury, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
    });
    const big = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy deep research",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 700_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "big slip",
    );
    const intentId = (big.data as { payload: { id: MandateId } }).payload.id;
    const paused = must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })), "escalate");
    const ticketId = (paused.data as { ticket: { id: string } }).ticket.id;
    must(rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticketId, decision: "rejected" })), "reject");
    const again = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.kind).toBe("escalated");
    expect(again.value.decision.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
    expect(rt.reservedQuotes.get(invited.quoteId)).toBe(again.value.ticket?.id);
  });

  it("releases the quote when the ticket expires", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
    });
    const intentId = overCapIntent(rt, founder, desk, vendor, "buy deep research");
    const paused = must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })), "escalate");
    const ticketId = paused.ticket!.id;
    const live = rt.approvals.get(ticketId)!;
    rt.approvals.set(ticketId, { ...live, expiresAt: rt.clock.now() });
    must(rt.dispatch(cmd("market.catalog", desk.id, {})), "tick");
    expect(rt.approvals.get(ticketId)?.status).toBe("expired");
    expect(rt.reservedQuotes.has(invited.quoteId)).toBe(false);
    const again = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.kind).toBe("escalated");
    expect(again.value.decision.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
  });

  it("does not replay an expired hire.create escalate as a second day", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
    });
    const intentId = overCapIntent(rt, founder, desk, vendor, "buy deep research");
    const paused = must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })), "escalate");
    const ticketId = paused.ticket!.id;
    const liveRetry = must(
      rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })),
      "live replay",
    );
    expect(liveRetry.replayed).toBe(true);
    expect(liveRetry.ticket!.id).toBe(ticketId);
    const live = rt.approvals.get(ticketId)!;
    rt.approvals.set(ticketId, { ...live, expiresAt: rt.clock.now() });
    const again = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.replayed).not.toBe(true);
    expect(again.value.kind).toBe("escalated");
    expect(again.value.ticket!.id).not.toBe(ticketId);
    expect(rt.approvals.get(ticketId)?.status).toBe("expired");
    expect(rt.reservedQuotes.get(invited.quoteId)).toBe(again.value.ticket!.id);
    expect(again.value.decision.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("allow");
  });

  it("lets the waived approval consume the reserved quote", () => {
    const rt = boot();
    const { founder, desk, treasury, vendor } = economy(rt);
    const invited = inviteQuote(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
    });
    const intentId = overCapIntent(rt, founder, desk, vendor, "buy deep research");
    const paused = must(rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })), "escalate");
    const approved = must(
      rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: paused.ticket!.id, decision: "approved" })),
      "approve",
    );
    const hireId = (approved.data as { hire: HireContract }).hire.id;
    expect(hireId).toMatch(/^hid_/);
    expect(rt.reservedQuotes.has(invited.quoteId)).toBe(false);
    expect(rt.consumedQuotes.has(invited.quoteId)).toBe(true);
    const sneak = rt.dispatch(
      cmd("hire.create", desk.id, {
        quoteId: invited.quoteId,
        intentId: overCapIntent(rt, founder, desk, vendor, "same quote other slip"),
      }),
    );
    expect(sneak.ok).toBe(false);
    if (sneak.ok) return;
    expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("deny");
  });

  it("keeps a reserved quote reserved across durable reboot", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-quote-reserve-"));
    try {
      const a = new Runtime({
        startIso: "2026-08-28T00:00:00.000Z",
        genesisNonce: "01J6AETHERGENESISQUOTERES0001",
        dailyLimit: 10_000_000,
        dataDir: dir,
      });
      const { founder, desk, vendor } = economy(a);
      const invited = inviteQuote(a, {
        buyer: desk.id,
        seller: vendor.id,
        sku: "research.deep",
        spec: "needs a grown-up",
        price: { amount: 640_000, currency: "USD_SIM" },
      });
      const intentId = overCapIntent(a, founder, desk, vendor, "buy deep research");
      const paused = must(a.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId })), "escalate");
      expect(a.reservedQuotes.get(invited.quoteId)).toBe(paused.ticket?.id);

      const b = new Runtime({
        startIso: "2026-08-28T00:00:00.000Z",
        genesisNonce: "01J6AETHERGENESISQUOTERES0001",
        dailyLimit: 10_000_000,
        dataDir: dir,
      });
      expect(b.reservedQuotes.get(invited.quoteId)).toBe(paused.ticket?.id);
      const sneak = b.dispatch(
        cmd("hire.create", desk.id, {
          quoteId: invited.quoteId,
          intentId: overCapIntent(b, founder, desk, vendor, "same quote other slip"),
        }),
      );
      expect(sneak.ok).toBe(false);
      if (sneak.ok) return;
      expect(sneak.error.decision?.trace.find((t) => t.ruleId === "hire.quote_unspent")?.verdict).toBe("deny");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
