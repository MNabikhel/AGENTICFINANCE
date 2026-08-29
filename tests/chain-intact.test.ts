import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CUT_TLDR } from "@aether/runtime";
import { loadChainIntact, runChainIntact } from "@aether/chain-intact";

describe("chain-intact demo", () => {
  it("passes TAP assertions that a revoke is not an expiry", () => {
    const report = runChainIntact(loadChainIntact(resolve("fixtures/demo/cut/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CUT_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.snapshot.kya.edges.some((e) => e.status === "revoked")).toBe(true);
    expect(report.snapshot.kya.edges.some((e) => e.status === "live")).toBe(true);
  });
});
