import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CART_TLDR } from "@aether/runtime";
import { loadCartOccupancy, runCartOccupancy } from "@aether/cart-occupancy";

describe("cart-occupancy demo", () => {
  it("passes TAP assertions that occupancy is a bind, not a field on fund", () => {
    const report = runCartOccupancy(loadCartOccupancy(resolve("fixtures/demo/cart/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CART_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    const hire = [...report.runtime.hires.values()][0];
    expect(hire?.state).toBe("funded");
    expect(hire?.cartId).toBeDefined();
  });
});
