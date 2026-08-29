import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { NIL_TLDR } from "@aether/runtime";
import { loadReceiptKnown, runReceiptKnown } from "@aether/receipt-known";

describe("receipt-known demo", () => {
  it("passes TAP assertions that a missing receipt is not an empty success", () => {
    const report = runReceiptKnown(loadReceiptKnown(resolve("fixtures/demo/nil/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(NIL_TLDR);
    expect(report.runtime.receipts.size).toBe(1);
    expect(report.runtime.receipts.has("rid_01J6AETHERGHOSTRECEIPT000076")).toBe(false);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
