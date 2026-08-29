import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SUBJECT_TLDR } from "@aether/runtime";
import { loadIntentSubject, runIntentSubject } from "@aether/intent-subject";

describe("intent-subject demo", () => {
  it("passes TAP assertions that this slip is not yours to spend", () => {
    const report = runIntentSubject(loadIntentSubject(resolve("fixtures/demo/subject/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SUBJECT_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.alias("desk-b").role).toBe("procurement");
  });
});
