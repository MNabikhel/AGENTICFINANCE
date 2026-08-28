import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { fundHire, offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { HireContract, MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISWIN000000001",
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
        task: "buy research this week",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
          {
            type: "payment.execution_date",
            not_before: "2026-08-28T00:00:00.000Z",
            not_after: "2026-08-28T12:00:00.000Z",
          },
        ],
      }),
    ),
    "intent",
  );
  return { founder, desk, vendor, intentId: (intent.data as { payload: { id: MandateId } }).payload.id };
}

describe("execution window", () => {
  it("lets a funded hire finish after not_after, and refuses a new hire", () => {
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
    rt.clock.set("2026-08-29T00:00:00.000Z");
    const delivered = rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } }));
    expect(delivered.ok).toBe(true);
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
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "payment.execution_date")?.verdict).toBe(
      "deny",
    );
  });

  it("refuses a slip born with a closed calendar as mandate.window_fresh, not a written corpse", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const before = rt.intents.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research last year",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
          { type: "payment.execution_date", not_after: "2020-01-01T00:00:00.000Z" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "payment.execution_date")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.window_fresh");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.intents.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("cannot mint a closed calendar"))).toBe(true);
  });

  it("refuses an unparseable not_after as mandate.window_fresh", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy with garbage calendar",
        constraints: [{ type: "payment.execution_date", not_after: "not-an-instant" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.window_fresh");
    expect(rt.intents.size).toBe(before);
  });

  it("refuses an inverted window as mandate.window_fresh", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy inside an empty interval",
        constraints: [
          {
            type: "payment.execution_date",
            not_before: "2026-09-10T00:00:00.000Z",
            not_after: "2026-09-01T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.window_fresh");
    expect(rt.intents.size).toBe(before);
  });

  it("still writes a future not_before; hire still names payment.execution_date", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const r = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy research next week",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
            {
              type: "payment.execution_date",
              not_before: "2026-09-01T00:00:00.000Z",
              not_after: "2026-09-07T00:00:00.000Z",
            },
          ],
        }),
      ),
      "future slip",
    );
    expect(r.decision.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "payment.execution_date")?.verdict).toBe("allow");
    const intentId = (r.data as { payload: { id: MandateId } }).payload.id;
    const late = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "too soon",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(late.attempt.ok).toBe(false);
    if (late.attempt.ok) return;
    expect(late.attempt.error.decision?.trace.find((t) => t.ruleId === "payment.execution_date")?.verdict).toBe(
      "deny",
    );
    expect(late.attempt.error.decision?.remediation?.ruleId).toBe("payment.execution_date");
  });

  it("still names identity.known first when the subject is missing", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: "aid_01J6AETHERGHOSTWIN00000001",
        task: "buy for nobody last year",
        constraints: [{ type: "payment.execution_date", not_after: "2020-01-01T00:00:00.000Z" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
    expect(rt.intents.size).toBe(before);
  });

  it("still names mandate.known_parent first when the parent is missing", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        parentId: "mid_01J6AETHERGHOSTWIN00000001",
        task: "child of nobody last year",
        constraints: [{ type: "payment.execution_date", not_after: "2020-01-01T00:00:00.000Z" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.window_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_parent");
    expect(rt.intents.size).toBe(before);
  });
});
