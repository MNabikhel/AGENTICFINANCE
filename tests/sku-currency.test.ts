import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PRICED_TLDR } from "@aether/runtime";
import { loadSkuCurrency, runSkuCurrency } from "@aether/sku-currency";

describe("sku-currency demo", () => {
  it("passes TAP assertions that a listed SKU is only priced in a catalog currency", () => {
    const report = runSkuCurrency(loadSkuCurrency(resolve("fixtures/demo/priced/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PRICED_TLDR);
    expect(report.runtime.quotes.size).toBe(1);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
