import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { DAILY_TLDR } from "@aether/runtime";
import { loadDaily, runDaily } from "@aether/daily-gap";

describe("daily-gap demo", () => {
  it("passes TAP assertions that a daily cadence is a gap, not a burst", () => {
    const report = runDaily(loadDaily(resolve("fixtures/demo/daily/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(DAILY_TLDR);
    expect(report.runtime.hires.size).toBe(2);
  });
});
