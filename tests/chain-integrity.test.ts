import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CHAIN_TLDR } from "@aether/runtime";
import { loadChainIntegrity, runChainIntegrity } from "@aether/chain-integrity";

describe("chain-integrity demo", () => {
  it("passes TAP assertions that a dead cart is not a check", () => {
    const report = runChainIntegrity(loadChainIntegrity(resolve("fixtures/demo/chain/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CHAIN_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "accepted")).toBe(true);
  });
});
