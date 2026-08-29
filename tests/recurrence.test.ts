import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { completeHire, offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { MandateConstraint, MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISREC000000001",
    dailyLimit: 10_000_000,
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

function economy(rt: Runtime, constraints: MandateConstraint[]) {
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
  rt.seedOpening({ "procurement:cash": { amount: 2_000_000, currency: "USD_SIM" } });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research on a cadence",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
          ...constraints,
        ],
      }),
    ),
    "intent",
  );
  return { founder, desk, vendor, intentId: (intent.data as { payload: { id: MandateId } }).payload.id };
}

const brief = {
  sku: "research.brief",
  spec: "one pager",
  price: { amount: 80_000, currency: "USD_SIM" as const },
};

describe("recurrence", () => {
  it("lets the first hire finish when max_occurrences is 1, then refuses a second create", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt, [
      { type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 1 },
    ]);
    completeHire(rt, { ...brief, buyer: desk.id, seller: vendor.id, intentId, qty: 1, deliverable: { n: 1 } });
    const second = offerHire(rt, { ...brief, buyer: desk.id, seller: vendor.id, intentId });
    expect(second.attempt.ok).toBe(false);
    if (second.attempt.ok) return;
    expect(second.attempt.error.decision?.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("deny");
  });

  it("refuses a DAILY hire until 24h after the last fund", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt, [
      { type: "payment.agent_recurrence", frequency: "DAILY", max_occurrences: 8 },
    ]);
    completeHire(rt, { ...brief, buyer: desk.id, seller: vendor.id, intentId, qty: 1, deliverable: { n: 1 } });
    rt.clock.set("2026-08-28T01:00:00.000Z");
    const early = offerHire(rt, { ...brief, buyer: desk.id, seller: vendor.id, intentId });
    expect(early.attempt.ok).toBe(false);
    if (early.attempt.ok) return;
    expect(early.attempt.error.decision?.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("deny");
    rt.clock.set("2026-08-29T12:00:00.000Z");
    const later = offerHire(rt, { ...brief, buyer: desk.id, seller: vendor.id, intentId });
    expect(later.attempt.ok).toBe(true);
  });

  it("refuses a slip born with no slots as mandate.occurrence_fresh, not a written corpse", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt, []);
    const before = rt.intents.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research zero times",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
          { type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.occurrence_fresh");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.intents.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("cannot mint a cadence with no slots"))).toBe(true);
  });

  it("refuses a negative max_occurrences as mandate.occurrence_fresh", () => {
    const rt = boot();
    const { founder, desk } = economy(rt, []);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research negative times",
        constraints: [{ type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: -1 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.occurrence_fresh");
    expect(rt.intents.size).toBe(before);
  });

  it("still writes a one-slot cadence", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt, []);
    const before = rt.intents.size;
    const r = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy research once",
          constraints: [
            { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
            {
              type: "payment.allowed_payees",
              allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
            },
            { type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 1 },
          ],
        }),
      ),
      "one-slot slip",
    );
    expect(r.decision.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("allow");
    expect(rt.intents.size).toBe(before + 1);
  });

  it("still writes an unlimited cadence when max_occurrences is omitted", () => {
    const rt = boot();
    const { founder, desk } = economy(rt, []);
    const before = rt.intents.size;
    const r = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy research on demand",
          constraints: [{ type: "payment.agent_recurrence", frequency: "ON_DEMAND" }],
        }),
      ),
      "unlimited slip",
    );
    expect(r.decision.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(rt.intents.size).toBe(before + 1);
  });

  it("refuses WEEKLY max 8 as mandate.cadence_reach, not a written corpse", () => {
    const rt = boot();
    const { founder, desk } = economy(rt, []);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research every week",
        constraints: [{ type: "payment.agent_recurrence", frequency: "WEEKLY", max_occurrences: 8 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.cadence_reach")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "payment.recurrence")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.cadence_reach");
    expect(rt.intents.size).toBe(before);
  });

  it("still writes a one-shot WEEKLY", () => {
    const rt = boot();
    const { founder, desk } = economy(rt, []);
    const before = rt.intents.size;
    const r = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "buy research once this week",
          constraints: [{ type: "payment.agent_recurrence", frequency: "WEEKLY", max_occurrences: 1 }],
        }),
      ),
      "one-shot weekly",
    );
    expect(r.decision.trace.find((t) => t.ruleId === "mandate.cadence_reach")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("allow");
    expect(rt.intents.size).toBe(before + 1);
  });

  it("still names identity.known first when the subject is missing", () => {
    const rt = boot();
    const { founder } = economy(rt, []);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: "aid_01J6AETHERGHOSTREC00000001",
        task: "buy for nobody zero times",
        constraints: [{ type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 0 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
    expect(rt.intents.size).toBe(before);
  });

  it("still names mandate.known_parent first when the parent is missing", () => {
    const rt = boot();
    const { founder, desk } = economy(rt, []);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        parentId: "mid_01J6AETHERGHOSTREC00000001",
        task: "child of nobody zero times",
        constraints: [{ type: "payment.agent_recurrence", frequency: "ON_DEMAND", max_occurrences: 0 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.occurrence_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_parent");
    expect(rt.intents.size).toBe(before);
  });
});
