import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISAPPR0000001",
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
    { key: "treasury", displayName: "Treasury", role: "treasury", autonomyLevel: 3 },
    { key: "procurement", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  rt.seedOpening({ "procurement:cash": { amount: 2_000_000, currency: "USD_SIM" } });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 700_000 },
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
    desk,
    vendor,
    treasury: rt.alias("treasury"),
    intentId: (intent.data as { payload: { id: MandateId } }).payload.id,
  };
}

function pauseHire(rt: Runtime) {
  const { desk, vendor, treasury, intentId } = economy(rt);
  const offered = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.deep",
    spec: "needs a grown-up",
    price: { amount: 640_000, currency: "USD_SIM" },
    intentId,
  });
  if (!offered.attempt.ok || offered.attempt.value.kind !== "escalated" || !offered.attempt.value.ticket) {
    throw new Error("expected escalate");
  }
  return { desk, vendor, treasury, intentId, quoteId: offered.quoteId, ticket: offered.attempt.value.ticket };
}

describe("known approval", () => {
  it("refuses a missing ticket as approval.known, not a mutate throw", () => {
    const rt = boot();
    const { treasury } = economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const r = rt.dispatch(
      cmd("approval.resolve", treasury.id, {
        approvalId: "apd_01J6AETHERGHOSTAPPR0000001",
        decision: "approved",
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.known")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("approval.known");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(auditBefore);
  });
});

describe("pending approval", () => {
  it("refuses an expired ticket as approval.pending, not a late yes", () => {
    const rt = boot();
    const { treasury, ticket } = pauseHire(rt);
    rt.approvals.set(ticket.id, { ...ticket, expiresAt: rt.clock.now() });
    const r = rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.replay")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("approval.pending");
    expect(rt.approvals.get(ticket.id)?.status).toBe("expired");
  });

  it("refuses a rejected ticket as approval.pending", () => {
    const rt = boot();
    const { treasury, ticket } = pauseHire(rt);
    must(rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "rejected" })), "reject");
    const again = rt.dispatch(
      cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" }),
    );
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.decision?.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("deny");
    expect(rt.approvals.get(ticket.id)?.status).toBe("rejected");
  });

  it("refuses an already-approved ticket as approval.pending", () => {
    const rt = boot();
    const { treasury, ticket } = pauseHire(rt);
    must(rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" })), "approve");
    const again = rt.dispatch(
      cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" }),
    );
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.decision?.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("deny");
    expect(rt.approvals.get(ticket.id)?.status).toBe("approved");
  });
});

describe("approval replay", () => {
  it("refuses to approve after the paused quote has gone stale, not a mutate throw after yes", () => {
    const rt = boot();
    const { treasury, ticket, quoteId } = pauseHire(rt);
    rt.clock.set("2026-08-28T02:00:00.000Z");
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.replay")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("approval.replay");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.approvals.get(ticket.id)?.status).toBe("pending");
    expect(rt.reservedQuotes.get(quoteId)).toBe(ticket.id);
    expect(rt.consumedQuotes.has(quoteId)).toBe(false);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("still lets a grown-up reject a ticket whose paused command is stale", () => {
    const rt = boot();
    const { treasury, ticket, quoteId } = pauseHire(rt);
    rt.clock.set("2026-08-28T02:00:00.000Z");
    const rejected = must(
      rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "rejected" })),
      "reject stale",
    );
    expect((rejected.data as { status: string }).status).toBe("rejected");
    expect(rt.approvals.get(ticket.id)?.status).toBe("rejected");
    expect(rt.reservedQuotes.has(quoteId)).toBe(false);
  });

  it("refuses to approve when the held command is gone, not a missing-pending throw after yes", () => {
    const rt = boot();
    const { treasury, ticket, quoteId } = pauseHire(rt);
    rt.pending.delete(ticket.id);
    const r = rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.replay")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("approval.replay");
    expect(rt.approvals.get(ticket.id)?.status).toBe("pending");
    expect(rt.reservedQuotes.get(quoteId)).toBe(ticket.id);
  });
});

describe("ladder.min_level ticket", () => {
  it("lets a grown-up yes complete an L1 hire.create, not a stuck escalate", () => {
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
      { key: "treasury", displayName: "Treasury", role: "treasury", autonomyLevel: 3 },
      { key: "clerk", displayName: "Clerk", role: "procurement", autonomyLevel: 1 },
      { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
    ] as const) {
      must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
    }
    const clerk = rt.alias("clerk");
    const vendor = rt.alias("vendor");
    const treasury = rt.alias("treasury");
    const intent = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: clerk.id,
          task: "buy research",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 200_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
          ],
        }),
      ),
      "intent",
    );
    const intentId = (intent.data as { payload: { id: MandateId } }).payload.id;
    const offered = offerHire(rt, {
      buyer: clerk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "L1 needs a grown-up",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    expect(offered.attempt.value.kind).toBe("escalated");
    expect(offered.attempt.value.decision.trace.find((t) => t.ruleId === "ladder.min_level")?.verdict).toBe(
      "escalate",
    );
    expect(offered.attempt.value.decision.trace.find((t) => t.ruleId === "approval.threshold")?.verdict).toBe(
      "allow",
    );
    expect(offered.attempt.value.decision.remediation?.ruleId).toBe("ladder.min_level");
    const ticket = offered.attempt.value.ticket;
    expect(ticket).toBeTruthy();
    if (!ticket) return;
    const hiresBefore = rt.hires.size;
    const resolved = must(
      rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" })),
      "approve L1 hire",
    );
    expect((resolved.data as { hire: { state: string } }).hire.state).toBe("offered");
    expect(rt.hires.size).toBe(hiresBefore + 1);
    expect(rt.approvals.get(ticket.id)?.status).toBe("approved");
    expect(rt.consumedQuotes.has(offered.quoteId)).toBe(true);
  });
});
