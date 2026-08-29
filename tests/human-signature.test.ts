import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PEN_TLDR } from "@aether/runtime";
import { loadHumanSignature, runHumanSignature } from "@aether/human-signature";

describe("human-signature demo", () => {
  it("passes TAP assertions that a junior signature is not a grown-up pause", () => {
    const report = runHumanSignature(loadHumanSignature(resolve("fixtures/demo/pen/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(PEN_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.alias("desk").autonomyLevel).toBe(1);
  });
});
