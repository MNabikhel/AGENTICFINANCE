import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CRADLE_TLDR } from "@aether/runtime";
import { loadBirthRung, runBirthRung } from "@aether/birth-rung";

describe("birth-rung demo", () => {
  it("passes TAP assertions that L5 is not a birthright", () => {
    const report = runBirthRung(loadBirthRung(resolve("fixtures/demo/cradle/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CRADLE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.aliases.has("sentinel")).toBe(true);
    expect(report.runtime.alias("sentinel").autonomyLevel).toBe(4);
  });
});
