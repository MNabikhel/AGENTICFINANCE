import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { RAIL_TLDR } from "@aether/runtime";
import { loadAllowedInstruments, runAllowedInstruments } from "@aether/allowed-instruments";

describe("allowed-instruments demo", () => {
  it("passes TAP assertions that a listed rail is not decoration", () => {
    const report = runAllowedInstruments(loadAllowedInstruments(resolve("fixtures/demo/rail/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(RAIL_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.intents.size).toBe(2);
  });
});
