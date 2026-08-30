import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { EAVE_TLDR } from "@aether/runtime";
import { loadCapFresh, runCapFresh } from "@aether/cap-fresh";

describe("cap-fresh demo", () => {
  it("passes TAP assertions that a cap below the desk is not a cap", () => {
    const report = runCapFresh(loadCapFresh(resolve("fixtures/demo/eave/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(EAVE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.intents.size).toBe(3);
  });
});
