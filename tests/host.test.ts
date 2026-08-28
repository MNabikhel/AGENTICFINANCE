import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { AetherMcp } from "../packages/aether-mcp/src/host.ts";
import { PROTOCOL } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISHOST0000001",
    dailyLimit: 10_000_000,
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

describe("host card", () => {
  it("lets system pin the card without a human clicking a website", () => {
    const rt = boot();
    const r = must(rt.dispatch(cmd("host.card", "system", {})), "host.card");
    const card = r.data as ReturnType<Runtime["protocolCard"]>;
    expect(card.spec).toBe("aether.protocol.1");
    expect(card.version).toBe("0.89.0");
    expect(card.liveMoney).toBe(false);
    expect(card.evaluateLlm).toBe(false);
    expect(card.hosted).toBe(false);
    expect(card.adapters).toEqual({ ap2: "shape", x402: "shape", mpp: "shape" });
    expect(card.pricing.selfHost.amount).toBe(0);
    expect(card.pricing.hostedMonthly).toBeNull();
    expect(card.authority.subscribe).toBe("host.subscribe");
    expect(card.authority.subscribeAvailable).toBe(false);
    expect(card.authority.bootstrap).toBe("human_operator");
    expect(card.discovery.wellKnown).toBe("/.well-known/aether.json");
    expect(rt.protocolCard().hosted).toBe(false);
  });

  it("lets a registered desk read the same card", () => {
    const rt = boot();
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
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "procurement",
          displayName: "Desk",
          role: "procurement",
          autonomyLevel: 3,
        }),
      ),
      "desk",
    );
    const desk = rt.alias("procurement");
    const r = must(rt.dispatch(cmd("host.card", desk.id, {})), "desk card");
    expect((r.data as { hosted: boolean }).hosted).toBe(false);
  });
});

describe("host subscribe", () => {
  it("refuses subscribe on this public kernel as host.not_hosted", () => {
    const rt = boot();
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
    const r = rt.dispatch(cmd("host.subscribe", founder.id, {}));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("host.not_hosted");
    expect(rt.story.some((b) => b.headline.includes("cannot subscribe to the public kernel"))).toBe(true);
  });

  it("names actor.system_scope first when system tries to subscribe", () => {
    const rt = boot();
    const r = rt.dispatch(cmd("host.subscribe", "system", {}));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.system_scope");
  });

  it("names actor.role_capability first when a vendor tries to subscribe", () => {
    const rt = boot();
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
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "vendor",
          displayName: "Vendor",
          role: "data_vendor",
          autonomyLevel: 2,
        }),
      ),
      "vendor",
    );
    const vendor = rt.alias("vendor");
    const r = rt.dispatch(cmd("host.subscribe", vendor.id, {}));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("actor.role_capability");
  });
});

describe("MCP host card", () => {
  it("lists host.card and returns the same pin as aether_protocol", () => {
    const mcp = new AetherMcp();
    const listed = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = ((listed as { result: { tools: { name: string }[] } }).result.tools).map((t) => t.name);
    expect(names).toContain("aether_host_card");
    expect(names).toContain("aether_host_subscribe");
    expect(names).toContain("aether_protocol");

    const viaTool = mcp.callTool("aether_protocol", {}) as { hosted: boolean; evaluateLlm: boolean; version: string };
    expect(viaTool.hosted).toBe(false);
    expect(viaTool.evaluateLlm).toBe(false);
    expect(viaTool.version).toBe(PROTOCOL.version);

    const viaBus = mcp.callTool("aether_host_card", { actor: "system" }) as {
      ok: boolean;
      data: { hosted: boolean; authority: { subscribeAvailable: boolean } };
    };
    expect(viaBus.ok).toBe(true);
    expect(viaBus.data.hosted).toBe(false);
    expect(viaBus.data.authority.subscribeAvailable).toBe(false);

    const hostRes = mcp.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "aether://host" },
    });
    const text = (hostRes as { result: { contents: { text: string }[] } }).result.contents[0]?.text ?? "";
    expect(text).toContain("\"hosted\":false");
    expect(text).toContain("host.subscribe");
  });
});
