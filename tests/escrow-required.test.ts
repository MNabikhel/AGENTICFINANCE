import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { BARE_TLDR } from "@aether/runtime";
import { loadEscrowRequired, runEscrowRequired } from "@aether/escrow-required";

describe("escrow-required demo", () => {
  it("passes TAP assertions that unfunded work is not a delivery", () => {
    const report = runEscrowRequired(loadEscrowRequired(resolve("fixtures/demo/bare/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(BARE_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "accepted")).toBe(true);
  });
});
