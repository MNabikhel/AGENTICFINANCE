import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { VELOCITY_TLDR } from "@aether/runtime";
import { loadVelocity, runVelocity } from "@aether/hot-hour";

describe("hot-hour demo", () => {
  it("passes TAP assertions that a hot hour is not a freeze on funded work", () => {
    const report = runVelocity(loadVelocity(resolve("fixtures/demo/velocity/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(VELOCITY_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.approvals.size).toBe(1);
  });
});
