import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { DUMP_TLDR } from "@aether/runtime";
import { loadCartParty, runCartParty } from "@aether/cart-party";

describe("cart-party demo", () => {
  it("passes TAP assertions that someone else's unused checkout is not yours to dump", () => {
    const report = runCartParty(loadCartParty(resolve("fixtures/demo/dump/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(DUMP_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.revokedCarts].length).toBe(1);
  });
});
