import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { HALL_TLDR } from "@aether/runtime";
import { loadKnownRfq, runKnownRfq } from "@aether/known-rfq";

describe("known-rfq demo", () => {
  it("passes TAP assertions that a missing room is not a missing SKU", () => {
    const report = runKnownRfq(loadKnownRfq(resolve("fixtures/demo/hall/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(HALL_TLDR);
    expect(report.runtime.quotes.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
