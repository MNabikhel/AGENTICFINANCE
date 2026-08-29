import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { BORN_TLDR } from "@aether/runtime";
import { loadFxFresh, runFxFresh } from "@aether/fx-fresh";

describe("fx-fresh demo", () => {
  it("passes TAP assertions that an FX window cannot be born dead", () => {
    const report = runFxFresh(loadFxFresh(resolve("fixtures/demo/born/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(BORN_TLDR);
    expect(report.runtime.quotes.size).toBe(1);
    expect(report.runtime.consumedQuotes.size).toBe(1);
  });
});
