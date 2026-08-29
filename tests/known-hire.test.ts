import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PACT_TLDR } from "@aether/runtime";
import { loadKnownHire, runKnownHire } from "@aether/known-hire";

describe("known-hire demo", () => {
  it("passes TAP assertions that a missing contract is not a broken mandate chain", () => {
    const report = runKnownHire(loadKnownHire(resolve("fixtures/demo/pact/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PACT_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
