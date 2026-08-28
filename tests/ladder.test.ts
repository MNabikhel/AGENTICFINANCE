import { describe, expect, it } from "vitest";
import { IdentityRegistry, legalLadderTransition, makeAgent } from "@aether/identity";
import { generateEd25519 } from "@aether/kernel";

describe("autonomy ladder", () => {
  it("forbids skipping rungs and always allows any→L0", () => {
    expect(legalLadderTransition(2, 4)).toBeUndefined();
    expect(legalLadderTransition(0, 5)).toBeUndefined();
    expect(legalLadderTransition(4, 5)?.to).toBe(5);
    expect(legalLadderTransition(5, 0)?.to).toBe(0);
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
