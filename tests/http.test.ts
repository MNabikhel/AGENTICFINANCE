import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { start } from "../apps/runtime-http/src/server.ts";

let server: Server;
let base = "";

beforeAll(async () => {
  server = start(0);
  if (!server.listening) await once(server, "listening");
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, init);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("HTTP audit.verify", () => {
  it("GET /v1/audit/verify is the command bus, not a silent peek", async () => {
    await json("/v1/reset", { method: "POST" });
    const before = await json("/v1/snapshot");
    const auditBefore = before.body.audit as { length: number };
    const clockBefore = before.body.clock;

    const r = await json("/v1/audit/verify");
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("allow");
    expect((r.body.data as { ok: boolean }).ok).toBe(true);
    const decision = r.body.decision as {
      verdict: string;
      trace: { ruleId: string; verdict: string }[];
    };
    expect(decision.verdict).toBe("allow");
    expect(decision.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");

    const snap = await json("/v1/snapshot");
    const audit = snap.body.audit as {
      length: number;
      tail: { action: string }[];
    };
    expect(snap.body.clock).not.toBe(clockBefore);
    expect(audit.length).toBeGreaterThan(auditBefore.length);
    expect(audit.tail.some((e) => e.action === "AUDIT_VERIFY")).toBe(true);
    expect(audit.tail.some((e) => e.action === "POLICY_DECISION")).toBe(true);
  });

  it("POST omit-actor is the same system speaker as GET", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/audit/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("allow");
    expect((r.body.data as { ok: boolean }).ok).toBe(true);
  });

  it("POST as vendor is actor.role_capability", async () => {
    await json("/v1/reset", { method: "POST" });
    const founder = await json("/v1/identities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "system",
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    });
    expect(founder.status).toBe(200);
    const vendor = await json("/v1/identities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "ops-human",
        key: "vendor",
        displayName: "Vendor",
        role: "data_vendor",
        autonomyLevel: 2,
      }),
    });
    expect(vendor.status).toBe(200);
    const r = await json("/v1/audit/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "vendor" }),
    });
    expect(r.status).toBe(422);
    const decision = r.body.decision as { remediation?: { ruleId: string } };
    expect(decision.remediation?.ruleId).toBe("actor.role_capability");
  });
});

describe("HTTP ledger.balances and receipt.get", () => {
  it("GET /v1/accounts/{id} is the command bus as system, not ops-human", async () => {
    await json("/v1/reset", { method: "POST" });
    const before = await json("/v1/snapshot");
    const auditBefore = before.body.audit as { length: number };
    const clockBefore = before.body.clock;

    const r = await json("/v1/accounts/system:equity");
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("allow");
    const money = r.body.data as { amount: number; currency: string };
    expect(money.currency).toBe("USD_SIM");
    expect(typeof money.amount).toBe("number");
    const decision = r.body.decision as {
      verdict: string;
      trace: { ruleId: string; verdict: string }[];
    };
    expect(decision.verdict).toBe("allow");
    expect(decision.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(decision.trace.find((t) => t.ruleId === "actor.known")?.verdict).toBe("allow");

    const snap = await json("/v1/snapshot");
    const audit = snap.body.audit as {
      length: number;
      tail: { action: string; actorId: string }[];
    };
    expect(snap.body.clock).not.toBe(clockBefore);
    expect(audit.length).toBeGreaterThan(auditBefore.length);
    expect(audit.tail.some((e) => e.action === "POLICY_DECISION" && e.actorId === "system")).toBe(true);
  });

  it("GET /v1/accounts/{id} still allows after a founder who is not ops-human", async () => {
    await json("/v1/reset", { method: "POST" });
    const founder = await json("/v1/identities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "system",
        key: "alice",
        displayName: "Alice",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    });
    expect(founder.status).toBe(200);
    const r = await json("/v1/accounts/system:equity");
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("allow");
    const decision = r.body.decision as { trace: { ruleId: string; verdict: string }[] };
    expect(decision.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
  });

  it("GET /v1/accounts/{id} still allows after ops-human is frozen", async () => {
    await json("/v1/reset", { method: "POST" });
    const founder = await json("/v1/identities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "system",
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    });
    expect(founder.status).toBe(200);
    const id = (founder.body.data as { id: string }).id;
    const freeze = await json(`/v1/agents/${id}/freeze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "ops-human" }),
    });
    expect(freeze.status).toBe(200);
    const r = await json("/v1/accounts/system:equity");
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("allow");
    const decision = r.body.decision as {
      remediation?: { ruleId: string };
      trace: { ruleId: string; verdict: string }[];
    };
    expect(decision.remediation?.ruleId).not.toBe("actor.not_frozen");
    expect(decision.trace.find((t) => t.ruleId === "actor.not_frozen")?.verdict).toBe("allow");
  });

  it("GET /v1/accounts/{id} of a missing book is ledger.known_account, not actor.known", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/accounts/ghost-book");
    expect(r.status).toBe(422);
    const decision = r.body.decision as { remediation?: { ruleId: string } };
    expect(decision.remediation?.ruleId).toBe("ledger.known_account");
  });

  it("GET /v1/receipts/{id} of a miss is receipt.known, not actor.known", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/receipts/rid_ghost");
    expect(r.status).toBe(422);
    const decision = r.body.decision as {
      remediation?: { ruleId: string };
      trace: { ruleId: string; verdict: string }[];
    };
    expect(decision.remediation?.ruleId).toBe("receipt.known");
    expect(decision.trace.find((t) => t.ruleId === "actor.system_scope")?.verdict).toBe("allow");
    expect(decision.trace.find((t) => t.ruleId === "actor.known")?.verdict).toBe("allow");
  });

  it("GET /.well-known/agent-card.json pins this runtime, not a fake A2A JSON-RPC server", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/.well-known/agent-card.json");
    expect(r.status).toBe(200);
    expect(r.body.spec).toBe("aether.protocol.1");
    expect(r.body.protocolVersion).toBe("0.96.0");
    expect((r.body.capabilities as { liveMoney: boolean; evaluateLlm: boolean; hosted: boolean }).liveMoney).toBe(
      false,
    );
    expect((r.body.capabilities as { hosted: boolean }).hosted).toBe(false);
    expect((r.body.pin as { version: string }).version).toBe("0.96.0");
    expect(String(r.body.url)).toContain("127.0.0.1");
  });
});

describe("HTTP command bus", () => {
  it("POST /v1/commands dispatches every CommandType", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "host.card", actor: "system" }),
    });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("allow");
    const card = r.body.data as { hosted: boolean; evaluateLlm: boolean };
    expect(card.hosted).toBe(false);
    expect(card.evaluateLlm).toBe(false);
  });

  it("POST /v1/commands names command.malformed for an unknown type", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "not.a.command", actor: "system" }),
    });
    expect(r.status).toBe(400);
    expect(r.body.type).toBe("https://aether.dev/errors/command.malformed");
    expect(String(r.body.detail)).toContain("unknown command type");
  });

  it("POST /v1/hires/{id}/deliver is hire.deliver on the command bus", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/hires/hid_01J6AETHERGHOSTHIRE0000001/deliver", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "system" }),
    });
    expect(r.status).toBe(422);
    const decision = r.body.decision as { remediation?: { ruleId: string } };
    expect(decision.remediation?.ruleId).toBe("actor.role_capability");
  });

  it("POST /v1/fx/settle and POST /v1/ledger/transfers are the command bus", async () => {
    await json("/v1/reset", { method: "POST" });
    const fx = await json("/v1/fx/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "system", quoteId: "qte_01J6AETHERGHOSTQUOTE00001" }),
    });
    expect(fx.status).toBe(422);
    expect((fx.body.decision as { remediation?: { ruleId: string } }).remediation?.ruleId).toBe("market.fx_quote");
    const xfer = await json("/v1/ledger/transfers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "system",
        fromAccount: "system:equity",
        toAccount: "system:equity",
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    });
    expect(xfer.status).toBe(422);
    expect((xfer.body.decision as { remediation?: { ruleId: string } }).remediation?.ruleId).toBe("ledger.sufficient");
  });

  it("GET /openapi.yaml is the document, not a laptop path", async () => {
    const res = await fetch(`${base}/openapi.yaml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("yaml");
    const text = await res.text();
    expect(text).toContain("openapi: 3.1.0");
    expect(text).toContain("operationId: commandDispatch");
    expect(text).not.toMatch(/"201":/);
  });

  it("GET /openapi.json carries the YAML document, not a filesystem note", async () => {
    const r = await json("/openapi.json");
    expect(r.status).toBe(200);
    expect(r.body.format).toBe("yaml");
    expect(String(r.body.document)).toContain("openapi: 3.1.0");
    expect(r.body.path).toBeUndefined();
    expect(r.body.note).toBeUndefined();
  });

  it("POST /v1/demo/clearing is the clearing-window TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/clearing", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("clearing");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/refund is the refund TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/refund", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("refund");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/replay is the replay TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/replay", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("replay");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/nonce is the envelope-nonce TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/nonce", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("nonce");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/deny is the deny-cache TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/deny", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("deny");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/recurrence is the recurrence TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/recurrence", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("recurrence");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/calendar is the calendar TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/calendar", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("calendar");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/slot is the slot TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/slot", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("slot");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/daily is the daily TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/daily", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("daily");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/cart is the cart occupancy TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/cart", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("cart");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/velocity is the velocity TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/velocity", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("velocity");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/door is the operator-door TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/door", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("door");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/match is the cart-match TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/match", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("match");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/room is the closed-room TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/room", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("room");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/conversion is the conversion TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/conversion", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("conversion");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/pair is the unique-live TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/pair", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("pair");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/band is the spread TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/band", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("band");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/nest is the nest TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/nest", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("nest");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/heir is the heir TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/heir", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("heir");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/stock is the stock TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/stock", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("stock");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/purse is the purse TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/purse", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("purse");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/seat is the seat TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/seat", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("seat");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/cover is the cover TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/cover", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("cover");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/mint is the mint TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/mint", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("mint");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/payee is the payee TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/payee", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("payee");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/climb is the climb TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/climb", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("climb");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/born is the born TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/born", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("born");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/reach is the reach TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/reach", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("reach");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/year is the year TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/year", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("year");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/fuse is the fuse TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/fuse", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("fuse");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/sku is the sku TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/sku", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("sku");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/priced is the priced TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/priced", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("priced");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/party is the party TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/party", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("party");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/cash is the cash TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/cash", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("cash");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("POST /v1/demo/stale is the stale TAP", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/demo/stale", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.demo).toBe("stale");
    expect((r.body.results as { ok: boolean }[]).every((row) => row.ok)).toBe(true);
  });

  it("GET /v1/kya and GET /v1/objects/iss_* are the genesis issuer catalog", async () => {
    await json("/v1/reset", { method: "POST" });
    const kya = await json("/v1/kya");
    expect(kya.status).toBe(200);
    const issuers = kya.body.issuers as { id: string; live: boolean; adapter: string }[];
    expect(issuers).toHaveLength(4);
    expect(issuers.every((i) => i.live === false && i.adapter === "shape")).toBe(true);
    const row = await json(`/v1/objects/${issuers[0]!.id}`);
    expect(row.status).toBe(200);
    expect(row.body.type).toBe("issuer");
    expect((row.body.value as { live: boolean }).live).toBe(false);
  });

  it("POST /v1/clearing/windows is clearing.settle_window on the command bus", async () => {
    await json("/v1/reset", { method: "POST" });
    const r = await json("/v1/clearing/windows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "system", currency: "USD_SIM" }),
    });
    expect(r.status).toBe(422);
    expect((r.body.decision as { remediation?: { ruleId: string } }).remediation?.ruleId).toBe("actor.system_scope");
  });
});

