import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { FOLD_TLDR } from "@aether/runtime";
import { loadMarketParty, runMarketParty } from "@aether/market-party";

describe("market-party demo", () => {
  it("passes TAP assertions that someone else's bid is not yours to pull", () => {
    const report = runMarketParty(loadMarketParty(resolve("fixtures/demo/fold/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(FOLD_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect([...report.runtime.withdrawnQuotes].length).toBe(1);
  });
});
