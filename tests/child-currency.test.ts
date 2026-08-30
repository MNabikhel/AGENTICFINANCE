import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { HEADER_TLDR } from "@aether/runtime";
import { loadChildCurrency, runChildCurrency } from "@aether/child-currency";

describe("child-currency demo", () => {
  it("passes TAP assertions that a USDC header under a USD plate is not a nested slip", () => {
    const report = runChildCurrency(loadChildCurrency(resolve("fixtures/demo/header/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(HEADER_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.intents.size).toBe(4);
  });
});
