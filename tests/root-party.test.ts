import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { FORGE_TLDR } from "@aether/runtime";
import { loadRootParty, runRootParty } from "@aether/root-party";

describe("mandate-root-party demo", () => {
  it("passes TAP assertions that someone else's name is not a root slip to mint", () => {
    const report = runRootParty(loadRootParty(resolve("fixtures/demo/forge/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(FORGE_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect(
      [...report.runtime.intents.values()].some((i) => i.payload.issuerId === i.payload.subjectId && !i.payload.parentId),
    ).toBe(true);
  });
});
