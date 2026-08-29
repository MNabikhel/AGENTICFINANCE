import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SWAP_TLDR } from "@aether/runtime";
import { loadFxPair, runFxPair } from "@aether/fx-pair";

describe("fx-pair demo", () => {
  it("passes TAP assertions that a swapped pair is not a silent journal of the books this rail actually posts", () => {
    const report = runFxPair(loadFxPair(resolve("fixtures/demo/swap/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SWAP_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
