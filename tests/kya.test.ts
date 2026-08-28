import { describe, expect, it } from "vitest";
import { DelegationGraph, resolveKya } from "@aether/kya";
import type { Agent, AgentId, DelegationAttestation, DelegationId } from "@aether/types";

const founder = "aid_01J6AETHERFOUND00000000001" as AgentId;
const watch = "aid_01J6AETHERWATCH00000000001" as AgentId;
const scout = "aid_01J6AETHERSCOUT00000000001" as AgentId;
const extra = "aid_01J6AETHEREXTRA00000000001" as AgentId;
const now = "2026-08-28T00:00:00.000Z";
const later = "2026-08-29T00:00:00.000Z";
const expiredAt = "2026-08-27T00:00:00.000Z";

function att(over: Partial<DelegationAttestation> & Pick<DelegationAttestation, "id" | "grantorId" | "delegateId">): DelegationAttestation {
  return {
    vct: "aether.kya.delegation.1",
    issuerKind: "aether.self",
    principalId: founder,
    maxAutonomy: 5,
    maxDepth: 3,
    createdAt: now,
    expiresAt: "2027-08-28T00:00:00.000Z",
    ...over,
  };
}

function actor(id: AgentId, supervisors: AgentId[] = []): Agent {
  return {
    id,
    did: `did:aether:${id}`,
    displayName: id,
    role: "procurement",
    autonomyLevel: 4,
    keys: [],
    accountId: "acct_01J6AETHERACCT00000000001",
    supervisors,
    createdAt: now,
    frozen: false,
  };
}

describe("delegation graph", () => {
  it("walks principal → agent → sub-agent and caps depth", () => {
    const g = new DelegationGraph();
    g.attest(att({ id: "dlg_1" as DelegationId, grantorId: founder, delegateId: watch }));
    g.attest(att({ id: "dlg_2" as DelegationId, grantorId: watch, delegateId: scout, parentId: "dlg_1" as DelegationId, maxAutonomy: 3 }));
    const path = g.path(founder, scout, now);
    expect(path?.map((h) => h.delegateId)).toEqual([watch, scout]);
    const resolved = resolveKya({
      required: true,
      actor: actor(scout),
      principalId: founder,
      graph: g,
      nowIso: now,
    });
    expect(resolved.pathOk).toBe(true);
    expect(resolved.depth).toBe(2);
    expect(resolved.grantedMaxAutonomy).toBe(3);
  });

  it("revoke cascades and blocks implicit supervisor grants", () => {
    const g = new DelegationGraph();
    g.attest(att({ id: "dlg_1" as DelegationId, grantorId: founder, delegateId: watch }));
    g.attest(att({ id: "dlg_2" as DelegationId, grantorId: watch, delegateId: scout, parentId: "dlg_1" as DelegationId }));
    g.revoke({ principalId: founder, delegateId: watch, at: later });
    expect(g.path(founder, watch, later)).toBeUndefined();
    expect(g.path(founder, scout, later)).toBeUndefined();
    const implicit = resolveKya({
      required: true,
      actor: actor(watch, [founder]),
      principalId: founder,
      graph: g,
      nowIso: later,
    });
    expect(implicit.revoked).toBe(true);
    expect(implicit.pathOk).toBe(false);
  });

  it("treats expired hops as a freshness failure, not a missing chain", () => {
    const g = new DelegationGraph();
    g.attest(att({ id: "dlg_1" as DelegationId, grantorId: founder, delegateId: watch, expiresAt: expiredAt }));
    const resolved = resolveKya({
      required: true,
      actor: actor(watch),
      principalId: founder,
      graph: g,
      nowIso: now,
    });
    expect(resolved.pathOk).toBe(true);
    expect(resolved.expired).toBe(true);
  });

  it("allows an implicit supervisor grant when no attestation exists", () => {
    const g = new DelegationGraph();
    const resolved = resolveKya({
      required: true,
      actor: actor(watch, [founder]),
      principalId: founder,
      graph: g,
      nowIso: now,
    });
    expect(resolved.pathOk).toBe(true);
    expect(resolved.implicit).toBe(true);
  });

  it("forbids self-delegation", () => {
    const g = new DelegationGraph();
    expect(() => g.attest(att({ id: "dlg_x" as DelegationId, grantorId: extra, delegateId: extra }))).toThrow(/self-delegation/);
  });

  it("forbids a nested hop whose parent is not in the graph", () => {
    const g = new DelegationGraph();
    expect(() =>
      g.attest(
        att({
          id: "dlg_orphan" as DelegationId,
          grantorId: founder,
          delegateId: watch,
          parentId: "dlg_ghost" as DelegationId,
        }),
      ),
    ).toThrow(/unknown parent hop/);
  });
});
