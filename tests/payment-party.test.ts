import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SPIKE_TLDR } from "@aether/runtime";
import { loadPaymentParty, runPaymentParty } from "@aether/payment-party";

describe("payment-party demo", () => {
  it("passes TAP assertions that someone else's unused payment is not yours to spike", () => {
    const report = runPaymentParty(loadPaymentParty(resolve("fixtures/demo/spike/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SPIKE_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.revokedPayments].length).toBe(1);
  });
});
