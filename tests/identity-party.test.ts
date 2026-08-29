import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { LOCK_TLDR } from "@aether/runtime";
import { loadIdentityParty, runIdentityParty } from "@aether/identity-party";

describe("identity-party demo", () => {
  it("passes TAP assertions that someone else's key is not yours to turn", () => {
    const report = runIdentityParty(loadIdentityParty(resolve("fixtures/demo/lock/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(LOCK_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    const desk = report.runtime.alias("desk");
    expect(desk.keys.length).toBeGreaterThan(1);
  });
});
