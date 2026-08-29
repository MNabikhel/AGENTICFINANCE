import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SHUT_TLDR } from "@aether/runtime";
import { loadRfqParty, runRfqParty } from "@aether/rfq-party";

describe("rfq-party demo", () => {
  it("passes TAP assertions that someone else's room is not yours to close", () => {
    const report = runRfqParty(loadRfqParty(resolve("fixtures/demo/shut/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SHUT_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect([...report.runtime.closedRfqs].length).toBe(1);
  });
});
