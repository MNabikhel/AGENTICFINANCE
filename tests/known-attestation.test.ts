import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SEAL_TLDR } from "@aether/runtime";
import { loadKnownAttestation, runKnownAttestation } from "@aether/known-attestation";

describe("known-attestation demo", () => {
  it("passes TAP assertions that a missing handshake is not a silent tombstone", () => {
    const report = runKnownAttestation(loadKnownAttestation(resolve("fixtures/demo/seal/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SEAL_TLDR);
    expect(report.runtime.kya.attestations.size).toBe(1);
    expect([...report.runtime.kya.attestations.values()].every((a) => a.revokedAt === undefined)).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
