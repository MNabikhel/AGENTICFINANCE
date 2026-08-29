import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CLEARING_TLDR, Runtime } from "@aether/runtime";
import { loadClearingWindow, runClearingWindow } from "@aether/clearing-window";

describe("clearing window demo", () => {
  it("passes TAP assertions for bilateral credit and a settlement photo", () => {
    const report = runClearingWindow(loadClearingWindow(resolve("fixtures/demo/clearing-window/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CLEARING_TLDR);
    expect(report.snapshot.story.some((b) => b.tone === "deny")).toBe(true);
    expect(report.snapshot.story.some((b) => b.tone === "settle")).toBe(true);
    expect(report.runtime.clearing.snapshot().bilateralLimit).toBe(100000);
    expect(report.runtime.clearing.snapshot().legs).toHaveLength(1);
    expect(report.runtime.clearing.windows).toHaveLength(1);
  });

  it("keeps the public default at $500k when no TAP cap is passed", () => {
    const rt = new Runtime({
      startIso: "2026-08-28T00:00:00.000Z",
      genesisNonce: "01J6AETHERGENESIS0000000005",
    });
    expect(rt.clearing.snapshot().bilateralLimit).toBe(50_000_000);
  });
});
