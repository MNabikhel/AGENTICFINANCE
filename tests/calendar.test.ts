import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CALENDAR_TLDR } from "@aether/runtime";
import { loadCalendar, runCalendar } from "@aether/execution-window";

describe("calendar demo", () => {
  it("passes TAP assertions that a closed calendar is not a freeze on funded work", () => {
    const report = runCalendar(loadCalendar(resolve("fixtures/demo/calendar/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CALENDAR_TLDR);
    expect(report.runtime.hires.size).toBe(1);
  });
});
