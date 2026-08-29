import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PAPER_TLDR } from "@aether/runtime";
import { loadFxQuote, runFxQuote } from "@aether/fx-quote";

describe("fx-quote demo", () => {
  it("passes TAP assertions that a research quote is not a conversion window", () => {
    const report = runFxQuote(loadFxQuote(resolve("fixtures/demo/paper/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PAPER_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
