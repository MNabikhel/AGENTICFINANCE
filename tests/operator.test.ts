import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { fundHire, offerHire, completeHire } from "../packages/aether-runtime/src/hire-flow.ts";
import { SIM_RAIL } from "@aether/settlement";
import { PROTOCOL } from "@aether/types";
import type { HireContract, JournalEntry, MandateId } from "@aether/types";

function boot(dataDir?: string) {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISOPER0000001",
    dailyLimit: 10_000_000,
    ...(dataDir ? { dataDir } : {}),
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

function economy(rt: Runtime) {
  must(
    rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    ),
    "founder",
  );
  const founder = rt.alias("ops-human");
  for (const a of [
    { key: "treasury", displayName: "Treasury", role: "treasury", autonomyLevel: 3 },
    { key: "procurement", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  rt.seedOpening({
    "procurement:cash": { amount: 1_500_000, currency: "USD_SIM" },
    "treasury:cash": { amount: 5_000_000, currency: "USD_SIM" },
  });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
          { type: "payment.budget", currency: "USD_SIM", max: 1_000_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
        ],
      }),
    ),
    "intent",
  );
  return {
    founder,
    desk,
    vendor,
    intentId: (intent.data as { payload: { id: MandateId } }).payload.id,
  };
}

describe("SIM_RAIL", () => {
  it("is a simulated rail that live adapters must not replace evaluate() with", () => {
    expect(SIM_RAIL.live).toBe(false);
    expect(SIM_RAIL.id).toBe(PROTOCOL.rail);
    expect(PROTOCOL.liveMoney).toBe(false);
    expect(PROTOCOL.version).toBe("0.72.0");
  });
});

describe("command idempotency", () => {
  it("replays identity.register with the same body and does not mint a second account", () => {
    const rt = boot();
    const body = { key: "ops-human", displayName: "Founder", role: "human_operator", autonomyLevel: 0 };
    const first = must(rt.dispatch(cmd("identity.register", "system", body)), "first register");
    const auditAfterFirst = rt.audit.length;
    const second = rt.dispatch(cmd("identity.register", "system", body));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.replayed).toBe(true);
    expect((second.value.data as { id: string }).id).toBe((first.data as { id: string }).id);
    expect(rt.identity.all()).toHaveLength(1);
    expect(rt.audit.length).toBe(auditAfterFirst);
  });

  it("replays hire.create so a retry does not mint a second contract", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const first = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(first.attempt.ok).toBe(true);
    if (!first.attempt.ok) return;
    const hireId = (first.attempt.value.data as HireContract).id;
    const again = rt.dispatch(cmd("hire.create", desk.id, { quoteId: first.quoteId, intentId }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.replayed).toBe(true);
    expect((again.value.data as HireContract).id).toBe(hireId);
    expect([...rt.hires.values()].filter((h) => h.quoteId === first.quoteId)).toHaveLength(1);
  });

  it("does not cache denies, so a typed remediation can be retried after the world changes", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const invited = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "too expensive",
      price: { amount: 640_000, currency: "USD_SIM" },
      intentId,
    });
    expect(invited.attempt.ok).toBe(false);
    if (invited.attempt.ok) return;
    expect(invited.attempt.error.decision.remediation?.kind).toBe("issue_intent");
    expect(invited.attempt.error.error.extra?.remediation?.kind).toBe("issue_intent");
    const auditAfterDeny = rt.audit.length;
    const retry = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error.decision.remediation?.kind).toBe("issue_intent");
    expect(rt.audit.length).toBeGreaterThan(auditAfterDeny);
  });

  it("restores the idempotency map from a durable world", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-idem-"));
    try {
      const a = boot(dir);
      const body = { key: "ops-human", displayName: "Founder", role: "human_operator", autonomyLevel: 0 };
      const first = must(a.dispatch(cmd("identity.register", "system", body)), "register");
      const b = boot(dir);
      const again = b.dispatch(cmd("identity.register", "system", body));
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.value.replayed).toBe(true);
      expect((again.value.data as { id: string }).id).toBe((first.data as { id: string }).id);
      expect(b.identity.all()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("hire.refund", () => {
  it("returns escrow to the buyer, restores mandate spend, and is itself idempotent", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    const cashBefore = rt.ledger.balanceByName("procurement:cash").amount;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cashBefore - 80_000);
    expect(rt.spentByIntent.get(intentId as MandateId)).toBe(80_000);
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("funded");

    const refund = rt.dispatch(cmd("hire.refund", desk.id, { hireId }));
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    expect((refund.value.data as HireContract).state).toBe("refunded");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("refunded");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cashBefore);
    expect(rt.ledger.balance(rt.hires.get(hireId as HireContract["id"])!.escrowAccountId)).toBe(0);
    expect(rt.spentByIntent.get(intentId as MandateId)).toBe(0);

    const again = rt.dispatch(cmd("hire.refund", desk.id, { hireId }));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.replayed).toBe(true);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cashBefore);
  });
});

const GHOST_BOOK = "nobody:cash";
const GHOST_ACCT = "acct_01J6AETHERGHOSTACCT0000001";

describe("ledger.known_account", () => {
  it("refuses a treasury allocation to a missing book as ledger.known_account, not a mutate throw", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const clockBefore = rt.clock.now();
    const journalsBefore = rt.journals.length;
    const treasuryBefore = rt.ledger.balanceByName("treasury:cash").amount;
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: GHOST_BOOK,
        amount: { amount: 1000, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.known_account");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.journals.length).toBe(journalsBefore);
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(treasuryBefore);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("missing book"))).toBe(true);
  });

  it("refuses a transfer from a missing book as ledger.known_account", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: GHOST_BOOK,
        toAccount: "procurement:cash",
        amount: { amount: 1000, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.known_account");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(1_500_000);
  });

  it("still allocates when both books exist", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const r = must(
      rt.dispatch(
        cmd("ledger.transfer", treasury.id, {
          fromAccount: "treasury:cash",
          toAccount: "procurement:cash",
          amount: { amount: 1_000, currency: "USD_SIM" },
        }),
      ),
      "allocate",
    );
    expect((r.data as { description: string }).description).toContain("treasury:cash");
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(4_999_000);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(1_501_000);
  });

  it("refuses a named balance of a missing book as ledger.known_account, not a zero", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = rt.dispatch(cmd("ledger.balances", founder.id, { name: GHOST_BOOK }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.known_account");
  });

  it("refuses a balance by a missing account id as ledger.known_account, not a silent zero", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = rt.dispatch(cmd("ledger.balances", founder.id, { accountId: GHOST_ACCT }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.known_account");
  });
});

describe("ledger.same_currency", () => {
  it("refuses USD into a USDC book as ledger.same_currency, not a mutate throw", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const clockBefore = rt.clock.now();
    const journalsBefore = rt.journals.length;
    const treasuryBefore = rt.ledger.balanceByName("treasury:cash").amount;
    const usdcBefore = rt.ledger.balanceByName("vendor:usdc").amount;
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "vendor:usdc",
        amount: { amount: 1000, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.same_currency");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.journals.length).toBe(journalsBefore);
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(treasuryBefore);
    expect(rt.ledger.balanceByName("vendor:usdc").amount).toBe(usdcBefore);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("mix currencies"))).toBe(true);
  });

  it("refuses a USDC label on USD books as ledger.same_currency, not a silent relabel", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "procurement:cash",
        amount: { amount: 1000, currency: "USDC_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.same_currency");
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(5_000_000);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(1_500_000);
  });
});

describe("ledger.sufficient", () => {
  it("refuses an overdraft as ledger.sufficient, not a negative book", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const clockBefore = rt.clock.now();
    const journalsBefore = rt.journals.length;
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "procurement:cash",
        amount: { amount: 5_000_001, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.sufficient");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.journals.length).toBe(journalsBefore);
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(5_000_000);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(1_500_000);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("overdraw"))).toBe(true);
  });

  it("still drains a book to zero when the source covers the amount", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    must(
      rt.dispatch(
        cmd("ledger.transfer", treasury.id, {
          fromAccount: "treasury:cash",
          toAccount: "procurement:cash",
          amount: { amount: 5_000_000, currency: "USD_SIM" },
        }),
      ),
      "drain",
    );
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(0);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(6_500_000);
  });
});

describe("ledger.safe_balance", () => {
  it("refuses a dest that cannot hold the cents as ledger.safe_balance, not silent IEEE rounding", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    // Restore still applies historical journals without the post() gate so old worlds boot.
    // A dest already at MAX_SAFE_INTEGER plus one more cent must be a refuse, not IEEE rounding.
    const dest = rt.ledger.account("procurement:cash");
    const equity = rt.ledger.account("system:equity");
    const already = rt.ledger.balance(dest.id);
    rt.ledger.restore([...rt.ledger.accounts.values()], [
      ...rt.ledger.entries,
      {
        id: "jnl_01J6AETHEROVERFLOWSETUP00001" as JournalEntry["id"],
        timestamp: rt.clock.now(),
        description: "test: dest already at MAX_SAFE_INTEGER",
        lines: [
          { accountId: dest.id, debit: Number.MAX_SAFE_INTEGER - already, credit: 0 },
          { accountId: equity.id, debit: 0, credit: Number.MAX_SAFE_INTEGER - already },
        ],
      },
    ]);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(Number.MAX_SAFE_INTEGER);
    const clockBefore = rt.clock.now();
    const journalsBefore = rt.journals.length;
    const entriesBefore = rt.ledger.entries.length;
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "procurement:cash",
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.same_currency")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.safe_balance");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.journals.length).toBe(journalsBefore);
    expect(rt.ledger.entries.length).toBe(entriesBefore);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(5_000_000);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("cannot hold"))).toBe(true);
  });

  it("still names ledger.sufficient first when the source cannot cover the amount", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const dest = rt.ledger.account("procurement:cash");
    const equity = rt.ledger.account("system:equity");
    const already = rt.ledger.balance(dest.id);
    rt.ledger.restore([...rt.ledger.accounts.values()], [
      ...rt.ledger.entries,
      {
        id: "jnl_01J6AETHEROVERFLOWSETUP00002" as JournalEntry["id"],
        timestamp: rt.clock.now(),
        description: "test: dest already at MAX_SAFE_INTEGER",
        lines: [
          { accountId: dest.id, debit: Number.MAX_SAFE_INTEGER - already, credit: 0 },
          { accountId: equity.id, debit: 0, credit: Number.MAX_SAFE_INTEGER - already },
        ],
      },
    ]);
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "procurement:cash",
        amount: { amount: 5_000_001, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.sufficient");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("allow");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(5_000_000);
  });
});

describe("ledger.operating_book", () => {
  it("refuses a transfer from equity as ledger.operating_book, not a mint", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const equityBefore = rt.ledger.balanceByName("system:equity").amount;
    const cashBefore = rt.ledger.balanceByName("procurement:cash").amount;
    const clockBefore = rt.clock.now();
    const journalsBefore = rt.journals.length;
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "system:equity",
        toAccount: "procurement:cash",
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.safe_balance")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.known_account")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.operating_book");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.journals.length).toBe(journalsBefore);
    expect(rt.ledger.balanceByName("system:equity").amount).toBe(equityBefore);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cashBefore);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("not a mint"))).toBe(true);
  });

  it("refuses a transfer out of escrow as ledger.operating_book, not an allocation", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    const escrowName = `escrow:${hireId}`;
    const escrowBefore = rt.ledger.balanceByName(escrowName).amount;
    const treasuryBefore = rt.ledger.balanceByName("treasury:cash").amount;
    expect(escrowBefore).toBe(80_000);
    const treasury = rt.alias("treasury");
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: escrowName,
        toAccount: "treasury:cash",
        amount: { amount: 80_000, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.operating_book");
    expect(rt.ledger.balanceByName(escrowName).amount).toBe(escrowBefore);
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(treasuryBefore);
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("funded");
    expect(rt.story.some((b) => b.headline.includes("escrow is not an allocation"))).toBe(true);
  });

  it("still names ledger.sufficient first when operating cash cannot cover the amount", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    const r = rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "procurement:cash",
        amount: { amount: 5_000_001, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("ledger.sufficient");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.operating_book")?.verdict).toBe("allow");
    expect(rt.ledger.balanceByName("treasury:cash").amount).toBe(5_000_000);
  });
});

describe("constraint values at the shape gate", () => {
  it("refuses an amount_range with no max as command.malformed, not an open checkbook", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const clockBefore = rt.clock.now();
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "uncapped",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(400);
    expect(r.error.error.type).toContain("command.malformed");
    expect(r.error.error.detail).toContain("constraints[0].max");
    expect(r.error.decision).toBeUndefined();
    expect(rt.intents.size).toBe(before);
    expect(rt.clock.now()).toBe(clockBefore);
  });
});

describe("idempotency.nonce", () => {
  it("does not name a settled envelope nonce on a transfer that happens to carry one", () => {
    const rt = boot();
    economy(rt);
    const treasury = rt.alias("treasury");
    rt.nonces.add("settled-envelope");
    const cashBefore = rt.ledger.balanceByName("procurement:cash").amount;
    const r = must(
      rt.dispatch(
        cmd("ledger.transfer", treasury.id, {
          fromAccount: "procurement:cash",
          toAccount: "vendor:cash",
          amount: { amount: 1, currency: "USD_SIM" },
          nonce: "settled-envelope",
        }),
      ),
      "transfer with leftover nonce",
    );
    expect(r.decision.trace.find((t) => t.ruleId === "idempotency.nonce")?.verdict).toBe("allow");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cashBefore - 1);
    expect(rt.nonces.has("settled-envelope")).toBe(true);
    expect(rt.nonces.size).toBe(1);
  });

  it("still names idempotency.nonce first when envelope.submit reuses a settled nonce", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const first = completeHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "first settle",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
      qty: 1,
      deliverable: { ok: true },
    });
    const stolen = `nonce-${first.hireId}`;
    expect(rt.nonces.has(stolen)).toBe(true);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "second settle",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    const created = must(offered.attempt, "second hire");
    const hireId = (created.data as HireContract).id;
    fundHire(rt, {
      hireId,
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      intentId,
      qty: 1,
      unitAmount: 80_000,
    });
    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { ok: true } })), "deliver");
    must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
    const before = rt.hires.get(hireId)?.state;
    const r = rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: stolen }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("idempotency.nonce");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "idempotency.nonce")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.state")?.verdict).toBe("allow");
    expect(rt.hires.get(hireId)?.state).toBe(before);
    expect(rt.nonces.size).toBe(1);
  });
});
