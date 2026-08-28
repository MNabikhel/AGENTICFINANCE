import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";

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
  must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
      }),
    ),
    "intent",
  );
  return { desk, vendor };
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
