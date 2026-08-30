import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { TROLLEY_TLDR } from "@aether/runtime";
import { loadCheckoutParty, runCheckoutParty } from "@aether/checkout-party";

describe("checkout-party demo", () => {
  it("passes TAP assertions that someone else's checkout is not yours to fill", () => {
    const report = runCheckoutParty(loadCheckoutParty(resolve("fixtures/demo/trolley/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(TROLLEY_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "accepted" && h.cartId)).toBe(true);
  });
});
