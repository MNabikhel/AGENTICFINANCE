import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { hopStatus } from "@aether/kya";
import { PAIR_TLDR } from "@aether/runtime";
import { loadUniqueLive, runUniqueLive } from "@aether/unique-live";

describe("unique-live demo", () => {
  it("passes TAP assertions that a second live hop is not a tighter grant", () => {
    const report = runUniqueLive(loadUniqueLive(resolve("fixtures/demo/pair/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PAIR_TLDR);
    const now = report.runtime.clock.now();
    const live = [...report.runtime.kya.attestations.values()].filter((a) => hopStatus(a, now) === "live");
    expect(live).toHaveLength(2);
  });
});
