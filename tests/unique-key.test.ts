import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { TWIN_TLDR } from "@aether/runtime";
import { loadUniqueKey, runUniqueKey } from "@aether/unique-key";

describe("unique-key demo", () => {
  it("passes TAP assertions that a taken alias is not a second agent", () => {
    const report = runUniqueKey(loadUniqueKey(resolve("fixtures/demo/twin/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(TWIN_TLDR);
    expect(report.runtime.identity.all()).toHaveLength(5);
    expect(report.runtime.alias("desk").displayName).toBe("Desk");
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
