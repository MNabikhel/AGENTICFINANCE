import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SEAT_TLDR } from "@aether/runtime";
import { loadHostUnique, runHostUnique } from "@aether/host-unique";

describe("unique-subscriber demo", () => {
  it("passes TAP assertions that one subscriber is one row", () => {
    const report = runHostUnique(loadHostUnique(resolve("fixtures/demo/seat/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SEAT_TLDR);
    expect(report.runtime.subscriptions.size).toBe(2);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
