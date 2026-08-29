import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { RUNG_TLDR } from "@aether/runtime";
import { loadLadderLegal, runLadderLegal } from "@aether/ladder-legal";

describe("ladder-legal demo", () => {
  it("passes TAP assertions that a skipped rung is not a promotion", () => {
    const report = runLadderLegal(loadLadderLegal(resolve("fixtures/demo/rung/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(RUNG_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.alias("scout").autonomyLevel).toBe(3);
  });
});
