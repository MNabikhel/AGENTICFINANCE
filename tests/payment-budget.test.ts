import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PURSE_TLDR } from "@aether/runtime";
import { loadPaymentBudget, runPaymentBudget } from "@aether/payment-budget";

describe("payment-budget demo", () => {
  it("passes TAP assertions that a budget is not an item cap", () => {
    const report = runPaymentBudget(loadPaymentBudget(resolve("fixtures/demo/purse/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PURSE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
