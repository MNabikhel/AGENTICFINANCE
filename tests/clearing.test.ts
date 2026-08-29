import { describe, expect, it } from "vitest";
import { ExposureBook } from "@aether/clearing";

describe("clearing book", () => {
  it("nets offsetting obligations", () => {
    const book = new ExposureBook();
    const a = "aid_A" as const;
    const b = "aid_B" as const;
    book.record(a, b, 100_00, "USD_SIM");
    book.record(b, a, 40_00, "USD_SIM");
    expect(book.pairNet(a, b, "USD_SIM")).toBe(60_00);
    const grid = book.nettingGrid("USD_SIM");
    expect(grid).toEqual([{ from: a, to: b, currency: "USD_SIM", net: 60_00 }]);
    const pos = book.positions("USD_SIM");
    expect(pos.find((p) => p.agentId === a)?.net).toBe(-60_00);
    expect(pos.find((p) => p.agentId === b)?.net).toBe(60_00);
  });

  it("flags a bilateral limit breach", () => {
    const book = new ExposureBook();
    book.record("aid_A", "aid_B", 90, "USD_SIM");
    expect(book.wouldExceed("aid_A", "aid_B", "USD_SIM", 20, 100)).toBe(true);
    expect(book.wouldExceed("aid_A", "aid_B", "USD_SIM", 5, 100)).toBe(false);
  });

  it("archives open legs into a settlement window", () => {
    const book = new ExposureBook();
    const a = "aid_A" as const;
    const b = "aid_B" as const;
    book.record(a, b, 100_00, "USD_SIM");
    book.record(b, a, 40_00, "USD_SIM");
    const window = book.settleWindow({
      id: "win_01J6AETHERWINDOW00000000001",
      at: "2026-08-28T00:00:00.000Z",
      currency: "USD_SIM",
    });
    expect(window.legsConsumed).toBe(2);
    expect(window.grossVolume).toBe(140_00);
    expect(window.netVolume).toBe(60_00);
    expect(window.nets).toEqual([{ from: a, to: b, currency: "USD_SIM", net: 60_00 }]);
    expect(book.snapshot().legs).toEqual([]);
    expect(book.windows).toHaveLength(1);
  });

  it("snapshots the instance cap and accepts a constructor override", () => {
    expect(new ExposureBook().snapshot().bilateralLimit).toBe(50_000_000);
    const tight = new ExposureBook(100000);
    expect(tight.snapshot().bilateralLimit).toBe(100000);
    tight.record("aid_A", "aid_B", 80000, "USD_SIM");
    expect(tight.wouldExceed("aid_A", "aid_B", "USD_SIM", 40000)).toBe(true);
    expect(tight.wouldExceed("aid_A", "aid_B", "USD_SIM", 20000)).toBe(false);
  });

  it("snapshot is a photo, not a live view of the open book", () => {
    const book = new ExposureBook();
    book.record("aid_A", "aid_B", 80000, "USD_SIM");
    const snap = book.snapshot();
    book.record("aid_A", "aid_B", 40000, "USD_SIM");
    expect(snap.legs).toHaveLength(1);
    expect(book.snapshot().legs).toHaveLength(2);
  });
});
