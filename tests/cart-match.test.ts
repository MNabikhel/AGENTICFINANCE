import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { MATCH_TLDR } from "@aether/runtime";
import { loadCartMatch, runCartMatch } from "@aether/cart-match";

describe("cart-match demo", () => {
  it("passes TAP assertions that a cheaper cart is not a discount", () => {
    const report = runCartMatch(loadCartMatch(resolve("fixtures/demo/match/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(MATCH_TLDR);
    expect(report.runtime.hires.size).toBe(1);
    const hire = [...report.runtime.hires.values()][0];
    expect(hire?.state).toBe("funded");
    expect(hire?.price.amount).toBe(80_000);
    expect(hire?.cartId).toBeDefined();
    expect(report.runtime.carts.size).toBe(1);
  });
});
