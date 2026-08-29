import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { NONCE_TLDR } from "@aether/runtime";
import { loadNonce, runNonce } from "@aether/envelope-nonce";

describe("envelope nonce demo", () => {
  it("passes TAP assertions for one-shot submit nonce and leftover transfer nonce", () => {
    const report = runNonce(loadNonce(resolve("fixtures/demo/nonce/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(NONCE_TLDR);
    expect(report.runtime.nonces.size).toBe(1);
  });
});
