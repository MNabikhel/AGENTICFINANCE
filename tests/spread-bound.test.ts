import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { BAND_TLDR } from "@aether/runtime";
import { loadSpreadBound, runSpreadBound } from "@aether/spread-bound";

describe("spread-bound demo", () => {
  it("passes TAP assertions that a 200bps band is not decoration", () => {
    const report = runSpreadBound(loadSpreadBound(resolve("fixtures/demo/band/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(BAND_TLDR);
    expect(report.runtime.quotes.size).toBe(1);
    expect([...report.runtime.consumedQuotes]).toHaveLength(1);
  });
});
