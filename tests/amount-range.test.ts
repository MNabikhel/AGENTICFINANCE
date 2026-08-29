import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { LID_TLDR } from "@aether/runtime";
import { loadAmountRange, runAmountRange } from "@aether/amount-range";

describe("amount-range demo", () => {
  it("passes TAP assertions that an item cap is not an envelope", () => {
    const report = runAmountRange(loadAmountRange(resolve("fixtures/demo/lid/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(LID_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
