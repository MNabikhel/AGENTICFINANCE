import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { GUISE_TLDR } from "@aether/runtime";
import { loadHireSlipParty, runHireSlipParty } from "@aether/hire-slip-party";

describe("hire-slip-party demo", () => {
  it("passes TAP assertions that someone else's unused slip is not yours to hire against", () => {
    const report = runHireSlipParty(loadHireSlipParty(resolve("fixtures/demo/guise/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(GUISE_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "offered")).toBe(true);
  });
});
