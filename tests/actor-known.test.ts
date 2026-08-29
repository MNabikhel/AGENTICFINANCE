import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { MUTE_TLDR } from "@aether/runtime";
import { loadActorKnown, runActorKnown } from "@aether/actor-known";

describe("actor-known demo", () => {
  it("passes TAP assertions that a missing speaker is not a 500", () => {
    const report = runActorKnown(loadActorKnown(resolve("fixtures/demo/mute/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(MUTE_TLDR);
    expect(report.runtime.identity.all()).toHaveLength(5);
    expect(report.runtime.identity.all().some((a) => a.id === "aid_01J6AETHERGHOSTSPEAKER000075")).toBe(false);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
