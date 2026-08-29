import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { FUSE_TLDR } from "@aether/runtime";
import { loadCircuitDaily, runCircuitDaily } from "@aether/circuit-daily";

describe("circuit-daily demo", () => {
  it("passes TAP assertions that a daily fuse is not a freeze on funded work", () => {
    const report = runCircuitDaily(loadCircuitDaily(resolve("fixtures/demo/fuse/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(FUSE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.circuitTripped).toBe(true);
  });
});
