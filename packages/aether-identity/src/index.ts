import { generateEd25519, type Ed25519Keypair } from "@aether/kernel";
import {
  LADDER_TRANSITIONS,
  type Agent,
  type AgentId,
  type AgentRole,
  type AutonomyLevel,
  type Instant,
  type LadderExtraGate,
  type PublicKeyRef,
} from "@aether/types";

export class IdentityRegistry {
  readonly agents = new Map<AgentId, Agent>();
  readonly byDid = new Map<string, Agent>();
  readonly keys = new Map<AgentId, Ed25519Keypair>();
  /** Previous signing keys. verifyChain still accepts them. The current key signs. */
  readonly retired = new Map<AgentId, Ed25519Keypair[]>();

  register(agent: Agent, keypair: Ed25519Keypair): Agent {
    this.agents.set(agent.id, agent);
    this.byDid.set(agent.did, agent);
    this.keys.set(agent.id, keypair);
    return agent;
  }

  rotate(id: AgentId, next: Ed25519Keypair): Agent {
    const agent = this.require(id);
    const current = this.keys.get(id);
    if (!current) throw new Error(`no key for ${id}`);
    const prior = this.retired.get(id) ?? [];
    this.retired.set(id, [...prior, current]);
    this.keys.set(id, next);
    const pub: PublicKeyRef = { kid: next.kid, kty: "OKP", crv: "Ed25519", x: next.x };
    const updated: Agent = { ...agent, keys: [pub, ...agent.keys] };
    this.agents.set(id, updated);
    this.byDid.set(updated.did, updated);
    return updated;
  }

  mintKey(kid: string): Ed25519Keypair {
    return generateEd25519(kid);
  }

  get(id: AgentId): Agent | undefined {
    return this.agents.get(id);
  }

  require(id: AgentId): Agent {
    const a = this.agents.get(id);
    if (!a) throw new Error(`unknown agent ${id}`);
    return a;
  }

  all(): Agent[] {
    return [...this.agents.values()];
  }

  freeze(id: AgentId): Agent {
    const agent = this.require(id);
    if (agent.frozen) return agent;
    const next: Agent = {
      ...agent,
      frozen: true,
      autonomyBeforeFreeze: agent.autonomyLevel,
      autonomyLevel: 0,
    };
    this.agents.set(id, next);
    this.byDid.set(next.did, next);
    return next;
  }

  unfreeze(id: AgentId): Agent {
    const agent = this.require(id);
    if (!agent.frozen) return agent;
    const restored = agent.autonomyBeforeFreeze ?? agent.autonomyLevel;
    const next: Agent = { ...agent, frozen: false, autonomyLevel: restored };
    delete next.autonomyBeforeFreeze;
    this.agents.set(id, next);
    this.byDid.set(next.did, next);
    return next;
  }

  setLevel(id: AgentId, to: AutonomyLevel): Agent {
    const agent = this.require(id);
    const next: Agent = { ...agent, autonomyLevel: to };
    this.agents.set(id, next);
    this.byDid.set(next.did, next);
    return next;
  }
}

export function legalLadderTransition(
  from: AutonomyLevel,
  to: AutonomyLevel,
): (typeof LADDER_TRANSITIONS)[number] | { from: AutonomyLevel; to: 0; extraGates: []; requiredApproverRoles: AgentRole[] } | undefined {
  if (to === 0) {
    return { from, to: 0, extraGates: [], requiredApproverRoles: [] };
  }
  return LADDER_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function missingGates(
  extraGates: readonly LadderExtraGate[],
  provided: readonly LadderExtraGate[],
): LadderExtraGate[] {
  return extraGates.filter((g) => !provided.includes(g));
}

/** Same predicate policy reads as `ladderLegal` and mutate uses as a backstop. */
export function ladderClimbLegal(input: {
  from: AutonomyLevel;
  to: AutonomyLevel;
  actorRole: AgentRole;
  providedGates: readonly LadderExtraGate[];
  killSwitchTested: boolean;
  circuitConfigured: boolean;
}): boolean {
  const legal = legalLadderTransition(input.from, input.to);
  if (!legal) return false;
  if (input.to !== 0 && legal.requiredApproverRoles.length > 0 && !legal.requiredApproverRoles.includes(input.actorRole)) {
    return false;
  }
  if (missingGates(legal.extraGates, input.providedGates).length) return false;
  if (legal.extraGates.includes("kill_switch_tested") && !input.killSwitchTested) return false;
  if (legal.extraGates.includes("circuit_breaker_configured") && !input.circuitConfigured) return false;
  return true;
}

export function makeAgent(input: {
  id: AgentId;
  displayName: string;
  role: AgentRole;
  autonomyLevel: AutonomyLevel;
  accountId: Agent["accountId"];
  supervisors: AgentId[];
  createdAt: Instant;
  keypair: Ed25519Keypair;
}): Agent {
  const slug = input.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: input.id,
    did: `did:aether:${slug}:${input.id}`,
    displayName: input.displayName,
    role: input.role,
    autonomyLevel: input.autonomyLevel,
    keys: [{ kid: input.keypair.kid, kty: "OKP", crv: "Ed25519", x: input.keypair.x }],
    accountId: input.accountId,
    supervisors: input.supervisors,
    createdAt: input.createdAt,
    frozen: false,
  };
}
