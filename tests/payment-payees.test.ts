import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PAYEE_TLDR } from "@aether/runtime";
import { loadPaymentPayees, runPaymentPayees } from "@aether/payment-payees";

describe("allowed-payees demo", () => {
  it("passes TAP assertions that a listed payee is not any registered vendor", () => {
    const report = runPaymentPayees(loadPaymentPayees(resolve("fixtures/demo/payee/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PAYEE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
