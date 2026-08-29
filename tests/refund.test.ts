import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { REFUND_TLDR } from "@aether/runtime";
import { loadRefund, runRefund } from "@aether/refund";

describe("refund unwind demo", () => {
  it("passes TAP assertions for cash, spend, clearing, quote, and sticky circuit", () => {
    const report = runRefund(loadRefund(resolve("fixtures/demo/refund/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(REFUND_TLDR);
    expect(report.snapshot.story.some((b) => b.tone === "deny")).toBe(true);
    expect(report.snapshot.story.some((b) => b.tone === "settle")).toBe(true);
    expect(report.runtime.circuitTripped).toBe(false);
    expect(report.runtime.clearing.pairNet(report.runtime.alias("desk").id, report.runtime.alias("research-vendor").id, "USD_SIM")).toBe(40000);
  });
});
