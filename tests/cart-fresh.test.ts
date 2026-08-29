import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { DUST_TLDR } from "@aether/runtime";
import { loadCartFresh, runCartFresh } from "@aether/cart-fresh";

describe("cart-fresh demo", () => {
  it("passes TAP assertions that a stale unpaid cart is not a late check", () => {
    const report = runCartFresh(loadCartFresh(resolve("fixtures/demo/dust/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(DUST_TLDR);
    expect(report.runtime.carts.size).toBe(2);
    expect(report.runtime.payments.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
