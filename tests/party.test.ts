import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { fundHire, offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import type { HireContract, MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISPARTY0000001",
    dailyLimit: 10_000_000,
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
    { key: "procurement-b", displayName: "Other Desk", role: "procurement", autonomyLevel: 3 },
    { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "vendor-b", displayName: "Other Vendor", role: "data_vendor", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  rt.seedOpening({ "procurement:cash": { amount: 1_500_000, currency: "USD_SIM" } });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max: 500_000 },
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
    desk,
    deskB: rt.alias("procurement-b"),
    vendor,
    vendorB: rt.alias("vendor-b"),
    treasury: rt.alias("treasury"),
    intentId: (intent.data as { payload: { id: MandateId } }).payload.id,
  };
}

function offeredHire(rt: Runtime) {
  const { desk, deskB, vendor, vendorB, treasury, intentId } = economy(rt);
  const offered = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "one pager",
    price: { amount: 80_000, currency: "USD_SIM" },
    intentId,
  });
  if (!offered.attempt.ok) throw new Error("expected hire.create allow");
  const hireId = (offered.attempt.value.data as HireContract).id;
  return { desk, deskB, vendor, vendorB, treasury, intentId, hireId };
}

function fundedHire(rt: Runtime) {
  const live = offeredHire(rt);
  fundHire(rt, {
    hireId: live.hireId,
    buyer: live.desk.id,
    seller: live.vendor.id,
    sku: "research.brief",
    intentId: live.intentId,
    qty: 1,
    unitAmount: 80_000,
  });
  return live;
}

describe("hire party", () => {
  it("refuses a different seller accepting as hire.party, not a mutate throw", () => {
    const rt = boot();
    const { vendorB, hireId } = offeredHire(rt);
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("hire.accept", vendorB.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("hire.party");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("offered");
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses a different seller delivering as hire.party", () => {
    const rt = boot();
    const { vendorB, hireId } = fundedHire(rt);
    const r = rt.dispatch(cmd("hire.deliver", vendorB.id, { hireId, deliverable: { ok: true } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("deny");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("funded");
  });

  it("refuses a different seller requiring payment as hire.party", () => {
    const rt = boot();
    const { vendorB, hireId } = fundedHire(rt);
    const r = rt.dispatch(cmd("envelope.require", vendorB.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("deny");
  });

  it("refuses a different buyer refunding as hire.party", () => {
    const rt = boot();
    const { deskB, hireId } = fundedHire(rt);
    const cash = rt.ledger.balanceByName("procurement:cash").amount;
    const r = rt.dispatch(cmd("hire.refund", deskB.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("funded");
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(cash);
  });

  it("refuses a different buyer releasing as hire.party", () => {
    const rt = boot();
    const { desk, deskB, vendor, hireId } = fundedHire(rt);
    must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { ok: true } })), "deliver");
    const r = rt.dispatch(cmd("hire.release", deskB.id, { hireId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "hire.party")?.verdict).toBe("deny");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("delivered");
    must(rt.dispatch(cmd("hire.release", desk.id, { hireId })), "release");
    expect(rt.hires.get(hireId as HireContract["id"])?.state).toBe("released");
  });
});
