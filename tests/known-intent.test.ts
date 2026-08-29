import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { WRIT_TLDR } from "@aether/runtime";
import { loadKnownIntent, runKnownIntent } from "@aether/known-intent";

describe("known-intent demo", () => {
  it("passes TAP assertions that a missing slip is not a missing handshake", () => {
    const report = runKnownIntent(loadKnownIntent(resolve("fixtures/demo/writ/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(WRIT_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.quotes.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
