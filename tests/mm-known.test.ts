import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { MAKER_TLDR } from "@aether/runtime";
import { loadMmKnown, runMmKnown } from "@aether/mm-known";

describe("mm-known demo", () => {
  it("passes TAP assertions that a window is not a journal against nobody", () => {
    const report = runMmKnown(loadMmKnown(resolve("fixtures/demo/maker/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(MAKER_TLDR);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect([...report.runtime.identity.all()].some((a) => a.role === "market_maker")).toBe(true);
  });
});
