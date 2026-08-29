import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { DOCKET_TLDR } from "@aether/runtime";
import { loadKnownApproval, runKnownApproval } from "@aether/known-approval";

describe("known-approval demo", () => {
  it("passes TAP assertions that a missing ticket is not a late yes", () => {
    const report = runKnownApproval(loadKnownApproval(resolve("fixtures/demo/docket/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(DOCKET_TLDR);
    expect(report.runtime.approvals.size).toBe(0);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
