import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadNightWatch, runNightWatch } from "@aether/night-watch";

describe("night watch demo", () => {
  it("passes TAP assertions for standing permission", () => {
    const scenario = loadNightWatch(resolve("fixtures/demo/night-watch/scenario.json"));
    const report = runNightWatch(scenario);
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.story.some((b) => b.headline.includes("shook hands"))).toBe(true);
    expect(report.snapshot.kya.edges.some((e) => e.status === "revoked")).toBe(true);
    expect(report.runtime.alias("night-watch").autonomyLevel).toBe(5);
  });
});
