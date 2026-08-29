import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { STOCK_TLDR } from "@aether/runtime";
import { loadMmInventory, runMmInventory } from "@aether/mm-inventory";

describe("mm-inventory demo", () => {
  it("passes TAP assertions that empty MM USDC is not a missing maker", () => {
    const report = runMmInventory(loadMmInventory(resolve("fixtures/demo/stock/scenario.json")));
    const failed = report.results.filter((r) => r.ok === false);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(STOCK_TLDR);
    expect(report.runtime.consumedQuotes.size).toBe(1);
  });
});
