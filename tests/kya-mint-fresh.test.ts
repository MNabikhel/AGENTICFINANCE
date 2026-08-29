import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SPARK_TLDR } from "@aether/runtime";
import { loadKyaMintFresh, runKyaMintFresh } from "@aether/kya-mint-fresh";

describe("kya-mint-fresh demo", () => {
  it("passes TAP assertions that a handshake cannot be born dead", () => {
    const report = runKyaMintFresh(loadKyaMintFresh(resolve("fixtures/demo/spark/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SPARK_TLDR);
    expect(report.runtime.kya.attestations.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
