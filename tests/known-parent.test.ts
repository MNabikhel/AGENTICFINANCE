import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ROOT_TLDR } from "@aether/runtime";
import { loadKnownParent, runKnownParent } from "@aether/known-parent";

describe("known-parent demo", () => {
  it("passes TAP assertions that a missing parent is not a tighter child", () => {
    const report = runKnownParent(loadKnownParent(resolve("fixtures/demo/root/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(ROOT_TLDR);
    expect(report.runtime.intents.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
