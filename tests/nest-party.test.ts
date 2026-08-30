import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CORBEL_TLDR } from "@aether/runtime";
import { loadNestParty, runNestParty } from "@aether/nest-party";

describe("nest-party demo", () => {
  it("passes TAP assertions that a nested hop under another principal is not a nested handshake", () => {
    const report = runNestParty(loadNestParty(resolve("fixtures/demo/corbel/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CORBEL_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.kya.attestations.size).toBe(3);
  });
});
