import { describe, expect, it } from "vitest";
import { IdentityRegistry, ladderClimbLegal, legalLadderTransition, makeAgent } from "@aether/identity";
import { generateEd25519 } from "@aether/kernel";
import { Runtime, cmd } from "@aether/runtime";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISLADDER000001",
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
    { key: "night-watch", displayName: "Night Watch", role: "procurement", autonomyLevel: 0 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  return { founder, treasury: rt.alias("treasury"), nightWatch: rt.alias("night-watch") };
}

function deniedLegal(r: ReturnType<Runtime["dispatch"]>) {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error.error.status).toBe(422);
  expect(r.error.error.type).toContain("policy.deny");
  expect(r.error.decision?.trace.find((t) => t.ruleId === "ladder.legal")?.verdict).toBe("deny");
  expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.known")?.verdict).toBe("allow");
  expect(r.error.decision?.remediation?.ruleId).toBe("ladder.legal");
  expect(r.error.decision?.remediation?.kind).toBe("none");
}

describe("autonomy ladder", () => {
  it("forbids skipping rungs and always allows any→L0", () => {
    expect(legalLadderTransition(2, 4)).toBeUndefined();
    expect(legalLadderTransition(0, 5)).toBeUndefined();
    expect(legalLadderTransition(4, 5)?.to).toBe(5);
    expect(legalLadderTransition(5, 0)?.to).toBe(0);
  });

  it("treats listing kill_switch_tested as not the freeze test", () => {
    expect(
      ladderClimbLegal({
        from: 4,
        to: 5,
        actorRole: "human_operator",
        providedGates: ["circuit_breaker_configured", "kill_switch_tested"],
        killSwitchTested: false,
        circuitConfigured: true,
      }),
    ).toBe(false);
    expect(
      ladderClimbLegal({
        from: 4,
        to: 5,
        actorRole: "human_operator",
        providedGates: ["circuit_breaker_configured", "kill_switch_tested"],
        killSwitchTested: true,
        circuitConfigured: true,
      }),
    ).toBe(true);
  });

  it("freeze drops to L0 and unfreeze restores the prior rung", () => {
    const reg = new IdentityRegistry();
    const kp = generateEd25519("kid_ladder");
    const agent = makeAgent({
      id: "aid_01J6AETHERAGENT00000000009",
      displayName: "Night Watch",
      role: "procurement",
      autonomyLevel: 4,
      accountId: "acct_01J6AETHERACCT00000000009",
      supervisors: [],
      createdAt: "2026-08-28T00:00:00.000Z",
      keypair: kp,
    });
    reg.register(agent, kp);
    const frozen = reg.freeze(agent.id);
    expect(frozen.frozen).toBe(true);
    expect(frozen.autonomyLevel).toBe(0);
    expect(frozen.autonomyBeforeFreeze).toBe(4);
    const thawed = reg.unfreeze(agent.id);
    expect(thawed.frozen).toBe(false);
    expect(thawed.autonomyLevel).toBe(4);
    expect(thawed.autonomyBeforeFreeze).toBeUndefined();
  });
});

describe("ladder.legal", () => {
  it("refuses skipping a rung as ladder.legal, not a mutate throw", () => {
    const rt = boot();
    const { founder, nightWatch } = economy(rt);
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 1 })), "L1");
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 2, gates: ["auditor_ack"] })), "L2");
    const clockBefore = rt.clock.now();
    const r = rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 4 }));
    deniedLegal(r);
    expect(rt.alias("night-watch").autonomyLevel).toBe(2);
    expect(rt.clock.now()).not.toBe(clockBefore);
  });

  it("refuses L5 before the freeze test as ladder.legal, even when the gates are listed", () => {
    const rt = boot();
    const { founder, nightWatch } = economy(rt);
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 1 })), "L1");
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 2, gates: ["auditor_ack"] })), "L2");
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 3, gates: ["clean_audit_7d"] })), "L3");
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 4 })), "L4");
    const r = rt.dispatch(
      cmd("ladder.set", founder.id, {
        agentId: nightWatch.id,
        to: 5,
        gates: ["circuit_breaker_configured", "kill_switch_tested"],
      }),
    );
    deniedLegal(r);
    expect(rt.alias("night-watch").autonomyLevel).toBe(4);

    must(rt.dispatch(cmd("identity.freeze", founder.id, { agentId: nightWatch.id })), "freeze");
    must(rt.dispatch(cmd("identity.unfreeze", founder.id, { agentId: nightWatch.id })), "unfreeze");
    must(
      rt.dispatch(
        cmd("ladder.set", founder.id, {
          agentId: nightWatch.id,
          to: 5,
          gates: ["circuit_breaker_configured", "kill_switch_tested"],
        }),
      ),
      "L5",
    );
    expect(rt.alias("night-watch").autonomyLevel).toBe(5);
  });

  it("refuses a climb that omits a required gate as ladder.legal", () => {
    const rt = boot();
    const { founder, nightWatch } = economy(rt);
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 1 })), "L1");
    const r = rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 2 }));
    deniedLegal(r);
    expect(rt.alias("night-watch").autonomyLevel).toBe(1);
  });

  it("refuses treasury climbing 0→1 as ladder.legal, not a role forbid", () => {
    const rt = boot();
    const { treasury, nightWatch } = economy(rt);
    const r = rt.dispatch(cmd("ladder.set", treasury.id, { agentId: nightWatch.id, to: 1 }));
    deniedLegal(r);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.trace.find((t) => t.ruleId === "actor.role_capability")?.verdict).toBe("allow");
    expect(rt.alias("night-watch").autonomyLevel).toBe(0);
  });

  it("always allows any→L0", () => {
    const rt = boot();
    const { founder, nightWatch } = economy(rt);
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 1 })), "L1");
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to: 0 })), "L0");
    expect(rt.alias("night-watch").autonomyLevel).toBe(0);
  });
});

describe("ladder.birth_rung", () => {
  it("refuses minting L5 at identity.register as ladder.birth_rung, not ladder.legal", () => {
    const rt = boot();
    const { founder, nightWatch } = economy(rt);
    const r = rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "god-mode",
        displayName: "God Mode",
        role: "procurement",
        autonomyLevel: 5,
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.error.status).toBe(422);
    expect(r.error.error.type).toContain("policy.deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ladder.birth_rung")?.verdict).toBe("deny");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "ladder.legal")?.verdict).toBe("allow");
    expect(r.error.decision?.trace.find((t) => t.ruleId === "identity.unique_key")?.verdict).toBe("allow");
    expect(r.error.decision?.remediation?.ruleId).toBe("ladder.birth_rung");
    expect(rt.aliases.has("god-mode")).toBe(false);
    expect(nightWatch.autonomyLevel).toBe(0);
  });
});
