import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PANE_TLDR } from "@aether/runtime";
import { loadFxWindow, runFxWindow } from "@aether/fx-window";

describe("fx-window demo", () => {
  it("passes TAP assertions that an FX SKU is a window, not a good", () => {
    const report = runFxWindow(loadFxWindow(resolve("fixtures/demo/pane/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PANE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
