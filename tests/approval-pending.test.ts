import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PAUSE_TLDR } from "@aether/runtime";
import { loadApprovalPending, runApprovalPending } from "@aether/approval-pending";

describe("approval-pending demo", () => {
  it("passes TAP assertions that a dead pause is not a late yes", () => {
    const report = runApprovalPending(loadApprovalPending(resolve("fixtures/demo/pause/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PAUSE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect([...report.runtime.approvals.values()].some((t) => t.status === "expired")).toBe(true);
  });
});
