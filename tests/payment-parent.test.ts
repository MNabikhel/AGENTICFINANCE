import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { COVER_TLDR } from "@aether/runtime";
import { loadParentBudget, runParentBudget } from "@aether/payment-parent";

describe("parent-budget demo", () => {
  it("passes TAP assertions that a parent envelope is not a child's leftover", () => {
    const report = runParentBudget(loadParentBudget(resolve("fixtures/demo/cover/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(COVER_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
