import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { HATCH_TLDR } from "@aether/runtime";
import { loadHatchFresh, runHatchFresh } from "@aether/hatch-fresh";

describe("hatch-fresh demo", () => {
  it("passes TAP assertions that a closed hatch is not a range", () => {
    const report = runHatchFresh(loadHatchFresh(resolve("fixtures/demo/hatch/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(HATCH_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.intents.size).toBe(3);
  });
});
