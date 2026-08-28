import { describe, expect, it } from "vitest";
import { IdFactory, ManualClock } from "@aether/kernel";
import { Ledger } from "@aether/ledger";
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
});
