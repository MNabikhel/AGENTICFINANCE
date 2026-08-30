import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { KYA_TTL_MS, type AccountId } from "@aether/types";

const GHOST = "aid_01J6AETHERGHOSTAGEN0000001";
const GHOST_PARENT = "dlg_01J6AETHERGHOSTPARENT00001";
const GHOST_ATT = "dlg_01J6AETHERGHOSTATTEST00001";

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

  it("refuses to rotate a missing agent as identity.known, not a stolen lock", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = rt.dispatch(cmd("identity.rotate", founder.id, { agentId: GHOST }));
    deniedKnown(r);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.party")?.verdict).toBe("allow");
  });

  it("refuses a vendor turning the desk's lock as identity.party", () => {
    const rt = boot();
    const { desk, vendor } = economy(rt);
    const before = rt.identity.require(desk.id).keys[0]?.kid;
    const r = rt.dispatch(cmd("identity.rotate", vendor.id, { agentId: desk.id }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.not_frozen")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(rt.identity.require(desk.id).keys[0]?.kid).toBe(before);
    expect(rt.audit.all().some((e) => e.action === "IDENTITY_ROTATE")).toBe(false);
  });

  it("lets a desk turn its own lock", () => {
    const rt = boot();
    const { desk } = economy(rt);
    const before = rt.identity.require(desk.id).keys[0]?.kid;
    const r = rt.dispatch(cmd("identity.rotate", desk.id, {}));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = rt.identity.require(desk.id);
    expect(after.keys[0]?.kid).not.toBe(before);
    expect(after.keys[1]?.kid).toBe(before);
    expect(rt.audit.all().some((e) => e.action === "IDENTITY_ROTATE")).toBe(true);
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

  it("refuses an RFQ that invites a missing seller as identity.known, not a closed room", () => {
    const rt = boot();
    const { desk } = economy(rt);
    const before = rt.rfqs.size;
    const r = rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "one pager",
        invitedSellerIds: [GHOST],
      }),
    );
    deniedKnown(r);
    expect(rt.rfqs.size).toBe(before);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "market.known_sku")?.verdict).toBe("allow");
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
    expect(r.decision.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
  });
});

describe("kya.parent_fresh", () => {
  const DEAD = "2020-01-01T00:00:00.000Z";
  const FAR = "2099-01-01T00:00:00.000Z";
  const NOON = "2026-08-28T12:00:00.000Z";

  function expireParent(rt: Runtime) {
    const { founder, desk, vendor } = economy(rt);
    const parent = must(
      rt.dispatch(
        cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3, expiresAt: NOON }),
      ),
      "parent hop",
    );
    rt.clock.set("2026-08-29T00:00:00.000Z");
    return { founder, desk, vendor, parentId: (parent.data as { id: string }).id };
  }

  it("refuses a nested handshake under an expired parent hop as kya.parent_fresh, not a live mint", () => {
    const rt = boot();
    const { founder, vendor, parentId } = expireParent(rt);
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: vendor.id, parentId, maxAutonomy: 2 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.parent_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.parent_fresh");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("dead parent"))).toBe(true);
  });

  it("refuses a nested handshake under a revoked parent hop as kya.parent_fresh", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const parent = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
      "parent hop",
    );
    const parentId = (parent.data as { id: string }).id;
    must(rt.dispatch(cmd("kya.revoke", founder.id, { attestationId: parentId })), "revoke parent");
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: vendor.id, parentId, maxAutonomy: 2 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.parent_fresh");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.unique_live first when the same pair also occupies under a dead parent", () => {
    const rt = boot();
    const { founder, desk, parentId } = expireParent(rt);
    const liveBefore = [...rt.kya.attestations.values()].filter((a) => !a.revokedAt).length;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, parentId, maxAutonomy: 2 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(liveBefore);
  });

  it("still names kya.mint_fresh first when the child hop is also born dead", () => {
    const rt = boot();
    const { founder, vendor, parentId } = expireParent(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: vendor.id, parentId, maxAutonomy: 2, expiresAt: DEAD }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.mint_fresh");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.mint_window first when the child hop would also outlive one year", () => {
    const rt = boot();
    const { founder, vendor, parentId } = expireParent(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: vendor.id, parentId, maxAutonomy: 2, expiresAt: FAR }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.mint_window");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.capability_subset first when L4 omit would also write L5 under a dead parent", () => {
    const rt = boot();
    const { founder, vendor, parentId } = expireParent(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id, parentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.capability_subset");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.known_parent first when the parent hop is missing", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, parentId: GHOST_PARENT, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.known_parent");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
  });
});

describe("kya.known_attestation", () => {
  it("refuses to revoke a missing handshake as kya.known_attestation, not a silent tombstone", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const live = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
      "attest",
    );
    const liveId = (live.data as { id: string }).id;
    const clockBefore = rt.clock.now();
    const blockedBefore = rt.kya.blocked.size;
    const r = rt.dispatch(cmd("kya.revoke", founder.id, { attestationId: GHOST_ATT }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.known_attestation")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.known_attestation");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect([...rt.kya.attestations.values()].find((a) => a.id === liveId)?.revokedAt).toBeUndefined();
    expect([...rt.kya.attestations.values()].every((a) => !a.revokedAt)).toBe(true);
    expect(rt.kya.blocked.size).toBe(blockedBefore);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("still revokes when the named handshake belongs to this principal", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const live = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
      "attest",
    );
    const liveId = (live.data as { id: string }).id;
    const r = must(rt.dispatch(cmd("kya.revoke", founder.id, { attestationId: liveId })), "revoke by id");
    expect((r.data as { revoked: Array<{ id: string }> }).revoked.map((a) => a.id)).toEqual([liveId]);
    expect([...rt.kya.attestations.values()].find((a) => a.id === liveId)?.revokedAt).toBeTruthy();
  });

  it("refuses to revoke someone else’s handshake by id as kya.known_attestation", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "treasury",
          displayName: "Treasury",
          role: "treasury",
          autonomyLevel: 3,
        }),
      ),
      "treasury",
    );
    const treasury = rt.alias("treasury");
    const live = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 3 })),
      "attest",
    );
    const liveId = (live.data as { id: string }).id;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("kya.revoke", treasury.id, { attestationId: liveId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.known_attestation")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.known_attestation");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect([...rt.kya.attestations.values()].find((a) => a.id === liveId)?.revokedAt).toBeUndefined();
    expect(rt.kya.blocked.size).toBe(0);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("kya.party", () => {
  it("refuses an L4 desk minting a founder handshake as kya.party", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, principalId: founder.id, maxAutonomy: 4 })), "handshake scout");
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("kya.attest", scout.id, { delegateId: vendor.id, principalId: founder.id, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.party");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses an L4 desk tombstoning a founder handshake as kya.party", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 3 })), "attest");
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("kya.revoke", scout.id, { principalId: founder.id, delegateId: desk.id }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.known_attestation")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.party");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect([...rt.kya.attestations.values()].every((a) => !a.revokedAt)).toBe(true);
    expect(rt.kya.blocked.size).toBe(0);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("still lets treasury tombstone a founder handshake by naming the principal", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "treasury",
          displayName: "Treasury",
          role: "treasury",
          autonomyLevel: 3,
        }),
      ),
      "treasury",
    );
    const treasury = rt.alias("treasury");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 3 })), "attest");
    const r = must(
      rt.dispatch(cmd("kya.revoke", treasury.id, { principalId: founder.id, delegateId: desk.id })),
      "treasury kill switch",
    );
    expect((r.data as { revoked: Array<{ id: string }> }).revoked).toHaveLength(1);
    expect([...rt.kya.attestations.values()].some((a) => a.revokedAt)).toBe(true);
  });
});

describe("identity.unique_key", () => {
  it("refuses a new body that reuses an alias as identity.unique_key, not a journal throw", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.identity.all().length;
    const aliasBefore = rt.aliases.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "procurement",
        displayName: "Other Desk",
        role: "procurement",
        autonomyLevel: 3,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.unique_key");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.identity.all()).toHaveLength(before);
    expect(rt.aliases.size).toBe(aliasBefore);
    expect(rt.alias("procurement").id).toBe(desk.id);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses a second market maker as identity.unique_key because they share one cash book", () => {
    const rt = boot();
    const { founder } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "mm-a",
          displayName: "Maker A",
          role: "market_maker",
          autonomyLevel: 2,
        }),
      ),
      "mm-a",
    );
    const before = rt.identity.all().length;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "mm-b",
        displayName: "Maker B",
        role: "market_maker",
        autonomyLevel: 2,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.unique_key");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.identity.all()).toHaveLength(before);
    expect(rt.aliases.has("mm-b")).toBe(false);
    expect(rt.ledger.accountsByName.has("market_maker:cash_usd")).toBe(true);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses a data vendor whose USDC book is already open as identity.unique_key, not account exists after yes", () => {
    const rt = boot();
    const { founder } = economy(rt);
    rt.ledger.openAccount({
      id: "acct_01J6AETHERGHOSTUSDC0000001" as AccountId,
      ownerId: "system",
      name: "ghost:usdc",
      type: "asset",
      currency: "USDC_SIM",
    });
    const before = rt.identity.all().length;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "ghost",
        displayName: "Ghost Vendor",
        role: "data_vendor",
        autonomyLevel: 2,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.unique_key");
    expect(rt.identity.all()).toHaveLength(before);
    expect(rt.aliases.has("ghost")).toBe(false);
    expect(rt.ledger.accountsByName.has("ghost:cash")).toBe(false);
    expect(rt.ledger.account("ghost:usdc").ownerId).toBe("system");
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("USDC books belong to the agent", () => {
  it("assigns vendor and market-maker USDC wallets to the agent, not system", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
    expect(rt.ledger.account("vendor:usdc").ownerId).toBe(vendor.id);
    expect(rt.ledger.account("vendor:cash").ownerId).toBe(vendor.id);
    expect(rt.ledger.account("procurement:cash").ownerId).toBe(rt.alias("procurement").id);
    expect(rt.ledger.account("system:equity").ownerId).toBe("system");
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "mm",
          displayName: "Maker",
          role: "market_maker",
          autonomyLevel: 2,
        }),
      ),
      "mm",
    );
    const mm = rt.alias("mm");
    expect(rt.ledger.account("market_maker:cash_usd").ownerId).toBe(mm.id);
    expect(rt.ledger.account("market_maker:cash_usdc").ownerId).toBe(mm.id);
  });
});

describe("ladder.birth_rung", () => {
  it("refuses registering an agent at L5 as ladder.birth_rung, not a freeze skip", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const before = rt.identity.all().length;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "night-watch",
        displayName: "Night Watch",
        role: "procurement",
        autonomyLevel: 5,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ladder.birth_rung")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ladder.legal")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ladder.birth_rung");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.identity.all()).toHaveLength(before);
    expect(rt.aliases.has("night-watch")).toBe(false);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("cannot mint L5"))).toBe(true);
  });

  it("still registers at L4", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    expect((r.data as { autonomyLevel: number }).autonomyLevel).toBe(4);
  });

  it("still names identity.unique_key first when L5 would also collide", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.identity.all().length;
    const r = rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "procurement",
        displayName: "Other Desk",
        role: "procurement",
        autonomyLevel: 5,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ladder.birth_rung")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.unique_key");
    expect(rt.identity.all()).toHaveLength(before);
    expect(rt.alias("procurement").id).toBe(desk.id);
    expect(rt.alias("procurement").autonomyLevel).toBe(3);
  });

  it("refuses the first human at L5 as ladder.birth_rung, not a bootstrap skip", () => {
    const rt = boot();
    const r = rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 5,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ladder.birth_rung")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ladder.birth_rung");
    expect(rt.identity.all()).toHaveLength(0);
  });
});

describe("identity.freeze_state", () => {
  it("refuses to unfreeze a live unfrozen agent as identity.freeze_state, not a notary line after yes", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("identity.unfreeze", founder.id, { agentId: desk.id }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.freeze_state")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.freeze_state");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.identity.get(desk.id)?.frozen).toBe(false);
    expect(rt.killSwitchTested.has(desk.id)).toBe(false);
    expect(rt.audit.query({ action: "UNFREEZE", subjectId: desk.id }).matched).toBe(0);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses a second freeze as identity.freeze_state, not a second FREEZE line", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(rt.dispatch(cmd("identity.freeze", founder.id, { agentId: desk.id })), "freeze");
    expect(rt.identity.get(desk.id)?.frozen).toBe(true);
    expect(rt.audit.query({ action: "FREEZE", subjectId: desk.id }).matched).toBe(1);
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("identity.freeze", founder.id, { agentId: desk.id }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.freeze_state")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.freeze_state");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.identity.get(desk.id)?.frozen).toBe(true);
    expect(rt.audit.query({ action: "FREEZE", subjectId: desk.id }).matched).toBe(1);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("kya.unique_live", () => {
  it("refuses a second live handshake for the same pair as kya.unique_live, not a tighter grant", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 4 })), "attest");
    const liveBefore = [...rt.kya.attestations.values()].filter((a) => !a.revokedAt).length;
    const attestBefore = rt.audit.query({ action: "KYA_ATTEST", subjectId: desk.id }).matched;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 2 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(liveBefore);
    expect(rt.audit.query({ action: "KYA_ATTEST", subjectId: desk.id }).matched).toBe(attestBefore);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("still attests again after revoke", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })), "attest");
    must(rt.dispatch(cmd("kya.revoke", founder.id, { delegateId: desk.id })), "revoke");
    const again = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
      "re-attest",
    );
    expect((again.data as { maxAutonomy: number }).maxAutonomy).toBe(3);
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(1);
  });

  it("refuses a grant below the desk as kya.grant_fresh, not a live mint", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 2 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.cap_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.grant_fresh");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});

describe("kya.nest_tighter", () => {
  it("refuses a nested grant wider than its parent as kya.nest_tighter, not a live mint", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const parent = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
      "parent hop",
    );
    const parentId = (parent.data as { id: string }).id;
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: vendor.id, parentId, maxAutonomy: 4 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.known_parent")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "mandate.child_tighter")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.nest_tighter");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses an omitted nested ceiling under a tighter parent as kya.nest_tighter", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const parent = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
      "parent hop",
    );
    const parentId = (parent.data as { id: string }).id;
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: vendor.id, parentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.nest_tighter");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.grant_fresh first when a nested grant is also below the desk", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 3,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    const parent = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, maxAutonomy: 3 })),
      "parent hop",
    );
    const parentId = (parent.data as { id: string }).id;
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, parentId, maxAutonomy: 2 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.grant_fresh");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.parent_fresh first when a dead parent is also a wider nested grant", () => {
    const rt = boot();
    const { founder, desk, vendor } = economy(rt);
    const parent = must(
      rt.dispatch(
        cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3, expiresAt: "2026-08-28T12:00:00.000Z" }),
      ),
      "parent hop",
    );
    rt.clock.set("2026-08-29T00:00:00.000Z");
    const parentId = (parent.data as { id: string }).id;
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: vendor.id, parentId, maxAutonomy: 4 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.parent_fresh");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });
});

describe("kya.path_tighter", () => {
  it("refuses a grant wider than the incoming hop as kya.path_tighter, not a live mint", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "hop-a",
          displayName: "Hop A",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
      "hop-a",
    );
    const hopA = rt.alias("hop-a");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: hopA.id, maxAutonomy: 3 })), "incoming");
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("kya.attest", hopA.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 4 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.path_tighter");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses an omitted path ceiling under a tighter incoming hop as kya.path_tighter", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "hop-a",
          displayName: "Hop A",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
      "hop-a",
    );
    const hopA = rt.alias("hop-a");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: hopA.id, maxAutonomy: 3 })), "incoming");
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", hopA.id, { delegateId: desk.id, principalId: founder.id }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.path_tighter");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.grant_fresh first when a path grant is also below the desk", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "hop-a",
          displayName: "Hop A",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
      "hop-a",
    );
    const hopA = rt.alias("hop-a");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: hopA.id, maxAutonomy: 3 })), "incoming");
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", hopA.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 2 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.grant_fresh");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.nest_tighter first when a nested grant is also wider than the incoming hop", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "hop-a",
          displayName: "Hop A",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
      "hop-a",
    );
    const hopA = rt.alias("hop-a");
    const incoming = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: hopA.id, maxAutonomy: 3 })),
      "incoming",
    );
    const parentId = (incoming.data as { id: string }).id;
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", hopA.id, {
        delegateId: vendor.id,
        principalId: founder.id,
        parentId,
        maxAutonomy: 4,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.nest_tighter");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still mints when the speaker grants in their own name above an incoming hop they hold for someone else", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "hop-a",
          displayName: "Hop A",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
      "hop-a",
    );
    const hopA = rt.alias("hop-a");
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: hopA.id, maxAutonomy: 3 })), "incoming");
    const before = rt.kya.attestations.size;
    const r = must(
      rt.dispatch(cmd("kya.attest", hopA.id, { delegateId: desk.id, maxAutonomy: 4 })),
      "own-name grant",
    );
    expect((r.data as { principalId: string }).principalId).toBe(hopA.id);
    expect(r.decision.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before + 1);
  });
});

describe("kya.path_live", () => {
  function hopA(rt: Runtime) {
    const { founder, desk, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "hop-a",
          displayName: "Hop A",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
      "hop-a",
    );
    return { founder, desk, vendor, hopA: rt.alias("hop-a") };
  }

  it("refuses a hop in another principal's name with no live incoming path as kya.path_live, not a live mint", () => {
    const rt = boot();
    const { founder, desk, hopA: speaker } = hopA(rt);
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("kya.attest", speaker.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 4 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.nest_tighter")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.grant_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.path_live");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses an omitted path ceiling with no live incoming hop as kya.path_live", () => {
    const rt = boot();
    const { founder, desk, hopA: speaker } = hopA(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", speaker.id, { delegateId: desk.id, principalId: founder.id }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.path_live");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("refuses a hop after the incoming path expires as kya.path_live", () => {
    const rt = boot();
    const { founder, desk, hopA: speaker } = hopA(rt);
    must(
      rt.dispatch(
        cmd("kya.attest", founder.id, {
          delegateId: speaker.id,
          maxAutonomy: 3,
          expiresAt: "2026-08-28T12:00:00.000Z",
        }),
      ),
      "incoming",
    );
    rt.clock.set("2026-08-29T00:00:00.000Z");
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", speaker.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.path_live");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("refuses a hop after the incoming path is revoked as kya.path_live", () => {
    const rt = boot();
    const { founder, desk, hopA: speaker } = hopA(rt);
    const incoming = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: speaker.id, maxAutonomy: 3 })),
      "incoming",
    );
    must(
      rt.dispatch(cmd("kya.revoke", founder.id, { attestationId: (incoming.data as { id: string }).id })),
      "revoke incoming",
    );
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", speaker.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.path_live");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.parent_fresh")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.path_tighter first when a live incoming hop is also wider than the grant", () => {
    const rt = boot();
    const { founder, desk, hopA: speaker } = hopA(rt);
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: speaker.id, maxAutonomy: 3 })), "incoming");
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", speaker.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 4 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.path_tighter");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.party first when an L4 desk fills in the founder’s id without a live incoming hop", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", scout.id, { delegateId: vendor.id, principalId: founder.id, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.unique_live first when a second hop is also an orphan hop", () => {
    const rt = boot();
    const { founder, desk, hopA: speaker } = hopA(rt);
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })), "first");
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", speaker.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names identity.known first when a ghost principal would also be an orphan hop", () => {
    const rt = boot();
    const { desk, hopA: speaker } = hopA(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", speaker.id, { delegateId: desk.id, principalId: GHOST, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still mints when the speaker grants in their own name with no incoming hop", () => {
    const rt = boot();
    const { desk, hopA: speaker } = hopA(rt);
    const before = rt.kya.attestations.size;
    const r = must(
      rt.dispatch(cmd("kya.attest", speaker.id, { delegateId: desk.id, maxAutonomy: 4 })),
      "own-name grant",
    );
    expect((r.data as { principalId: string }).principalId).toBe(speaker.id);
    expect(r.decision.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before + 1);
  });

  it("still mints an exact path grant after a live incoming hop exists", () => {
    const rt = boot();
    const { founder, desk, hopA: speaker } = hopA(rt);
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: speaker.id, maxAutonomy: 3 })), "incoming");
    const before = rt.kya.attestations.size;
    const r = must(
      rt.dispatch(
        cmd("kya.attest", speaker.id, { delegateId: desk.id, principalId: founder.id, maxAutonomy: 3 }),
      ),
      "exact path grant",
    );
    expect(r.decision.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "kya.path_tighter")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before + 1);
  });
});

describe("kya.capability_subset", () => {
  it("refuses an L4 desk omitting maxAutonomy as kya.capability_subset, not an L5 grant", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("kya.attest", scout.id, { delegateId: vendor.id, principalId: scout.id }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.capability_subset");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("cannot grant a ceiling"))).toBe(true);
  });

  it("refuses an L4 desk naming maxAutonomy 5 as kya.capability_subset", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    const r = rt.dispatch(
      cmd("kya.attest", scout.id, { delegateId: vendor.id, principalId: scout.id, maxAutonomy: 5 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.capability_subset");
    expect(rt.kya.attestations.size).toBe(0);
  });

  it("still grants at the desk’s own rung", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    const r = must(
      rt.dispatch(
        cmd("kya.attest", scout.id, { delegateId: vendor.id, principalId: scout.id, maxAutonomy: 4 }),
      ),
      "grant L4",
    );
    expect((r.data as { maxAutonomy: number }).maxAutonomy).toBe(4);
  });

  it("still lets a founder omit maxAutonomy and write L5", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const r = must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id })), "omit");
    expect((r.data as { maxAutonomy: number }).maxAutonomy).toBe(5);
  });

  it("still names kya.unique_live first when L5 would also be an over-grant", () => {
    const rt = boot();
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    const scout = rt.alias("scout");
    must(
      rt.dispatch(
        cmd("kya.attest", scout.id, { delegateId: vendor.id, principalId: scout.id, maxAutonomy: 4 }),
      ),
      "first hop",
    );
    const before = [...rt.kya.attestations.values()].filter((a) => !a.revokedAt).length;
    const r = rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id, principalId: scout.id }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(before);
  });
});

describe("kya principal default", () => {
  function scoutDesk(rt: Runtime) {
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    return { founder, vendor, scout: rt.alias("scout") };
  }

  it("writes the speaker as principal when an L4 desk omits principalId", () => {
    const rt = boot();
    const { scout, vendor } = scoutDesk(rt);
    const r = must(
      rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id, maxAutonomy: 4 })),
      "omit principal",
    );
    expect((r.data as { principalId: string; grantorId: string }).principalId).toBe(scout.id);
    expect((r.data as { principalId: string; grantorId: string }).grantorId).toBe(scout.id);
    expect(r.decision.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "kya.chain_intact")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "kya.principal_not_frozen")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(1);
  });

  it("does not name a frozen founder when the desk omits principalId", () => {
    const rt = boot();
    const { founder, scout, vendor } = scoutDesk(rt);
    must(rt.dispatch(cmd("identity.freeze", founder.id, { agentId: founder.id })), "freeze founder");
    const before = rt.kya.attestations.size;
    const r = must(
      rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id, maxAutonomy: 4 })),
      "omit under freeze",
    );
    expect((r.data as { principalId: string }).principalId).toBe(scout.id);
    expect(r.decision.trace.find((t) => t.ruleId === "kya.principal_not_frozen")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before + 1);
  });

  it("still names kya.party first when the desk fills in the founder’s id", () => {
    const rt = boot();
    const { founder, scout, vendor } = scoutDesk(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", scout.id, { delegateId: vendor.id, principalId: founder.id, maxAutonomy: 3 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.capability_subset first when omit principalId would write L5", () => {
    const rt = boot();
    const { scout, vendor } = scoutDesk(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.capability_subset");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.party")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.unique_live first on a second omit hop", () => {
    const rt = boot();
    const { scout, vendor } = scoutDesk(rt);
    must(
      rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id, maxAutonomy: 4 })),
      "first hop",
    );
    const before = [...rt.kya.attestations.values()].filter((a) => !a.revokedAt).length;
    const r = rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id, maxAutonomy: 3 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.capability_subset")?.verdict).toBe("allow");
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(before);
  });
});

describe("kya.mint_fresh", () => {
  const DEAD = "2020-01-01T00:00:00.000Z";
  const FUTURE = "2027-08-28T00:00:00.000Z";

  function scoutDesk(rt: Runtime) {
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    return { founder, vendor, scout: rt.alias("scout") };
  }

  it("refuses a handshake born expired as kya.mint_fresh, not a written corpse", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, expiresAt: DEAD }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.not_self")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.mint_fresh");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("cannot mint a dead handshake"))).toBe(true);
  });

  it("refuses an unparseable expiresAt as kya.mint_fresh", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, expiresAt: "not-an-instant" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.mint_fresh");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still writes omit expiresAt as one year from createdAt", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const r = must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id })), "omit");
    const att = r.data as { expiresAt: string; createdAt: string };
    expect(Date.parse(att.expiresAt) - Date.parse(att.createdAt)).toBe(KYA_TTL_MS);
    expect(r.decision.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
  });

  it("still attests a future window", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const r = must(
      rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, expiresAt: FUTURE })),
      "future",
    );
    expect((r.data as { expiresAt: string }).expiresAt).toBe(FUTURE);
    expect(r.decision.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(r.decision.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
  });

  it("still names kya.unique_live first when a second hop is also born dead", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })), "first");
    const liveBefore = [...rt.kya.attestations.values()].filter((a) => !a.revokedAt).length;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 2, expiresAt: DEAD }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(liveBefore);
  });

  it("still names identity.known first when the delegate is missing", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: GHOST, expiresAt: DEAD }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.not_self first when attesting yourself with a dead window", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: founder.id, expiresAt: DEAD }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.not_self");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.capability_subset first when L4 omit would also write L5", () => {
    const rt = boot();
    const { scout, vendor } = scoutDesk(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id, expiresAt: DEAD }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.capability_subset");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.party first when the desk fills in the founder’s id", () => {
    const rt = boot();
    const { founder, scout, vendor } = scoutDesk(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(
      cmd("kya.attest", scout.id, {
        delegateId: vendor.id,
        principalId: founder.id,
        maxAutonomy: 3,
        expiresAt: DEAD,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.party");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.path_live")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });
});

describe("kya.mint_window", () => {
  const FAR = "2099-01-01T00:00:00.000Z";

  function scoutDesk(rt: Runtime) {
    const { founder, vendor } = economy(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "scout",
          displayName: "Scout",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "scout",
    );
    return { founder, vendor, scout: rt.alias("scout") };
  }

  it("refuses a handshake that outlives one year as kya.mint_window, not standing identity", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const before = rt.kya.attestations.size;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, expiresAt: FAR }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_fresh")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.unique_live")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.mint_window");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.kya.attestations.size).toBe(before);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("outlives one year"))).toBe(true);
  });

  it("still names kya.mint_fresh first when the window is already dead", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.mint_fresh");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("allow");
  });

  it("still names kya.unique_live first when a second hop would also outlive one year", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })), "first");
    const liveBefore = [...rt.kya.attestations.values()].filter((a) => !a.revokedAt).length;
    const r = rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 2, expiresAt: FAR }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(liveBefore);
  });

  it("still names identity.known first when the delegate is missing", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: GHOST, expiresAt: FAR }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });

  it("still names kya.capability_subset first when L4 omit would also write L5", () => {
    const rt = boot();
    const { scout, vendor } = scoutDesk(rt);
    const before = rt.kya.attestations.size;
    const r = rt.dispatch(cmd("kya.attest", scout.id, { delegateId: vendor.id, expiresAt: FAR }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.capability_subset");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "kya.mint_window")?.verdict).toBe("deny");
    expect(rt.kya.attestations.size).toBe(before);
  });
});

describe("kya graph view", () => {
  it("labels a hop expired after the window, and unique_live still occupies the pair", () => {
    const rt = boot();
    const { founder, desk } = economy(rt);
    must(
      rt.dispatch(
        cmd("kya.attest", founder.id, {
          delegateId: desk.id,
          maxAutonomy: 3,
          expiresAt: "2026-08-28T12:00:00.000Z",
        }),
      ),
      "attest",
    );
    expect(rt.kyaSnapshot().edges.some((e) => e.status === "live" && e.to === desk.id)).toBe(true);
    rt.clock.set("2026-08-29T00:00:00.000Z");
    expect(rt.kyaSnapshot().edges.find((e) => e.to === desk.id)?.status).toBe("expired");
    const liveBefore = [...rt.kya.attestations.values()].filter((a) => !a.revokedAt).length;
    const r = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 2 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("kya.unique_live");
    expect([...rt.kya.attestations.values()].filter((a) => !a.revokedAt)).toHaveLength(liveBefore);
  });
});

describe("known speaker", () => {
  it("refuses a command from a missing actor as actor.known, not a throw before policy", () => {
    const rt = boot();
    economy(rt);
    const clockBefore = rt.clock.now();
    const auditBefore = rt.audit.length;
    const r = rt.dispatch(cmd("ledger.balances", GHOST, {}));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.known")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.known");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(auditBefore);
  });

  it("does not name actor.known when a live agent freezes a missing target", () => {
    const rt = boot();
    const { founder } = economy(rt);
    const r = rt.dispatch(cmd("identity.freeze", founder.id, { agentId: GHOST }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.known")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("identity.known");
  });

  it("does not treat a provided unknown alias as system", () => {
    const rt = boot();
    expect(rt.speakerOf({})).toBe("system");
    expect(rt.speakerOf({ actor: "system" })).toBe("system");
    expect(rt.speakerOf({ actor: "ops-human" })).toBe("ops-human");
    const before = rt.identity.all().length;
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(
      cmd("identity.register", rt.speakerOf({ actor: "ops-human" }), {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.known");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(rt.identity.all()).toHaveLength(before);
    expect(rt.aliases.has("ops-human")).toBe(false);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("still maps a live alias after register", () => {
    const rt = boot();
    economy(rt);
    const founder = rt.alias("ops-human");
    expect(rt.speakerOf({ actor: "ops-human" })).toBe(founder.id);
    expect(rt.speakerOf({ actorId: founder.id, actor: "ghost-desk" })).toBe(founder.id);
    const listed = rt.dispatch(cmd("market.catalog", rt.speakerOf({ actor: "ops-human" }), {}));
    expect(listed.ok).toBe(true);
  });
});

describe("system is not a treasurer", () => {
  it("refuses a transfer spoken as system as actor.system_scope, not L5 treasury", () => {
    const rt = boot();
    economy(rt);
    rt.seedOpening({ "procurement:cash": { amount: 1_500_000, currency: "USD_SIM" } });
    const clockBefore = rt.clock.now();
    const journalsBefore = rt.journals.length;
    const r = rt.dispatch(
      cmd("ledger.transfer", "system", {
        fromAccount: "procurement:cash",
        toAccount: "vendor:cash",
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.known")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ledger.sufficient")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.system_scope");
    expect(r.error.decision?.remediation?.kind).toBe("none");
    expect(rt.journals.length).toBe(journalsBefore);
    expect(rt.ledger.balanceByName("procurement:cash").amount).toBe(1_500_000);
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.story.some((b) => b.headline.includes("not a treasurer"))).toBe(true);
  });

  it("refuses system minting a second agent after the first human", () => {
    const rt = boot();
    economy(rt);
    const before = rt.identity.all().length;
    const r = rt.dispatch(
      cmd("identity.register", "system", {
        key: "extra",
        displayName: "Extra",
        role: "treasury",
        autonomyLevel: 3,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.system_scope");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("allow");
    expect(rt.identity.all()).toHaveLength(before);
  });

  it("refuses system bootstrapping a treasurer instead of a human", () => {
    const rt = boot();
    const r = rt.dispatch(
      cmd("identity.register", "system", {
        key: "treasury",
        displayName: "Treasury",
        role: "treasury",
        autonomyLevel: 3,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.system_scope");
    expect(rt.identity.all()).toHaveLength(0);
  });

  it("still lets system bootstrap the first human and read the catalog", () => {
    const rt = boot();
    const listed = rt.dispatch(cmd("market.catalog", "system", {}));
    expect(listed.ok).toBe(true);
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
    const again = rt.dispatch(cmd("market.catalog", "system", {}));
    expect(again.ok).toBe(true);
  });

  it("lets system verify the notary, and writes the check", () => {
    const rt = boot();
    const clockBefore = rt.clock.now();
    const lengthBefore = rt.audit.length;
    const r = rt.dispatch(cmd("audit.verify", "system", {}));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("allow");
    expect((r.value.data as { ok: boolean }).ok).toBe(true);
    expect(r.value.decision.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(rt.clock.now()).not.toBe(clockBefore);
    expect(rt.audit.length).toBeGreaterThan(lengthBefore);
    expect(rt.audit.query({ action: "POLICY_DECISION" }).matched).toBeGreaterThan(0);
    expect(rt.audit.query({ action: "AUDIT_VERIFY" }).matched).toBe(1);
  });

  it("names actor.role_capability first when a vendor verifies the notary", () => {
    const rt = boot();
    const { vendor } = economy(rt);
    const clockBefore = rt.clock.now();
    const verifyBefore = rt.audit.query({ action: "AUDIT_VERIFY" }).matched;
    const r = rt.dispatch(cmd("audit.verify", vendor.id, {}));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.role_capability");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(rt.audit.query({ action: "AUDIT_VERIFY" }).matched).toBe(verifyBefore);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });
});
