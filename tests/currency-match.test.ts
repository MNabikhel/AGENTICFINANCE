import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { INK_TLDR } from "@aether/runtime";
import { loadCurrencyMatch, runCurrencyMatch } from "@aether/currency-match";

describe("currency-match demo", () => {
  it("passes TAP assertions that a cart label is not the hire's money", () => {
    const report = runCurrencyMatch(loadCurrencyMatch(resolve("fixtures/demo/ink/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(INK_TLDR);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "funded")).toBe(true);
  });
});
