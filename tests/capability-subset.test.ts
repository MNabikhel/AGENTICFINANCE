import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CLIMB_TLDR } from "@aether/runtime";
import { loadCapabilitySubset, runCapabilitySubset } from "@aether/capability-subset";

describe("capability-subset demo", () => {
  it("passes TAP assertions that a climb is not a wider handshake", () => {
    const report = runCapabilitySubset(loadCapabilitySubset(resolve("fixtures/demo/climb/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CLIMB_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.alias("desk").autonomyLevel).toBe(4);
  });
});
