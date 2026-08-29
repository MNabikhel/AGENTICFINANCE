import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { REACH_TLDR } from "@aether/runtime";
import { loadWindowReach, runWindowReach } from "@aether/window-reach";

describe("window-reach demo", () => {
  it("passes TAP assertions that a window that opens after the slip dies is not a window", () => {
    const report = runWindowReach(loadWindowReach(resolve("fixtures/demo/reach/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(REACH_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.intents.size).toBe(2);
  });
});
