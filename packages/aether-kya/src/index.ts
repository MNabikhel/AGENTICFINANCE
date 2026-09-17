import {
  KYA_MAX_DEPTH,
  type Agent,
  type AgentId,
  type AutonomyLevel,
  type DelegationAttestation,
  type DelegationId,
  type Instant,
  type IssuerId,
  type KyaHopStatus,
  type KyaIssuer,
  type KyaIssuerKind,
  type KyaResolution,
} from "@aether/types";

const GENESIS_AT = "2026-08-28T00:00:00.000Z";

/** One shape-only issuer per kind. Stable ids. Not a Command. Credentials never live here. */
export const GENESIS_ISSUERS: readonly KyaIssuer[] = [
  {
    id: "iss_01J6AETHERISSUERSELF00001" as IssuerId,
    vct: "aether.kya.issuer.1",
    kind: "aether.self",
    label: "Aether self-attested hop",
    adapter: "shape",
    live: false,
    createdAt: GENESIS_AT,
  },
  {
    id: "iss_01J6AETHERISSUERTAP000001" as IssuerId,
    vct: "aether.kya.issuer.1",
    kind: "tap.http-sig",
    label: "TAP HTTP Message Signatures (shape)",
    adapter: "shape",
    live: false,
    createdAt: GENESIS_AT,
  },
  {
    id: "iss_01J6AETHERISSUERSKY000001" as IssuerId,
    vct: "aether.kya.issuer.1",
    kind: "skyfire.kya",
    label: "Skyfire KYA (shape)",
    adapter: "shape",
    live: false,
    createdAt: GENESIS_AT,
  },
  {
    id: "iss_01J6AETHERISSUERERC000001" as IssuerId,
    vct: "aether.kya.issuer.1",
    kind: "erc8004.agent",
    label: "ERC-8004 agent (shape)",
    adapter: "shape",
    live: false,
    createdAt: GENESIS_AT,
  },
];

function pairKey(principal: AgentId, delegate: AgentId): string {
  return `${principal}>${delegate}`;
}

/** Revoked wins. Equal expiresAt is expired (same exclusive end as the graph view). */
export function hopStatus(a: { revokedAt?: Instant; expiresAt: Instant }, nowIso: Instant): KyaHopStatus {
  if (a.revokedAt) return "revoked";
  return Date.parse(a.expiresAt) > Date.parse(nowIso) ? "live" : "expired";
}

/**
 * Principal → agent → sub-agent graph. Revoke cascades. Netting of identity:
 * a live path, an implicit supervisor grant, or a tombstone that blocks both.
 *
 * Issuer kinds (tap.http-sig, skyfire.kya, erc8004.agent) pin genesis issuer
 * objects (`iss_`). Those objects are shape-only. The kernel consults this
 * graph, not those credential formats. Credentials never enter evaluate().
 */
export class DelegationGraph {
  readonly attestations = new Map<DelegationId, DelegationAttestation>();
  readonly blocked = new Set<string>();
  readonly issuers = new Map<IssuerId, KyaIssuer>();

  constructor() {
    this.seedGenesisIssuers();
  }

  private seedGenesisIssuers(): void {
    for (const issuer of GENESIS_ISSUERS) this.issuers.set(issuer.id, issuer);
  }

  issuerOfKind(kind: KyaIssuerKind): KyaIssuer {
    for (const issuer of this.issuers.values()) {
      if (issuer.kind === kind) return issuer;
    }
    this.seedGenesisIssuers();
    for (const issuer of this.issuers.values()) {
      if (issuer.kind === kind) return issuer;
    }
    return GENESIS_ISSUERS[0]!;
  }

  restore(snap: { attestations: DelegationAttestation[]; blocked: string[]; issuers?: KyaIssuer[] }): void {
    this.attestations.clear();
    this.blocked.clear();
    this.issuers.clear();
    this.seedGenesisIssuers();
    for (const issuer of snap.issuers ?? []) this.issuers.set(issuer.id, issuer);
    for (const a of snap.attestations) {
      if (a.issuerId) {
        this.attestations.set(a.id, a);
        continue;
      }
      const issuer = this.issuerOfKind(a.issuerKind);
      this.attestations.set(a.id, { ...a, issuerId: issuer.id });
    }
    for (const b of snap.blocked) this.blocked.add(b);
  }

  attest(input: DelegationAttestation): DelegationAttestation {
    if (input.grantorId === input.delegateId) {
      throw new Error("kya self-delegation forbidden");
    }
    if (input.parentId && !this.attestations.has(input.parentId)) {
      throw new Error("kya unknown parent hop");
    }
    for (const a of this.attestations.values()) {
      if (a.principalId === input.principalId && a.delegateId === input.delegateId && !a.revokedAt) {
        throw new Error("kya live pair already exists");
      }
    }
    this.attestations.set(input.id, input);
    this.blocked.delete(pairKey(input.principalId, input.delegateId));
    return input;
  }

  revoke(opts: {
    id?: DelegationId;
    principalId: AgentId;
    delegateId?: AgentId;
    at: Instant;
  }): DelegationAttestation[] {
    if (opts.id) {
      const named = this.attestations.get(opts.id);
      if (!named || named.principalId !== opts.principalId) {
        throw new Error("kya unknown attestation");
      }
    }
    const revoked: DelegationAttestation[] = [];
    const targets = new Set<DelegationId>();
    if (opts.id) targets.add(opts.id);
    if (opts.delegateId) {
      for (const a of this.attestations.values()) {
        if (a.principalId === opts.principalId && a.delegateId === opts.delegateId && !a.revokedAt) {
          targets.add(a.id);
        }
      }
      this.blocked.add(pairKey(opts.principalId, opts.delegateId));
    }

    const revokedDelegates = new Set<AgentId>();
    if (opts.delegateId) revokedDelegates.add(opts.delegateId);
    for (const id of targets) {
      const a = this.attestations.get(id);
      if (a) revokedDelegates.add(a.delegateId);
    }

    let grew = true;
    while (grew) {
      grew = false;
      for (const a of this.attestations.values()) {
        if (a.revokedAt || a.principalId !== opts.principalId) continue;
        if (targets.has(a.id)) continue;
        if ((a.parentId && targets.has(a.parentId)) || revokedDelegates.has(a.grantorId)) {
          targets.add(a.id);
          revokedDelegates.add(a.delegateId);
          this.blocked.add(pairKey(opts.principalId, a.delegateId));
          grew = true;
        }
      }
    }

    for (const id of targets) {
      const a = this.attestations.get(id);
      if (!a || a.revokedAt) continue;
      const next = { ...a, revokedAt: opts.at };
      this.attestations.set(id, next);
      this.blocked.add(pairKey(a.principalId, a.delegateId));
      revoked.push(next);
    }
    if (opts.delegateId) this.blocked.add(pairKey(opts.principalId, opts.delegateId));
    return revoked;
  }

  isBlocked(principal: AgentId, delegate: AgentId): boolean {
    return this.blocked.has(pairKey(principal, delegate));
  }

  /**
   * Pure preview of what `revoke()` would mutate: how many unrevoked hops
   * (including cascades) would be tombstoned, and whether a pair block would
   * be newly written. A revoke that would do neither is a no-op — a tombstone
   * is not a second tombstone (`kya.revoke_state`).
   */
  revokePreview(opts: {
    id?: DelegationId;
    principalId: AgentId;
    delegateId?: AgentId;
  }): { revokes: number; newBlock: boolean } {
    const targets = new Set<DelegationId>();
    if (opts.id) {
      const named = this.attestations.get(opts.id);
      if (named && named.principalId === opts.principalId) targets.add(opts.id);
    }
    let newBlock = false;
    if (opts.delegateId) {
      for (const a of this.attestations.values()) {
        if (a.principalId === opts.principalId && a.delegateId === opts.delegateId && !a.revokedAt) {
          targets.add(a.id);
        }
      }
      if (!this.blocked.has(pairKey(opts.principalId, opts.delegateId))) newBlock = true;
    }

    const revokedDelegates = new Set<AgentId>();
    if (opts.delegateId) revokedDelegates.add(opts.delegateId);
    for (const id of targets) {
      const a = this.attestations.get(id);
      if (a) revokedDelegates.add(a.delegateId);
    }

    let grew = true;
    while (grew) {
      grew = false;
      for (const a of this.attestations.values()) {
        if (a.revokedAt || a.principalId !== opts.principalId) continue;
        if (targets.has(a.id)) continue;
        if ((a.parentId && targets.has(a.parentId)) || revokedDelegates.has(a.grantorId)) {
          targets.add(a.id);
          revokedDelegates.add(a.delegateId);
          grew = true;
        }
      }
    }

    let revokes = 0;
    for (const id of targets) {
      const a = this.attestations.get(id);
      if (a && !a.revokedAt) revokes += 1;
    }
    return { revokes, newBlock };
  }

  /**
   * Path principal → … → delegate. Revoked hops are never walked.
   * Expired hops are skipped unless `allowExpired` is set (so freshness can deny distinctly).
   */
  path(
    principal: AgentId,
    delegate: AgentId,
    nowIso: Instant,
    opts?: { allowExpired?: boolean },
  ): DelegationAttestation[] | undefined {
    if (principal === delegate) return [];
    const now = Date.parse(nowIso);
    const live = [...this.attestations.values()].filter((a) => {
      if (a.principalId !== principal) return false;
      if (a.revokedAt) return false;
      if (!opts?.allowExpired && Date.parse(a.expiresAt) <= now) return false;
      return true;
    });
    const byGrantor = new Map<AgentId, DelegationAttestation[]>();
    for (const a of live) {
      const list = byGrantor.get(a.grantorId) ?? [];
      list.push(a);
      byGrantor.set(a.grantorId, list);
    }
    const queue: Array<{ node: AgentId; hops: DelegationAttestation[] }> = [{ node: principal, hops: [] }];
    const seen = new Set<AgentId>([principal]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const edge of byGrantor.get(cur.node) ?? []) {
        if (seen.has(edge.delegateId)) continue;
        const hops = [...cur.hops, edge];
        if (edge.delegateId === delegate) return hops;
        seen.add(edge.delegateId);
        queue.push({ node: edge.delegateId, hops });
      }
    }
    return undefined;
  }

  snapshot(nowIso: Instant) {
    return {
      attestations: [...this.attestations.values()],
      blocked: [...this.blocked],
      issuers: [...this.issuers.values()],
      edges: [...this.attestations.values()].map((a) => {
        const edge = {
          from: a.grantorId,
          to: a.delegateId,
          principalId: a.principalId,
          issuerKind: a.issuerKind,
          status: hopStatus(a, nowIso),
          maxAutonomy: a.maxAutonomy,
        };
        return a.issuerId ? { ...edge, issuerId: a.issuerId } : edge;
      }),
    };
  }
}

export function resolveKya(input: {
  required: boolean;
  actor: Agent;
  principalId?: AgentId;
  principal?: Agent;
  graph: DelegationGraph;
  nowIso: Instant;
  proposedMaxAutonomy?: AutonomyLevel;
}): KyaResolution {
  const maxDepth = KYA_MAX_DEPTH;
  const base: KyaResolution = {
    required: input.required,
    pathOk: false,
    implicit: false,
    depth: 0,
    maxDepth,
    principalFrozen: input.principal?.frozen === true,
    expired: false,
    revoked: false,
    hops: [],
  };
  if (input.principalId) base.principalId = input.principalId;
  if (input.proposedMaxAutonomy !== undefined) base.proposedMaxAutonomy = input.proposedMaxAutonomy;
  if (!input.required) return { ...base, pathOk: true };
  const principalId = input.principalId;
  if (!principalId) return base;
  if (input.actor.id === principalId) {
    return { ...base, pathOk: true, depth: 0, grantedMaxAutonomy: 5 };
  }
  if (input.graph.isBlocked(principalId, input.actor.id)) {
    return { ...base, pathOk: false, revoked: true };
  }
  const live = input.graph.path(principalId, input.actor.id, input.nowIso);
  if (live) {
    const leaf = live[live.length - 1];
    const next: KyaResolution = { ...base, pathOk: true, depth: live.length, hops: live };
    if (leaf) next.grantedMaxAutonomy = leaf.maxAutonomy;
    else next.grantedMaxAutonomy = 5;
    return next;
  }
  const expiredPath = input.graph.path(principalId, input.actor.id, input.nowIso, { allowExpired: true });
  if (expiredPath) {
    const leaf = expiredPath[expiredPath.length - 1];
    const next: KyaResolution = {
      ...base,
      pathOk: true,
      expired: true,
      depth: expiredPath.length,
      hops: expiredPath,
    };
    if (leaf) next.grantedMaxAutonomy = leaf.maxAutonomy;
    return next;
  }
  if (input.actor.supervisors.includes(principalId)) {
    return { ...base, pathOk: true, implicit: true, depth: 1, grantedMaxAutonomy: 5 };
  }
  return base;
}

export { KYA_MAX_DEPTH };
