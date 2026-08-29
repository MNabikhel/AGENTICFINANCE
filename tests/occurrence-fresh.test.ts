import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { VACANT_TLDR } from "@aether/runtime";
import { loadOccurrenceFresh, runOccurrenceFresh } from "@aether/occurrence-fresh";

describe("occurrence-fresh demo", () => {
  it("passes TAP assertions that a cadence with no slots is not a cadence", () => {
    const report = runOccurrenceFresh(loadOccurrenceFresh(resolve("fixtures/demo/vacant/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(VACANT_TLDR);
    expect(report.runtime.intents.size).toBe(2);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
