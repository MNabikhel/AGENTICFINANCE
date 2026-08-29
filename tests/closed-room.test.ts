import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ROOM_TLDR } from "@aether/runtime";
import { loadClosedRoom, runClosedRoom } from "@aether/closed-room";

describe("closed-room demo", () => {
  it("passes TAP assertions that a closed room is not a bulletin board", () => {
    const report = runClosedRoom(loadClosedRoom(resolve("fixtures/demo/room/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(ROOM_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect(report.runtime.rfqs.size).toBe(2);
    expect(report.runtime.quotes.size).toBe(2);
  });
});
