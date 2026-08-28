import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { err, type Clock } from "@aether/kernel";
import type {
  Account,
  AccountId,
  AccountType,
  AgentId,
  AetherError,
  CurrencyCode,
  HireId,
  JournalEntry,
  JournalId,
  JournalLine,
  MandateId,
  Money,
  Result,
} from "@aether/types";

export class Ledger {
  readonly accounts = new Map<AccountId, Account>();
  readonly accountsByName = new Map<string, Account>();
  readonly entries: JournalEntry[] = [];
  private readonly balances = new Map<AccountId, number>();

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      const text = readFileSync(path, "utf8").trim();
      if (text.length > 0) {
        for (const line of text.split("\n")) {
          const entry = JSON.parse(line) as JournalEntry;
          this.apply(entry, false);
        }
      }
    }
  }

  openAccount(input: {
    id: AccountId;
    ownerId: AgentId | "system";
    name: string;
    type: AccountType;
    currency: CurrencyCode;
  }): Account {
    if (this.accounts.has(input.id) || this.accountsByName.has(input.name)) {
      throw new Error(`account exists: ${input.name}`);
    }
    const account: Account = { ...input };
    this.accounts.set(account.id, account);
    this.accountsByName.set(account.name, account);
    this.balances.set(account.id, 0);
    return account;
  }

  account(name: string): Account {
    const a = this.accountsByName.get(name);
    if (!a) throw new Error(`unknown account ${name}`);
    return a;
  }

  balance(accountId: AccountId): number {
    return this.balances.get(accountId) ?? 0;
  }

  balanceByName(name: string): Money {
    const a = this.account(name);
    return { amount: this.balance(a.id), currency: a.currency };
  }

  post(input: {
    id: JournalId;
    clock: Clock;
    description: string;
    lines: JournalLine[];
    hireId?: HireId;
    paymentMandateId?: MandateId;
  }): Result<JournalEntry, AetherError> {
    const checked = this.validateLines(input.lines);
    if (!checked.ok) return checked;
    if (!this.balancesStaySafe(input.lines)) {
      return {
        ok: false,
        error: err("ledger.overflow", "Unsafe balance", 400, "resulting balance is not a safe integer"),
      };
    }
    const entry: JournalEntry = {
      id: input.id,
      timestamp: input.clock.now(),
      description: input.description,
      lines: input.lines,
      ...(input.hireId ? { hireId: input.hireId } : {}),
      ...(input.paymentMandateId ? { paymentMandateId: input.paymentMandateId } : {}),
    };
    this.apply(entry, true);
    return { ok: true, value: entry };
  }

  /** Rebuild books from a durable world. Does not re-append JSONL. */
  restore(accounts: Account[], entries: JournalEntry[]): void {
    this.accounts.clear();
    this.accountsByName.clear();
    this.balances.clear();
    this.entries.splice(0, this.entries.length);
    for (const account of accounts) {
      this.accounts.set(account.id, account);
      this.accountsByName.set(account.name, account);
      this.balances.set(account.id, 0);
    }
    for (const entry of entries) this.apply(entry, false);
  }

  replayEqualsMemory(path: string): boolean {
    const other = new Ledger(path);
    if (other.entries.length !== this.entries.length) return false;
    for (const [id, bal] of this.balances) {
      if (other.balance(id) !== bal) return false;
    }
    return true;
  }

  private validateLines(lines: JournalLine[]): Result<true, AetherError> {
    if (lines.length < 2) {
      return { ok: false, error: err("ledger.unbalanced", "Unbalanced journal", 400, "need at least two lines") };
    }
    let debit = 0;
    let credit = 0;
    let currency: CurrencyCode | undefined;
    for (const line of lines) {
      if (line.debit < 0 || line.credit < 0) {
        return { ok: false, error: err("ledger.negative", "Negative amount", 400, "debit/credit must be >= 0") };
      }
      if ((line.debit > 0 && line.credit > 0) || (line.debit === 0 && line.credit === 0)) {
        return {
          ok: false,
          error: err("ledger.line", "Invalid line", 400, "each line must be a debit XOR a credit"),
        };
      }
      if (!Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit)) {
        return {
          ok: false,
          error: err("ledger.overflow", "Unsafe balance", 400, "resulting balance is not a safe integer"),
        };
      }
      const acct = this.accounts.get(line.accountId);
      if (!acct) {
        return { ok: false, error: err("ledger.account", "Unknown account", 400, line.accountId) };
      }
      if (currency === undefined) currency = acct.currency;
      else if (acct.currency !== currency) {
        return {
          ok: false,
          error: err("ledger.currency", "Mixed currency journal", 400, "split FX into two entries"),
        };
      }
      debit += line.debit;
      credit += line.credit;
    }
    if (debit !== credit) {
      return {
        ok: false,
        error: err("ledger.unbalanced", "Unbalanced journal", 400, `debit ${debit} !== credit ${credit}`),
      };
    }
    return { ok: true, value: true };
  }

  /**
   * True when posting these lines would leave every touched book a safe integer.
   * Missing accounts are false. Restore/apply of old worlds does not use this —
   * only `post()` (new journals) does.
   */
  balancesStaySafe(lines: JournalLine[]): boolean {
    for (const line of lines) {
      const acct = this.accounts.get(line.accountId);
      if (!acct) return false;
      const next = this.balance(acct.id) + signedDelta(acct.type, line.debit, line.credit);
      if (!Number.isSafeInteger(next)) return false;
    }
    return true;
  }

  private apply(entry: JournalEntry, persist: boolean): void {
    for (const line of entry.lines) {
      const acct = this.accounts.get(line.accountId);
      if (!acct) throw new Error(`missing account ${line.accountId}`);
      const signed = signedDelta(acct.type, line.debit, line.credit);
      this.balances.set(line.accountId, (this.balances.get(line.accountId) ?? 0) + signed);
    }
    this.entries.push(entry);
    if (persist && this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { flag: "a" });
    }
  }
}

/** Asset/expense increase on debit. Liability/equity/revenue increase on credit. */
export function signedDelta(type: AccountType, debit: number, credit: number): number {
  const normalDebit = type === "asset" || type === "expense";
  return normalDebit ? debit - credit : credit - debit;
}

export const ESCROW_BOOK_PREFIX = "escrow:";

/**
 * Operating cash (agent USD/USDC, MM inventory). Not equity, not hire escrow.
 * `ledger.transfer` may only move between these books.
 */
export function isOperatingBook(account: { type: AccountType; name: string }): boolean {
  return account.type === "asset" && !account.name.startsWith(ESCROW_BOOK_PREFIX);
}
