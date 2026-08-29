import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { REPLAY_TLDR } from "@aether/runtime";
import { loadReplay, runReplay } from "@aether/replay";

describe("replay once demo", () => {
  it("passes TAP assertions for hire.create and hire.fund replay", () => {
    const report = runReplay(loadReplay(resolve("fixtures/demo/replay/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(REPLAY_TLDR);
    expect([...report.runtime.hires.values()]).toHaveLength(1);
  });
});
