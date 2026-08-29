import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { WEEK_TLDR } from "@aether/runtime";
import { loadCadenceReach, runCadenceReach } from "@aether/cadence-reach";

describe("cadence-reach demo", () => {
  it("passes TAP assertions that a week is not a cadence on a seven-day slip", () => {
    const report = runCadenceReach(loadCadenceReach(resolve("fixtures/demo/week/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(WEEK_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.intents.size).toBe(3);
  });
});
