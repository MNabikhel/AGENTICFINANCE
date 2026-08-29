import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { VOID_TLDR } from "@aether/runtime";
import { loadHireVoid, runHireVoid } from "@aether/hire-void";

describe("hire-void demo", () => {
  it("passes TAP assertions that a void is not a refund", () => {
    const report = runHireVoid(loadHireVoid(resolve("fixtures/demo/void/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(VOID_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    const states = [...report.runtime.hires.values()].map((h) => h.state).sort();
    expect(states).toEqual(["released", "void"]);
  });
});
