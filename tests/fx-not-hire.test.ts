import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CONVERSION_TLDR } from "@aether/runtime";
import { loadConversion, runConversion } from "@aether/fx-not-hire";

describe("fx-not-hire demo", () => {
  it("passes TAP assertions that an FX window is not a hire", () => {
    const report = runConversion(loadConversion(resolve("fixtures/demo/conversion/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CONVERSION_TLDR);
    expect(report.runtime.hires.size).toBe(0);
    expect(report.runtime.quotes.size).toBe(1);
    expect([...report.runtime.consumedQuotes].length).toBe(1);
  });
});
