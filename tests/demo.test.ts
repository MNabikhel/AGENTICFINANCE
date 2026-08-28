import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadScenario, runSprintProcurement } from "@aether/sprint";

describe("sprint procurement demo", () => {
  it("passes TAP assertions", () => {
    const scenario = loadScenario(resolve("fixtures/demo/sprint-procurement/scenario.json"));
    const report = runSprintProcurement(scenario);
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.story.some((b) => b.tone === "deny")).toBe(true);
    expect(report.snapshot.story.some((b) => b.tone === "escalate")).toBe(true);
    expect(report.snapshot.clearing.usd.netting.length).toBeGreaterThan(0);
  });
});
