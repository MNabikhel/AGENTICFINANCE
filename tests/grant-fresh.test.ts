import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SILL_TLDR } from "@aether/runtime";
import { loadGrantFresh, runGrantFresh } from "@aether/grant-fresh";

describe("grant-fresh demo", () => {
  it("passes TAP assertions that a grant below the desk is not a handshake", () => {
    const report = runGrantFresh(loadGrantFresh(resolve("fixtures/demo/sill/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SILL_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.kya.attestations.size).toBe(2);
  });
});
