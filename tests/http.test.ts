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
