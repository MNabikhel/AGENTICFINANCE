import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { loadSubHire, runSubHire } from "@aether/sub-hire";
import { AetherMcp, MCP_TOOL_CATALOG } from "../packages/aether-mcp/src/host.ts";

describe("sub-hire demo", () => {
  it("passes TAP assertions for nested slips", () => {
    const report = runSubHire(loadSubHire(resolve("fixtures/demo/sub-hire/scenario.json")));
    const failed = report.results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe("MCP host", () => {
  it("lists tools and dispatches identity.register", () => {
    const mcp = new AetherMcp();
    const listed = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed as { result: { tools: { name: string }[] } }).result.tools).map((t) => t.name);
    expect(names).toContain("aether_identity_register");
    expect(names).toContain("aether_snapshot");
    expect(names).toContain("aether_demo_sub_hire");
    expect(names).toContain("aether_demo_clearing");
    expect(names).toContain("aether_demo_refund");
    expect(names).toContain("aether_demo_replay");
    expect(names).toContain("aether_demo_nonce");
    expect(names).toContain("aether_demo_deny");
    expect(names).toContain("aether_demo_recurrence");
    expect(names).toContain("aether_demo_calendar");
    expect(names).toContain("aether_demo_slot");
    expect(names).toContain("aether_demo_daily");
    expect(names).toContain("aether_demo_cart");
    expect(names).toContain("aether_demo_velocity");
    expect(names).toContain("aether_demo_door");
    expect(names).toContain("aether_demo_match");
    expect(names).toContain("aether_demo_room");
    expect(names).toContain("aether_demo_conversion");
    expect(names).toContain("aether_demo_pair");
    expect(names).toContain("aether_demo_band");
    expect(names).toContain("aether_demo_nest");
    expect(names).toContain("aether_demo_heir");
    expect(names).toContain("aether_demo_stock");
    expect(names).toContain("aether_demo_purse");
    expect(names).toContain("aether_demo_seat");
    expect(names).toContain("aether_demo_cover");
    expect(names).toContain("aether_demo_mint");
    expect(names).toContain("aether_demo_payee");
    expect(names).toContain("aether_demo_climb");
    expect(names).toContain("aether_demo_born");
    expect(names).toContain("aether_demo_reach");
    expect(names).toContain("aether_demo_year");
    expect(names).toContain("aether_demo_fuse");
    expect(names).toContain("aether_demo_sku");
    expect(names).toContain("aether_hire_refund");
    expect(names).toContain("aether_market_fx_settle");
    expect(names).toContain("aether_ledger_transfer");
    expect(names).toContain("aether_protocol");
    const hireTool = ((listed as { result: { tools: { name: string; inputSchema?: { required?: string[] } }[] } }).result.tools).find(
      (t) => t.name === "aether_hire_create",
    );
    expect(hireTool?.inputSchema?.required).toEqual(["quoteId", "intentId"]);

    const reg = mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    }) as { ok: boolean; data: { displayName: string; id: string }; replayed: boolean };
    expect(reg.ok).toBe(true);
    expect(reg.data.displayName).toBe("Founder");
    expect(reg.replayed).toBe(false);

    const again = mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    }) as { ok: boolean; data: { id: string }; replayed: boolean };
    expect(again.ok).toBe(true);
    expect(again.replayed).toBe(true);
    expect(again.data.id).toBe(reg.data.id);

    const snap = mcp.callTool("aether_snapshot", {}) as { agents: { displayName: string }[] };
    expect(snap.agents.some((a) => a.displayName === "Founder")).toBe(true);

    const protocol = mcp.callTool("aether_protocol", {}) as { spec: string; liveMoney: boolean };
    expect(protocol.spec).toBe("aether.protocol.1");
    expect(protocol.liveMoney).toBe(false);

    const malformed = mcp.callTool("aether_hire_create", { actor: "system", intentId: "mid_x" }) as {
      ok: boolean;
      verdict: string;
      error: { status: number; type: string };
    };
    expect(malformed.ok).toBe(false);
    expect(malformed.verdict).toBe("malformed");
    expect(malformed.error.status).toBe(400);
    expect(malformed.error.type).toContain("command.malformed");
  });

  it("lists one command tool per CommandType", () => {
    const schema = JSON.parse(readFileSync(resolve("schemas/commands.schema.json"), "utf8")) as {
      commands: Record<string, unknown>;
    };
    const types = Object.keys(schema.commands).sort();
    const mapped = MCP_TOOL_CATALOG.tools
      .filter((t) => t.commandType && !t.commandType.startsWith("demo."))
      .map((t) => t.commandType)
      .sort();
    expect(mapped).toEqual(types);
  });

  it("runs the sub-hire demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_sub_hire", {}) as { ok: boolean; results: { ok: boolean }[] };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
  });

  it("runs the clearing-window demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_clearing", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("settlement window");
  });

  it("runs the refund demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_refund", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("Refund returned escrow");
  });

  it("runs the replay demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_replay", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("Retrying the same fund did not move cash again");
  });

  it("runs the envelope-nonce demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_nonce", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("idempotency.nonce");
  });

  it("runs the deny-cache demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_deny", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("deny was not cached");
  });

  it("runs the recurrence demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_recurrence", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("payment.recurrence");
  });

  it("runs the calendar demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_calendar", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("payment.execution_date");
  });

  it("runs the slot demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_slot", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("refund is not a new slot");
  });

  it("runs the daily demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_daily", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("gap, not a burst");
  });

  it("runs the cart occupancy demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_cart", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a field on fund");
  });

  it("runs the velocity demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_velocity", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a freeze on funded work");
  });

  it("runs the operator-door demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_door", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("PROTOCOL.hosted stays false");
  });

  it("runs the cart-match demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_match", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a discount");
  });

  it("runs the closed-room demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_room", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a bulletin board");
  });

  it("runs the conversion demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_conversion", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a good");
  });

  it("runs the unique-live demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_pair", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a tighter grant");
  });

  it("runs the spread demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_band", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not decoration");
  });

  it("runs the nest demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_nest", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("does not outlive its parent");
  });

  it("runs the heir demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_heir", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a parent");
  });

  it("runs the stock demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_stock", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a missing maker");
  });

  it("runs the purse demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_purse", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not an item cap");
  });

  it("runs the seat demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_seat", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("one row");
  });

  it("runs the cover demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_cover", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a child's leftover");
  });

  it("runs the mint demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_mint", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a mint");
  });

  it("runs the payee demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_payee", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not any registered vendor");
  });

  it("runs the climb demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_climb", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a wider handshake");
  });

  it("runs the born demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_born", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("cannot be born dead");
  });

  it("runs the reach demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_reach", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("opens after the slip dies");
  });

  it("runs the year demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_year", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not standing identity");
  });

  it("runs the fuse demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_fuse", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not a freeze on funded work");
  });

  it("runs the sku demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_sku", {}) as { ok: boolean; results: { ok: boolean }[]; tldr: string };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.tldr).toContain("not any catalog good");
  });

  it("refuses an unknown actor alias as actor.known, not silent system", () => {
    const mcp = new AetherMcp();
    const ghost = mcp.callTool("aether_market_catalog", { actor: "ghost-desk" }) as {
      ok: boolean;
      remediation: { ruleId: string } | null;
    };
    expect(ghost.ok).toBe(false);
    expect(ghost.remediation?.ruleId).toBe("actor.known");
    expect(mcp.runtime.identity.all()).toHaveLength(0);

    const premature = mcp.callTool("aether_identity_register", {
      actor: "ops-human",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    }) as { ok: boolean; remediation: { ruleId: string } | null };
    expect(premature.ok).toBe(false);
    expect(premature.remediation?.ruleId).toBe("actor.known");
    expect(mcp.runtime.aliases.has("ops-human")).toBe(false);

    const omit = mcp.callTool("aether_market_catalog", {}) as { ok: boolean };
    expect(omit.ok).toBe(true);

    const boot = mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    }) as { ok: boolean };
    expect(boot.ok).toBe(true);
    expect(mcp.runtime.aliases.has("ops-human")).toBe(true);

    const live = mcp.callTool("aether_market_catalog", { actor: "ops-human" }) as { ok: boolean };
    expect(live.ok).toBe(true);

    const asSystem = mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "extra",
      displayName: "Extra",
      role: "treasury",
      autonomyLevel: 3,
    }) as { ok: boolean; remediation: { ruleId: string } | null };
    expect(asSystem.ok).toBe(false);
    expect(asSystem.remediation?.ruleId).toBe("actor.system_scope");
  });

  it("lets omit-actor verify the notary, and names actor.role_capability when a vendor tries", () => {
    const mcp = new AetherMcp();
    const asSystem = mcp.callTool("aether_audit_verify", {}) as {
      ok: boolean;
      kind: string;
      data: { ok: boolean };
    };
    expect(asSystem.ok).toBe(true);
    expect(asSystem.kind).toBe("allow");
    expect(asSystem.data.ok).toBe(true);
    expect(mcp.runtime.audit.query({ action: "AUDIT_VERIFY" }).matched).toBe(1);

    mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    });
    mcp.callTool("aether_identity_register", {
      actor: "ops-human",
      key: "vendor",
      displayName: "Vendor",
      role: "data_vendor",
      autonomyLevel: 2,
    });
    const asVendor = mcp.callTool("aether_audit_verify", { actor: "vendor" }) as {
      ok: boolean;
      remediation: { ruleId: string } | null;
    };
    expect(asVendor.ok).toBe(false);
    expect(asVendor.remediation?.ruleId).toBe("actor.role_capability");
    expect(mcp.runtime.audit.query({ action: "AUDIT_VERIFY" }).matched).toBe(1);
  });

  it("lets omit-actor read a named book and names receipt.known on a miss", () => {
    const mcp = new AetherMcp();
    const book = mcp.callTool("aether_ledger_balances", { name: "system:equity" }) as {
      ok: boolean;
      kind: string;
      data: { amount: number; currency: string };
    };
    expect(book.ok).toBe(true);
    expect(book.kind).toBe("allow");
    expect(book.data.currency).toBe("USD_SIM");

    const ghost = mcp.callTool("aether_receipt_get", { receiptId: "rid_ghost" }) as {
      ok: boolean;
      remediation: { ruleId: string } | null;
    };
    expect(ghost.ok).toBe(false);
    expect(ghost.remediation?.ruleId).toBe("receipt.known");
  });
});
