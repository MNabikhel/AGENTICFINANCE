import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PLATE_TLDR } from "@aether/runtime";
import { loadPathLive, runPathLive } from "@aether/path-live";

describe("path-live demo", () => {
  it("passes TAP assertions that an orphan hop is not a handshake", () => {
    const report = runPathLive(loadPathLive(resolve("fixtures/demo/plate/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PLATE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.kya.attestations.size).toBe(3);
  });
});
