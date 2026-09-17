import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { TOMB_TLDR } from "@aether/runtime";
import { loadRevokeState, runRevokeState } from "@aether/revoke-state";

describe("revoke-state demo", () => {
  it("passes TAP assertions that a tombstone is not a second tombstone", () => {
    const report = runRevokeState(loadRevokeState(resolve("fixtures/demo/tomb/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(TOMB_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect(report.runtime.kya.attestations.size).toBe(2);
    expect([...report.runtime.kya.attestations.values()].every((a) => a.revokedAt !== undefined)).toBe(true);
  });
});
