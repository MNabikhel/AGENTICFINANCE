import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { LAPSE_TLDR } from "@aether/runtime";
import { loadAttestationFresh, runAttestationFresh } from "@aether/attestation-fresh";

describe("attestation-fresh demo", () => {
  it("passes TAP assertions that an expired hop is not a freeze on funded work", () => {
    const report = runAttestationFresh(loadAttestationFresh(resolve("fixtures/demo/lapse/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(LAPSE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.snapshot.kya.edges.some((e) => e.status === "expired")).toBe(true);
    expect(report.snapshot.kya.edges.some((e) => e.status === "live")).toBe(false);
  });
});
