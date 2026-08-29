import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { MIRROR_TLDR } from "@aether/runtime";
import { loadKyaNotSelf, runKyaNotSelf } from "@aether/kya-not-self";

describe("kya-not-self demo", () => {
  it("passes TAP assertions that a handshake is not a mirror", () => {
    const report = runKyaNotSelf(loadKyaNotSelf(resolve("fixtures/demo/mirror/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(MIRROR_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
    expect(report.runtime.kya.attestations.size).toBe(1);
  });
});
