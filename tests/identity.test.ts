import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";

const GHOST = "aid_01J6AETHERGHOSTAGEN0000001";
const GHOST_PARENT = "dlg_01J6AETHERGHOSTPARENT00001";

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

  it("refuses to attest a missing principal as identity.known, not a handshake with nobody", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, principalId: GHOST, maxAutonomy: 3 }),
    );
    deniedKnown(r);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("refuses to revoke a missing agent as identity.known, not a silent tombstone", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = rt.dispatch(cmd("kya.revoke", founder.id, { delegateId: GHOST }));
    deniedKnown(r);
    expect(rt.kya.blocked.size).toBe(0);
  });
});

describe("kya.not_self", () => {
  it("refuses to attest yourself as kya.not_self, not a mutate throw", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const clockBefore = rt.clock.now();
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: founder.id, maxAutonomy: 3 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.not_self");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("kya.known_parent", () => {
  it("refuses a nested handshake against a missing parent hop as kya.known_parent, not a live mint", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const clockBefore = rt.clock.now();
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, parentId: GHOST_PARENT, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.known_parent")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.known_parent");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("still allows a nested handshake when the parent hop is live", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const parent = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
      "parent hop",
    );
    const parentId = (parent.data as { id: string }).id;
    const before = rt.kya.attestations.size;
    const r = must(
      rt.dispatch(
        cmd("kya.attest", founder.id, { delegateId: vendor.id, parentId, maxAutonomy: 2 }),
      ),
      "nested hop",
    );
    expect((r.data as { parentId?: string }).parentId).toBe(parentId);
    expect(rt.kya.attestations.size).toBe(before + 1);
  });
});
