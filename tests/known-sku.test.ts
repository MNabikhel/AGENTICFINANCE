import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { SHELF_TLDR } from "@aether/runtime";
import { loadKnownSku, runKnownSku } from "@aether/known-sku";

describe("known-sku demo", () => {
  it("passes TAP assertions that a ghost SKU is not a catalog good", () => {
    const report = runKnownSku(loadKnownSku(resolve("fixtures/demo/shelf/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.snapshot.tldr).toBe(SHELF_TLDR);
    expect(report.runtime.rfqs.size).toBe(1);
    expect([...report.runtime.hires.values()].some((h) => h.state === "released")).toBe(true);
  });
});
