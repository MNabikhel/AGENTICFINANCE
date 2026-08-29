import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { WALLET_TLDR } from "@aether/runtime";
import { loadLedgerKnown, runLedgerKnown } from "@aether/ledger-known";

describe("ledger-known demo", () => {
  it("passes TAP assertions that a vendor's USD cash is not a USDC wallet", () => {
    const report = runLedgerKnown(loadLedgerKnown(resolve("fixtures/demo/wallet/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(WALLET_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect(report.runtime.ledger.accountsByName.has("compute:usdc")).toBe(false);
  });
});
