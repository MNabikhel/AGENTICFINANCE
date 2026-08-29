import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ARROW_TLDR } from "@aether/runtime";
import { loadHireState, runHireState } from "@aether/hire-state";

describe("hire-state demo", () => {
  it("passes TAP assertions that unfinished work is not a payout", () => {
    const report = runHireState(loadHireState(resolve("fixtures/demo/arrow/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(ARROW_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
