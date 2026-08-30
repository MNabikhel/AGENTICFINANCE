import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { QUOIN_TLDR } from "@aether/runtime";
import { loadFxMaker, runFxMaker } from "@aether/fx-maker";

describe("fx-maker demo", () => {
  it("passes TAP assertions that a vendor's conversion is not a market-maker window", () => {
    const report = runFxMaker(loadFxMaker(resolve("fixtures/demo/quoin/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(QUOIN_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.quotes.size).toBe(3);
    expect(report.runtime.consumedQuotes.size).toBe(2);
  });
});
