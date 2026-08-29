import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CASH_TLDR } from "@aether/runtime";
import { loadLedgerSufficient, runLedgerSufficient } from "@aether/ledger-sufficient";

describe("ledger-sufficient demo", () => {
  it("passes TAP assertions that empty cash is not a negative book", () => {
    const report = runLedgerSufficient(loadLedgerSufficient(resolve("fixtures/demo/cash/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CASH_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "accepted")).toBe(true);
  });
});
