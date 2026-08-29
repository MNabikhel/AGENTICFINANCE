import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { RECURRENCE_TLDR } from "@aether/runtime";
import { loadRecurrence, runRecurrence } from "@aether/recurrence-cadence";

describe("recurrence cadence demo", () => {
  it("passes TAP assertions that a one-slot slip is not an open checkbook", () => {
    const report = runRecurrence(loadRecurrence(resolve("fixtures/demo/recurrence/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(RECURRENCE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
  });
});
