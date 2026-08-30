import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { POACH_TLDR } from "@aether/runtime";
import { loadHireRoomParty, runHireRoomParty } from "@aether/hire-room-party";

describe("hire-room-party demo", () => {
  it("passes TAP assertions that someone else's room is not yours to hire from", () => {
    const report = runHireRoomParty(loadHireRoomParty(resolve("fixtures/demo/poach/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(POACH_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "offered")).toBe(true);
  });
});
