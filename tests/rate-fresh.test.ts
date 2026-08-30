import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ASHLAR_TLDR } from "@aether/runtime";
import { loadRateFresh, runRateFresh } from "@aether/rate-fresh";

describe("rate-fresh demo", () => {
  it("passes TAP assertions that an empty pit does not waive the band", () => {
    const report = runRateFresh(loadRateFresh(resolve("fixtures/demo/ashlar/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(ASHLAR_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.quotes.size).toBe(3);
    expect(report.runtime.consumedQuotes.size).toBe(2);
  });
});
