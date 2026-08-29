import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { GRADE_TLDR } from "@aether/runtime";
import { loadMinLevel, runMinLevel } from "@aether/min-level";

describe("min-level demo", () => {
  it("passes TAP assertions that a junior desk is not a nested-slip mint", () => {
    const report = runMinLevel(loadMinLevel(resolve("fixtures/demo/grade/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(GRADE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.alias("scout").autonomyLevel).toBe(3);
    expect(report.runtime.alias("desk").autonomyLevel).toBe(4);
    expect(report.runtime.intents.size).toBe(2);
  });
});
