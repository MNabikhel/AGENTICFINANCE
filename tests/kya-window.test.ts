import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { YEAR_TLDR } from "@aether/runtime";
import { loadKyaWindow, runKyaWindow } from "@aether/kya-window";

describe("kya-window demo", () => {
  it("passes TAP assertions that a handshake cannot outlive one year", () => {
    const report = runKyaWindow(loadKyaWindow(resolve("fixtures/demo/year/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(YEAR_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
