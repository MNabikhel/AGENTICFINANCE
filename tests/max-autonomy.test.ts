import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CEILING_TLDR } from "@aether/runtime";
import { loadMaxAutonomy, runMaxAutonomy } from "@aether/max-autonomy";

describe("max-autonomy demo", () => {
  it("passes TAP assertions that a climb is not a wider slip", () => {
    const report = runMaxAutonomy(loadMaxAutonomy(resolve("fixtures/demo/ceiling/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CEILING_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.alias("desk").autonomyLevel).toBe(4);
  });
});
