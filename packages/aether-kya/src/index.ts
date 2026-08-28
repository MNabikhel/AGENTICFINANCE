import {
  KYA_MAX_DEPTH,
  type Agent,
  type AgentId,
  type AutonomyLevel,
  type DelegationAttestation,
  type DelegationId,
  type Instant,
  type KyaResolution,
} from "@aether/types";

function pairKey(principal: AgentId, delegate: AgentId): string {
  return `${principal}>${delegate}`;
}

/**
 * Principal → agent → sub-agent graph. Revoke cascades. Netting of identity:
 * a live path, an implicit supervisor grant, or a tombstone that blocks both.
 *
 * Issuer kinds (tap.http-sig, skyfire.kya, erc8004.agent) are labels for future
 * adapters. The kernel consults this graph, not those credential formats.
 */
export class DelegationGraph {
  readonly attestations = new Map<DelegationId, DelegationAttestation>();
  readonly blocked = new Set<string>();

  restore(snap: { attestations: DelegationAttestation[]; blocked: string[] }): void {
    this.attestations.clear();
    this.blocked.clear();
    for (const a of snap.attestations) this.attestations.set(a.id, a);
    for (const b of snap.blocked) this.blocked.add(b);
  }

  attest(input: DelegationAttestation): DelegationAttestation {
    if (input.grantorId === input.delegateId) {
      throw new Error("kya self-delegation forbidden");
    }
    if (input.parentId && !this.attestations.has(input.parentId)) {
      throw new Error("kya unknown parent hop");
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

  snapshot() {
    return {
      attestations: [...this.attestations.values()],
      blocked: [...this.blocked],
      edges: [...this.attestations.values()].map((a) => ({
        from: a.grantorId,
        to: a.delegateId,
        principalId: a.principalId,
        status: a.revokedAt ? ("revoked" as const) : ("live" as const),
        maxAutonomy: a.maxAutonomy,
      })),
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
