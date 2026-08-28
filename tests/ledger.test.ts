import { describe, expect, it } from "vitest";
import { IdFactory, ManualClock } from "@aether/kernel";
import { Ledger, isOperatingBook } from "@aether/ledger";
import type { AccountId, JournalId } from "@aether/types";

describe("ledger", () => {
  it("rejects unbalanced journals", () => {
    const clock = new ManualClock("2026-08-28T00:00:00.000Z");
    const ids = new IdFactory(clock);
    const ledger = new Ledger();
    const a = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "cash",
      type: "asset",
      currency: "USD_SIM",
    });
    const b = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "equity",
      type: "equity",
      currency: "USD_SIM",
    });
    const res = ledger.post({
      id: ids.next("jnl") as JournalId,
      clock,
      description: "bad",
      lines: [
        { accountId: a.id, debit: 10, credit: 0 },
        { accountId: b.id, debit: 0, credit: 9 },
      ],
    });
    expect(res.ok).toBe(false);
  });

  it("posts a balanced opening", () => {
    const clock = new ManualClock("2026-08-28T00:00:00.000Z");
    const ids = new IdFactory(clock);
    const ledger = new Ledger();
    const cash = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "cash",
      type: "asset",
      currency: "USD_SIM",
    });
    const equity = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "equity",
      type: "equity",
      currency: "USD_SIM",
    });
    const res = ledger.post({
      id: ids.next("jnl") as JournalId,
      clock,
      description: "open",
      lines: [
        { accountId: cash.id, debit: 100, credit: 0 },
        { accountId: equity.id, debit: 0, credit: 100 },
      ],
    });
    expect(res.ok).toBe(true);
    expect(ledger.balance(cash.id)).toBe(100);
    expect(ledger.balance(equity.id)).toBe(100);
  });

  it("refuses a dest that would leave Number.isSafeInteger", () => {
    const clock = new ManualClock("2026-08-28T00:00:00.000Z");
    const ids = new IdFactory(clock);
    const ledger = new Ledger();
    const cash = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "cash",
      type: "asset",
      currency: "USD_SIM",
    });
    const equity = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "equity",
      type: "equity",
      currency: "USD_SIM",
    });
    const opened = ledger.post({
      id: ids.next("jnl") as JournalId,
      clock,
      description: "open at max",
      lines: [
        { accountId: cash.id, debit: Number.MAX_SAFE_INTEGER, credit: 0 },
        { accountId: equity.id, debit: 0, credit: Number.MAX_SAFE_INTEGER },
      ],
    });
    expect(opened.ok).toBe(true);
    expect(ledger.balance(cash.id)).toBe(Number.MAX_SAFE_INTEGER);
    const overflow = ledger.post({
      id: ids.next("jnl") as JournalId,
      clock,
      description: "one more cent",
      lines: [
        { accountId: cash.id, debit: 1, credit: 0 },
        { accountId: equity.id, debit: 0, credit: 1 },
      ],
    });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error.detail).toContain("safe integer");
    expect(ledger.balance(cash.id)).toBe(Number.MAX_SAFE_INTEGER);
    expect(ledger.balance(equity.id)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("treats agent cash as operating and equity or escrow as not", () => {
    const clock = new ManualClock("2026-08-28T00:00:00.000Z");
    const ids = new IdFactory(clock);
    const ledger = new Ledger();
    const cash = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "desk:cash",
      type: "asset",
      currency: "USD_SIM",
    });
    const equity = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "system:equity",
      type: "equity",
      currency: "USD_SIM",
    });
    const escrow = ledger.openAccount({
      id: ids.next("acct") as AccountId,
      ownerId: "system",
      name: "escrow:hid_01J6AETHERHIRE00000000001",
      type: "asset",
      currency: "USD_SIM",
    });
    expect(isOperatingBook(cash)).toBe(true);
    expect(isOperatingBook(equity)).toBe(false);
    expect(isOperatingBook(escrow)).toBe(false);
  });
});
