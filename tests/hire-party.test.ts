import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PARTY_TLDR } from "@aether/runtime";
import { loadHireParty, runHireParty } from "@aether/hire-party";

describe("hire-party demo", () => {
  it("passes TAP assertions that the other side of the table is not a party", () => {
    const report = runHireParty(loadHireParty(resolve("fixtures/demo/party/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PARTY_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
