import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { BADGE_TLDR } from "@aether/runtime";
import { loadRoleCapability, runRoleCapability } from "@aether/role-capability";

describe("role-capability demo", () => {
  it("passes TAP assertions that a badge is not a shopping pass", () => {
    const report = runRoleCapability(loadRoleCapability(resolve("fixtures/demo/badge/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(BADGE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
