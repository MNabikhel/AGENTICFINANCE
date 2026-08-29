import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { RIP_TLDR } from "@aether/runtime";
import { loadMandateParty, runMandateParty } from "@aether/mandate-party";

describe("mandate-party demo", () => {
  it("passes TAP assertions that someone else's unused slip is not yours to tear", () => {
    const report = runMandateParty(loadMandateParty(resolve("fixtures/demo/rip/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(RIP_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect([...report.runtime.revokedIntents].length).toBe(1);
  });
});
