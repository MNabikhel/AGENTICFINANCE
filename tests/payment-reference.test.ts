import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { CITE_TLDR } from "@aether/runtime";
import { loadPaymentReference, runPaymentReference } from "@aether/payment-reference";

describe("payment-reference demo", () => {
  it("passes TAP assertions that a listed reference is not decoration once a check exists", () => {
    const report = runPaymentReference(loadPaymentReference(resolve("fixtures/demo/cite/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(CITE_TLDR);
    expect(report.runtime.hires.size).toBe(2);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
    expect([...report.runtime.hires.values()].some((h) => h.state === "offered")).toBe(true);
    expect(report.runtime.intents.size).toBe(3);
  });
});
