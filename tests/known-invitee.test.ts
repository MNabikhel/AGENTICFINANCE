import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { GUEST_TLDR } from "@aether/runtime";
import { loadKnownInvitee, runKnownInvitee } from "@aether/known-invitee";

describe("known-invitee demo", () => {
  it("passes TAP assertions that a missing invitee is not a closed room", () => {
    const report = runKnownInvitee(loadKnownInvitee(resolve("fixtures/demo/guest/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(GUEST_TLDR);
    expect(report.runtime.rfqs.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
