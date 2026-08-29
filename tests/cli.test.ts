import { describe, expect, it } from "vitest";
import { cmd } from "@aether/runtime";
import { bootCliRuntime, cliAuditVerify, cliLedgerReplay } from "../apps/cli/src/bus.ts";

describe("CLI bus", () => {
  it("aether audit verify is audit.verify on the command bus", () => {
    const rt = bootCliRuntime();
    const result = cliAuditVerify(rt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("allow");
    expect((result.value.data as { ok: boolean }).ok).toBe(true);
    expect(result.value.decision.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(rt.audit.all().some((e) => e.action === "AUDIT_VERIFY")).toBe(true);
    expect(rt.audit.all().some((e) => e.action === "POLICY_DECISION")).toBe(true);
  });

  it("aether ledger replay is jsonl equivalent to memory", () => {
    const rt = bootCliRuntime();
    expect(cliLedgerReplay(rt)).toBe(true);
    const founder = rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    );
    expect(founder.ok).toBe(true);
    const treasury = rt.dispatch(
      cmd("identity.register", rt.alias("ops-human").id, {
        key: "treasury",
        displayName: "Treasury",
        role: "treasury",
        autonomyLevel: 3,
      }),
    );
    expect(treasury.ok).toBe(true);
    rt.seedOpening({
      "treasury:cash": { amount: 5_000_000, currency: "USD_SIM" },
    });
    expect(rt.ledger.entries.length).toBeGreaterThan(0);
    expect(cliLedgerReplay(rt)).toBe(true);
  });
});
