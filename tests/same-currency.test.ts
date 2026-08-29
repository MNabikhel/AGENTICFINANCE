import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { MIX_TLDR } from "@aether/runtime";
import { loadSameCurrency, runSameCurrency } from "@aether/same-currency";

describe("same-currency demo", () => {
  it("passes TAP assertions that a mixed journal is not a conversion", () => {
    const report = runSameCurrency(loadSameCurrency(resolve("fixtures/demo/mix/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(MIX_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
