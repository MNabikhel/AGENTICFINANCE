import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadSubHire, runSubHire } from "@aether/sub-hire";
import { AetherMcp } from "../packages/aether-mcp/src/host.ts";

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
    expect(names).toContain("aether_protocol");

    const reg = mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    }) as { ok: boolean; data: { displayName: string } };
    expect(reg.ok).toBe(true);
    expect(reg.data.displayName).toBe("Founder");

    const snap = mcp.callTool("aether_snapshot", {}) as { agents: { displayName: string }[] };
    expect(snap.agents.some((a) => a.displayName === "Founder")).toBe(true);

    const protocol = mcp.callTool("aether_protocol", {}) as { spec: string; liveMoney: boolean };
    expect(protocol.spec).toBe("aether.protocol.1");
    expect(protocol.liveMoney).toBe(false);
  });

  it("runs the sub-hire demo over the tool bus", () => {
    const mcp = new AetherMcp();
    const report = mcp.callTool("aether_demo_sub_hire", {}) as { ok: boolean; results: { ok: boolean }[] };
    expect(report.ok).toBe(true);
    expect(report.results.every((r) => r.ok)).toBe(true);
  });
});
