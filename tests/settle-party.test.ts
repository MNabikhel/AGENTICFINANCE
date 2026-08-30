import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SNARE_TLDR } from "@aether/runtime";
import { loadSettleParty, runSettleParty } from "@aether/settle-party";

describe("settle-party demo", () => {
  it("passes TAP assertions that someone else's conversion window is not yours to settle", () => {
    const report = runSettleParty(loadSettleParty(resolve("fixtures/demo/snare/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SNARE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect(report.runtime.consumedQuotes.size).toBe(3);
  });
});
