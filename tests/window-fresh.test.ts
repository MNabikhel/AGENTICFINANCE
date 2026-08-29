import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { WILT_TLDR } from "@aether/runtime";
import { loadWindowFresh, runWindowFresh } from "@aether/window-fresh";

describe("window-fresh demo", () => {
  it("passes TAP assertions that a slip cannot be born with a closed calendar", () => {
    const report = runWindowFresh(loadWindowFresh(resolve("fixtures/demo/wilt/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(WILT_TLDR);
    expect(report.runtime.intents.size).toBe(2);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
