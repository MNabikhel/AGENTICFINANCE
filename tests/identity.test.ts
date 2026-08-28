import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";

const GHOST = "aid_01J6AETHERGHOSTAGEN0000001";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISID0000000001",
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
    { key: "procurement", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
      }),
    ),
    "intent",
  );
  return {
    founder,
    desk,
    vendor,
    intentId: (intent.data as { payload: { id: string } }).payload.id,
  };
}

function deniedKnown(r: ReturnType<Runtime["dispatch"]>) {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error.error.status).toBe(422);
  expect(r.error.error.type).toContain("policy.deny");
  expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
  expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
  expect(r.error.decision?.remediation?.kind).toBe("none");
}

describe("known agent", () => {
  it("refuses to freeze a missing agent as identity.known, not a mutate throw", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("identity.freeze", founder.id, { agentId: GHOST }));
    deniedKnown(r);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses to unfreeze a missing agent as identity.known", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = rt.dispatch(cmd("identity.unfreeze", founder.id, { agentId: GHOST }));
    deniedKnown(r);
  });

  it("refuses to set a ladder on a missing agent as identity.known", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = rt.dispatch(cmd("ladder.set", founder.id, { agentId: GHOST, to: 1 }));
    deniedKnown(r);
  });

  it("refuses to attest a missing delegate as identity.known, not a missing handshake", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: GHOST, maxAutonomy: 3 }));
    deniedKnown(r);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
  });

  it("refuses a cart against a missing merchant as identity.known, not a mutate throw", () => {
    const rt = boot();
    const { desk, intentId } = economy(rt);
    const r = rt.dispatch(
      cmd("mandate.issue_cart", desk.id, {
        intentId,
        merchantId: GHOST,
        line_items: [
          {
            sku: "research.brief",
            description: "one pager",
            quantity: 1,
            unitAmount: { amount: 80_000, currency: "USD_SIM" },
          },
        ],
      }),
    );
    deniedKnown(r);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_intent")?.verdict).toBe("allow");
  });

  it("refuses a permission slip whose subject is missing as identity.known", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const before = rt.intents.size;
    const r = rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: GHOST,
        task: "slip for nobody",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100 }],
      }),
    );
    deniedKnown(r);
    expect(rt.intents.size).toBe(before);
  });
});
