import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SKU_TLDR } from "@aether/runtime";
import { loadPaymentSkus, runPaymentSkus } from "@aether/payment-skus";

describe("payment-skus demo", () => {
  it("passes TAP assertions that a listed SKU is not any catalog good", () => {
    const report = runPaymentSkus(loadPaymentSkus(resolve("fixtures/demo/sku/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SKU_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
