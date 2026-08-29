import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CRATE_TLDR } from "@aether/runtime";
import { loadKnownCart, runKnownCart } from "@aether/known-cart";

describe("known-cart demo", () => {
  it("passes TAP assertions that a missing cart is not a broken payment chain", () => {
    const report = runKnownCart(loadKnownCart(resolve("fixtures/demo/crate/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CRATE_TLDR);
    expect(report.runtime.carts.size).toBe(1);
    expect(report.runtime.payments.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
