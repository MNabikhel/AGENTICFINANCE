import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SOUR_TLDR } from "@aether/runtime";
import { loadApprovalReplay, runApprovalReplay } from "@aether/approval-replay";

describe("approval-replay demo", () => {
  it("passes TAP assertions that a grown-up yes is not a late hire", () => {
    const report = runApprovalReplay(loadApprovalReplay(resolve("fixtures/demo/sour/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SOUR_TLDR);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
