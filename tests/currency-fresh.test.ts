import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CLASH_TLDR } from "@aether/runtime";
import { loadCurrencyFresh, runCurrencyFresh } from "@aether/currency-fresh";

describe("currency-fresh demo", () => {
  it("passes TAP assertions that a USDC coffer on a USD lid is not a budget", () => {
    const report = runCurrencyFresh(loadCurrencyFresh(resolve("fixtures/demo/clash/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CLASH_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.intents.size).toBe(3);
  });
});
