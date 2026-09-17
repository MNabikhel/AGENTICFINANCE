import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { FILM_TLDR, Runtime, cmd } from "@aether/runtime";
import { loadSettleState, runSettleState } from "@aether/settle-state";

function boot() {
  const rt = new Runtime({
    startIso: "2026-08-30T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESIS0000000998",
    dailyLimit: 10_000_000,
  });
  const founderR = rt.dispatch(
    cmd("identity.register", "system", {
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    }),
  );
  if (!founderR.ok) throw new Error("founder");
  const founder = rt.alias("ops-human");
  const tR = rt.dispatch(
    cmd("identity.register", founder.id, {
      key: "treasury",
      displayName: "Treasury",
      role: "treasury",
      autonomyLevel: 3,
    }),
  );
  if (!tR.ok) throw new Error("treasury");
  return { rt, treasury: rt.alias("treasury") };
}

describe("settle-state demo", () => {
  it("passes TAP assertions that an empty book is not a settlement photo", () => {
    const report = runSettleState(loadSettleState(resolve("fixtures/demo/film/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(FILM_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect(report.runtime.clearing.windows).toHaveLength(1);
    expect(report.runtime.clearing.openLegs("USD_SIM")).toBe(0);
    expect(report.runtime.clearing.openLegs("USDC_SIM")).toBe(0);
  });
});

describe("clearing.settle_state", () => {
  it("refuses to settle an empty book as clearing.settle_state, not a photo of nothing", () => {
    const { rt, treasury } = boot();
    const windowsBefore = rt.clearing.windows.length;
    const linesBefore = rt.audit.all().filter((r) => r.action === "CLEARING_WINDOW").length;
    const r = rt.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USD_SIM" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "clearing.settle_state")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "clearing.bilateral_limit")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("clearing.settle_state");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.clearing.windows.length).toBe(windowsBefore);
    expect(rt.audit.all().filter((rec) => rec.action === "CLEARING_WINDOW").length).toBe(linesBefore);
  });

  it("still settles a book with open legs, then refuses the second photo", () => {
    const { rt, treasury } = boot();
    rt.clearing.record("aid_buyer00000000000000000001", "aid_seller0000000000000000001", 80_000, "USD_SIM");
    const first = rt.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USD_SIM" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((first.value.data as { legsConsumed: number }).legsConsumed).toBe(1);
    expect(rt.clearing.windows).toHaveLength(1);
    const second = rt.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USD_SIM" }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.decision?.remediation?.ruleId).toBe("clearing.settle_state");
    expect(rt.clearing.windows).toHaveLength(1);
  });

  it("the other currency's legs are a different book", () => {
    const { rt, treasury } = boot();
    rt.clearing.record("aid_buyer00000000000000000001", "aid_seller0000000000000000001", 80_000, "USD_SIM");
    const r = rt.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USDC_SIM" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("clearing.settle_state");
    expect(rt.clearing.openLegs("USD_SIM")).toBe(1);
  });
});
