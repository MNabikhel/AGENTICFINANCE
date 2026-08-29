import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { FENCE_TLDR } from "@aether/runtime";
import { loadSystemScope, runSystemScope } from "@aether/system-scope";

describe("system-scope demo", () => {
  it("passes TAP assertions that system is not a treasurer", () => {
    const report = runSystemScope(loadSystemScope(resolve("fixtures/demo/fence/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(FENCE_TLDR);
    expect(report.runtime.identity.all()).toHaveLength(5);
    expect(report.runtime.aliases.has("extra")).toBe(false);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
