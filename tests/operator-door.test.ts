import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PROTOCOL } from "@aether/types";
import { DOOR_TLDR } from "@aether/runtime";
import { loadDoor, runDoor } from "@aether/operator-door";

describe("operator-door demo", () => {
  it("passes TAP assertions that the public kernel is not a hosted checkout", () => {
    const report = runDoor(loadDoor(resolve("fixtures/demo/door/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(DOOR_TLDR);
    expect(PROTOCOL.hosted).toBe(false);
    expect(report.runtime.hosted).toBe(true);
    expect(report.runtime.subscriptions.size).toBe(1);
  });
});
