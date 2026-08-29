import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { WELL_TLDR } from "@aether/runtime";
import { loadDelegationDepth, runDelegationDepth } from "@aether/delegation-depth";

describe("delegation-depth demo", () => {
  it("passes TAP assertions that a fourth hop is not a nested parent", () => {
    const report = runDelegationDepth(loadDelegationDepth(resolve("fixtures/demo/well/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(WELL_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    const founder = report.runtime.alias("ops-human");
    const desk = report.runtime.alias("desk");
    const over = report.runtime.alias("over-desk");
    const now = report.runtime.clock.now();
    expect(report.runtime.kya.path(founder.id, desk.id, now)?.length).toBe(3);
    expect(report.runtime.kya.path(founder.id, over.id, now)?.length).toBe(4);
  });
});
