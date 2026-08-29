import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { NAME_TLDR } from "@aether/runtime";
import { loadKyaParty, runKyaParty } from "@aether/kya-party";

describe("kya-party demo", () => {
  it("passes TAP assertions that someone else's name is not a handshake", () => {
    const report = runKyaParty(loadKyaParty(resolve("fixtures/demo/name/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(NAME_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.alias("scout").autonomyLevel).toBe(4);
  });
});
