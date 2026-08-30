import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { STUD_TLDR } from "@aether/runtime";
import { loadPathTighter, runPathTighter } from "@aether/path-tighter";

describe("path-tighter demo", () => {
  it("passes TAP assertions that a grant wider than the incoming hop is not a handshake", () => {
    const report = runPathTighter(loadPathTighter(resolve("fixtures/demo/stud/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(STUD_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.kya.attestations.size).toBe(3);
  });
});
