import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SLOT_TLDR } from "@aether/runtime";
import { loadSlot, runSlot } from "@aether/cadence-slot";

describe("cadence-slot demo", () => {
  it("passes TAP assertions that a refund does not restore a cadence slot", () => {
    const report = runSlot(loadSlot(resolve("fixtures/demo/slot/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SLOT_TLDR);
    expect(report.runtime.hires.size).toBe(1);
  });
});
