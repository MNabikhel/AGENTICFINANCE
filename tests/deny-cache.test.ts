import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { DENY_CACHE_TLDR } from "@aether/runtime";
import { loadDenyCache, runDenyCache } from "@aether/deny-cache";

describe("deny-cache demo", () => {
  it("passes TAP assertions that a deny is not cached and unfreeze lets the same hire.create proceed", () => {
    const report = runDenyCache(loadDenyCache(resolve("fixtures/demo/deny-cache/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(DENY_CACHE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.alias("desk").frozen).toBe(false);
  });
});
