import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ICE_TLDR } from "@aether/runtime";
import { loadPrincipalNotFrozen, runPrincipalNotFrozen } from "@aether/principal-not-frozen";

describe("principal-not-frozen demo", () => {
  it("passes TAP assertions that a frozen principal is not a frozen desk", () => {
    const report = runPrincipalNotFrozen(loadPrincipalNotFrozen(resolve("fixtures/demo/ice/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(ICE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.alias("ops-human").frozen).toBe(false);
    expect(report.runtime.alias("desk").frozen).toBe(false);
  });
});
