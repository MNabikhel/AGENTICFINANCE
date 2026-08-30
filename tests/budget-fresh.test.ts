import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { COFFER_TLDR } from "@aether/runtime";
import { loadBudgetFresh, runBudgetFresh } from "@aether/budget-fresh";

describe("budget-fresh demo", () => {
  it("passes TAP assertions that a closed coffer is not a budget", () => {
    const report = runBudgetFresh(loadBudgetFresh(resolve("fixtures/demo/coffer/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(COFFER_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.intents.size).toBe(3);
  });
});
