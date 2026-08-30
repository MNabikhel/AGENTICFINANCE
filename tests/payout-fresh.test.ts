import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PIP_TLDR } from "@aether/runtime";
import { loadPayoutFresh, runPayoutFresh } from "@aether/payout-fresh";

describe("payout-fresh demo", () => {
  it("passes TAP assertions that a conversion that pays nothing is not an FX window", () => {
    const report = runPayoutFresh(loadPayoutFresh(resolve("fixtures/demo/pip/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PIP_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.quotes.size).toBe(3);
    expect(report.runtime.consumedQuotes.size).toBe(2);
  });
});
