import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import { AetherMcp } from "../packages/aether-mcp/src/host.ts";
import { PROTOCOL, type HostSubscription, type MandateId } from "@aether/types";

function boot(hosted = false) {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISHOST0000001",
    dailyLimit: 10_000_000,
    ...(hosted ? { hosted: true } : {}),
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

function deskWorld(rt: Runtime) {
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
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "subscribe this desk",
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
      }),
    ),
    "intent",
  );
  return { founder, desk, intentId: (intent.data as { payload: { id: MandateId } }).payload.id };
}

describe("host card", () => {
  it("lets system pin the card without a human clicking a website", () => {
    const rt = boot();
    const r = must(rt.dispatch(cmd("host.card", "system", {})), "host.card");
    const card = r.data as ReturnType<Runtime["protocolCard"]>;
    expect(card.spec).toBe("aether.protocol.1");
    expect(card.version).toBe("0.96.0");
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
    expect(PROTOCOL.hosted).toBe(false);
  });

  it("pins a discovery card that is this runtime, not an A2A JSON-RPC server", () => {
    const rt = boot();
    const card = rt.discoveryCard("http://127.0.0.1:8787");
    expect(card.spec).toBe("aether.protocol.1");
    expect(card.protocolVersion).toBe("0.96.0");
    expect(card.capabilities.liveMoney).toBe(false);
    expect(card.capabilities.evaluateLlm).toBe(false);
    expect(card.capabilities.hosted).toBe(false);
    expect(card.pin.version).toBe("0.96.0");
    expect(card.url).toBe("http://127.0.0.1:8787");
    expect(card.skills.some((s) => s.id === "inspect")).toBe(true);
    expect(card.skills.find((s) => s.id === "commands")?.description).toContain("POST /v1/commands");
    expect(card.skills.some((s) => s.id === "clearing-window")).toBe(true);
    expect(card.skills.find((s) => s.id === "clearing-window")?.description).toContain("POST /v1/demo/clearing");
    expect(card.skills.some((s) => s.id === "refund-unwind")).toBe(true);
    expect(card.skills.find((s) => s.id === "refund-unwind")?.description).toContain("POST /v1/demo/refund");
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

  it("pins hosted true on a hosted operator without flipping PROTOCOL.hosted", () => {
    const rt = boot(true);
    const card = must(rt.dispatch(cmd("host.card", "system", {})), "hosted card").data as ReturnType<
      Runtime["protocolCard"]
    >;
    expect(card.hosted).toBe(true);
    expect(card.authority.subscribeAvailable).toBe(true);
    expect((card.pricing as { takeRate?: null }).takeRate).toBeNull();
    expect(PROTOCOL.hosted).toBe(false);
    expect(PROTOCOL.version).toBe("0.96.0");
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

  it("names actor.system_scope first when system tries to subscribe on a hosted operator", () => {
    const rt = boot(true);
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

  it("records a unique subscriber against a live human-issued intent on a hosted operator", () => {
    const rt = boot(true);
    const { desk, intentId } = deskWorld(rt);
    const r = must(rt.dispatch(cmd("host.subscribe", desk.id, { intentId })), "subscribe");
    const row = r.data as HostSubscription;
    expect(row.id.startsWith("hsb_")).toBe(true);
    expect(row.subscriberId).toBe(desk.id);
    expect(row.intentId).toBe(intentId);
    expect(row.createdAt).toBeTruthy();
    expect("status" in row).toBe(false);
    const got = rt.inspect(row.id);
    expect(got?.type).toBe("subscription");
    expect((got?.value as HostSubscription).subscriberId).toBe(desk.id);
    expect((got?.value as { status: string }).status).toBe("live");
    const snap = rt.snapshotState() as { subscriptions: (HostSubscription & { status: string })[] };
    expect(snap.subscriptions).toHaveLength(1);
    expect(snap.subscriptions[0]?.id).toBe(row.id);
    expect(snap.subscriptions[0]?.status).toBe("live");
    expect("status" in (rt.subscriptions.get(row.id) ?? {})).toBe(false);
    expect(rt.story.some((b) => b.headline.includes("subscribed to this host"))).toBe(true);
  });

  it("labels a subscription expired when the slip dies, and unique_subscriber still occupies", () => {
    const rt = boot(true);
    const { founder, desk, intentId } = deskWorld(rt);
    const row = must(rt.dispatch(cmd("host.subscribe", desk.id, { intentId })), "subscribe").data as HostSubscription;
    expect((rt.inspect(row.id)?.value as { status: string }).status).toBe("live");
    rt.clock.set("2026-09-05T00:00:00.000Z");
    expect((rt.inspect(row.id)?.value as { status: string }).status).toBe("expired");
    expect(rt.snapshotState().subscriptions.find((s) => s.id === row.id)?.status).toBe("expired");
    expect("status" in (rt.subscriptions.get(row.id) ?? {})).toBe(false);
    const other = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "fresh slip after the first died",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 200 }],
        }),
      ),
      "fresh slip",
    );
    const again = rt.dispatch(
      cmd("host.subscribe", desk.id, { intentId: (other.data as { payload: { id: MandateId } }).payload.id }),
    );
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.decision?.remediation?.ruleId).toBe("host.unique_subscriber");
    expect(rt.subscriptions.size).toBe(1);
  });

  it("names mandate.known_intent when hosted subscribe names a ghost slip", () => {
    const rt = boot(true);
    const { desk } = deskWorld(rt);
    const r = rt.dispatch(cmd("host.subscribe", desk.id, { intentId: "mid_01J6AETHERGHOSTINTENT000001" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_intent");
  });

  it("names mandate.known_intent when hosted subscribe omits the slip", () => {
    const rt = boot(true);
    const { desk } = deskWorld(rt);
    const r = rt.dispatch(cmd("host.subscribe", desk.id, {}));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.known_intent");
  });

  it("names mandate.not_expired when hosted subscribe names a stale slip", () => {
    const rt = boot(true);
    const { desk, intentId } = deskWorld(rt);
    rt.clock.set("2026-09-05T00:00:00.000Z");
    const r = rt.dispatch(cmd("host.subscribe", desk.id, { intentId }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.not_expired");
  });

  it("names mandate.subject_is_actor when hosted subscribe uses another agent's slip", () => {
    const rt = boot(true);
    const { founder, desk } = deskWorld(rt);
    const self = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: founder.id,
          task: "founder only",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100 }],
        }),
      ),
      "founder slip",
    );
    const r = rt.dispatch(
      cmd("host.subscribe", desk.id, { intentId: (self.data as { payload: { id: MandateId } }).payload.id }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("mandate.subject_is_actor");
  });

  it("names host.human_authority when hosted subscribe uses an agent-issued slip", () => {
    const rt = boot(true);
    const { founder } = deskWorld(rt);
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: "agent-ops",
          displayName: "Ops",
          role: "procurement",
          autonomyLevel: 4,
        }),
      ),
      "ops",
    );
    const ops = rt.alias("agent-ops");
    const issued = must(
      rt.dispatch(
        cmd("mandate.issue_intent", ops.id, {
          subjectId: ops.id,
          task: "self slip",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100 }],
        }),
      ),
      "agent slip",
    );
    const r = rt.dispatch(
      cmd("host.subscribe", ops.id, { intentId: (issued.data as { payload: { id: MandateId } }).payload.id }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.decision?.remediation?.ruleId).toBe("host.human_authority");
  });

  it("names host.unique_subscriber on a second hosted subscribe for the same agent", () => {
    const rt = boot(true);
    const { founder, desk, intentId } = deskWorld(rt);
    must(rt.dispatch(cmd("host.subscribe", desk.id, { intentId })), "first");
    const again = rt.dispatch(cmd("host.subscribe", desk.id, { intentId }));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.decision?.remediation?.ruleId).toBe("host.unique_subscriber");
    const other = must(
      rt.dispatch(
        cmd("mandate.issue_intent", founder.id, {
          subjectId: desk.id,
          task: "second slip",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 200 }],
        }),
      ),
      "second slip",
    );
    const withNew = rt.dispatch(
      cmd("host.subscribe", desk.id, { intentId: (other.data as { payload: { id: MandateId } }).payload.id }),
    );
    expect(withNew.ok).toBe(false);
    if (withNew.ok) return;
    expect(withNew.error.decision?.remediation?.ruleId).toBe("host.unique_subscriber");
    expect(rt.subscriptions.size).toBe(1);
  });

  it("does not gate spend on a hosted subscription row", () => {
    const rt = boot(true);
    const { founder, desk, intentId } = deskWorld(rt);
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
    rt.seedOpening({ "procurement:cash": { amount: 2_000_000, currency: "USD_SIM" } });
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    expect(rt.subscriptions.size).toBe(0);
  });
});

describe("hosted subscribe durability", () => {
  it("restores the subscription row and hosted flag across restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-hosted-"));
    try {
      const a = new Runtime({
        startIso: "2026-08-28T00:00:00.000Z",
        genesisNonce: "01J6AETHERGENESISHOSTDUR0001",
        dailyLimit: 10_000_000,
        dataDir: dir,
        hosted: true,
      });
      const { desk, intentId } = deskWorld(a);
      const row = must(a.dispatch(cmd("host.subscribe", desk.id, { intentId })), "subscribe").data as HostSubscription;
      const b = new Runtime({
        startIso: "2026-08-28T00:00:00.000Z",
        genesisNonce: "01J6AETHERGENESISHOSTDUR0001",
        dailyLimit: 10_000_000,
        dataDir: dir,
      });
      expect(b.hosted).toBe(true);
      expect(b.protocolCard().hosted).toBe(true);
      expect(b.inspect(row.id)?.type).toBe("subscription");
      expect((b.inspect(row.id)?.value as { status: string }).status).toBe("live");
      expect("status" in (b.subscriptions.get(row.id) ?? {})).toBe(false);
      expect(b.subscriptions.size).toBe(1);
      const again = b.dispatch(cmd("host.subscribe", desk.id, { intentId }));
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.error.decision?.remediation?.ruleId).toBe("host.unique_subscriber");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
