import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { GRAFT_TLDR } from "@aether/runtime";
import { loadKyaKnownParent, runKyaKnownParent } from "@aether/kya-known-parent";

describe("kya-known-parent demo", () => {
  it("passes TAP assertions that a missing hop parent is not a nested handshake", () => {
    const report = runKyaKnownParent(loadKyaKnownParent(resolve("fixtures/demo/graft/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(GRAFT_TLDR);
    expect(report.runtime.kya.attestations.size).toBe(0);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
