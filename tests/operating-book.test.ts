import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { MINT_TLDR } from "@aether/runtime";
import { loadOperatingBook, runOperatingBook } from "@aether/operating-book";

describe("operating-book demo", () => {
  it("passes TAP assertions that a transfer is not a mint", () => {
    const report = runOperatingBook(loadOperatingBook(resolve("fixtures/demo/mint/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(MINT_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    expect([...report.runtime.hires.values()][0]?.state).toBe("released");
  });
});
