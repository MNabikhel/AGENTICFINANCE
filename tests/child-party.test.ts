import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CUCKOO_TLDR } from "@aether/runtime";
import { loadChildParty, runChildParty } from "@aether/child-party";

describe("mandate-child-party demo", () => {
  it("passes TAP assertions that someone else's parent slip is not yours to nest under", () => {
    const report = runChildParty(loadChildParty(resolve("fixtures/demo/cuckoo/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CUCKOO_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect(
      [...report.runtime.intents.values()].some((i) => i.payload.parentId && i.payload.parentId.startsWith("mid_")),
    ).toBe(true);
  });
});
