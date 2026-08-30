import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { HAWK_TLDR } from "@aether/runtime";
import { loadFxOnly, runFxOnly } from "@aether/fx-only";

describe("fx-only demo", () => {
  it("passes TAP assertions that a maker's quote is a window, not a good", () => {
    const report = runFxOnly(loadFxOnly(resolve("fixtures/demo/hawk/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(HAWK_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect(report.runtime.consumedQuotes.size).toBe(2);
  });
});
