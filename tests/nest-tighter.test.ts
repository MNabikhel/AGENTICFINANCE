import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { JOIST_TLDR } from "@aether/runtime";
import { loadNestTighter, runNestTighter } from "@aether/nest-tighter";

describe("nest-tighter demo", () => {
  it("passes TAP assertions that a nested grant wider than its parent is not a handshake", () => {
    const report = runNestTighter(loadNestTighter(resolve("fixtures/demo/joist/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(JOIST_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.kya.attestations.size).toBe(3);
  });
});
