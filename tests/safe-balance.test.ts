import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { BRIM_TLDR } from "@aether/runtime";
import { loadSafeBalance, runSafeBalance } from "@aether/safe-balance";

describe("safe-balance demo", () => {
  it("passes TAP assertions that IEEE rounding is not a mint", () => {
    const report = runSafeBalance(loadSafeBalance(resolve("fixtures/demo/brim/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(BRIM_TLDR);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect(report.runtime.ledger.balanceByName("desk:cash").amount).toBe(Number.MAX_SAFE_INTEGER);
  });
});
