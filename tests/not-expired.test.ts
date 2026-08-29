import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { STALE_TLDR } from "@aether/runtime";
import { loadNotExpired, runNotExpired } from "@aether/not-expired";

describe("not-expired demo", () => {
  it("passes TAP assertions that a stale quote is not a hire", () => {
    const report = runNotExpired(loadNotExpired(resolve("fixtures/demo/stale/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(STALE_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "offered")).toBe(true);
  });
});
