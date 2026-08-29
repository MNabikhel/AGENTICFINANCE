import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { THAW_TLDR } from "@aether/runtime";
import { loadFreezeState, runFreezeState } from "@aether/freeze-state";

describe("freeze-state demo", () => {
  it("passes TAP assertions that a no-op thaw is not a kill-switch test", () => {
    const report = runFreezeState(loadFreezeState(resolve("fixtures/demo/thaw/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(THAW_TLDR);
    expect(report.runtime.identity.get(report.runtime.alias("auditor").id)?.frozen).toBe(false);
    expect(report.runtime.killSwitchTested.size).toBe(0);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
