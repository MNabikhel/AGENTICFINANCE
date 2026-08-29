import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { PROTOCOL } from "@aether/types";
import { WARRANT_TLDR } from "@aether/runtime";
import { loadHostAuthority, runHostAuthority } from "@aether/host-authority";

describe("host-authority demo", () => {
  it("passes TAP assertions that an agent-issued slip is not host authority", () => {
    const report = runHostAuthority(loadHostAuthority(resolve("fixtures/demo/warrant/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(WARRANT_TLDR);
    expect(PROTOCOL.hosted).toBe(false);
    expect(report.runtime.protocolCard().hosted).toBe(true);
    expect(report.runtime.subscriptions.size).toBe(1);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
