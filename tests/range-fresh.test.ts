import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { GULF_TLDR } from "@aether/runtime";
import { loadRangeFresh, runRangeFresh } from "@aether/range-fresh";

describe("range-fresh demo", () => {
  it("passes TAP assertions that a floor above the lid is not a range", () => {
    const report = runRangeFresh(loadRangeFresh(resolve("fixtures/demo/gulf/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(GULF_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.intents.size).toBe(3);
  });
});
