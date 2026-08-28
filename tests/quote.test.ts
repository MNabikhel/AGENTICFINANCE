import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { inviteQuote, offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { HireContract, MandateId } from "@aether/types";

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
});
