import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { fundHire, offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import { SIM_RAIL } from "@aether/settlement";
import { PROTOCOL } from "@aether/types";
import type { HireContract, MandateId } from "@aether/types";

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
    expect(PROTOCOL.version).toBe("0.9.0");
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
