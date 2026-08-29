import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { HEIR_TLDR } from "@aether/runtime";
import { loadMandateParent, runMandateParent } from "@aether/mandate-parent";

describe("mandate-parent demo", () => {
  it("passes TAP assertions that a dead parent is not a parent", () => {
    const report = runMandateParent(loadMandateParent(resolve("fixtures/demo/heir/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(HEIR_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
