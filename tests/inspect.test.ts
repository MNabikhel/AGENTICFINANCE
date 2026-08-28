import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { offerHire } from "../packages/aether-runtime/src/hire-flow.ts";
import { AetherMcp } from "../packages/aether-mcp/src/host.ts";
import type { ApprovalTicket, HireContract, MandateId } from "@aether/types";

function boot() {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISGET00000001",
    dailyLimit: 10_000_000,
  });
}

function must<T>(r: { ok: boolean; value?: T; error?: { error: { detail: string } } }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${(r as { error: { error: { detail: string } } }).error.error.detail}`);
  return r.value as T;
}

function economy(rt: Runtime, max = 700_000) {
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
    { key: "procurement", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "vendor", displayName: "Vendor", role: "data_vendor", autonomyLevel: 2 },
  ] as const) {
    must(rt.dispatch(cmd("identity.register", founder.id, { ...a })), a.key);
  }
  rt.seedOpening({
    "procurement:cash": { amount: 2_000_000, currency: "USD_SIM" },
    "treasury:cash": { amount: 5_000_000, currency: "USD_SIM" },
  });
  const desk = rt.alias("procurement");
  const vendor = rt.alias("vendor");
  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "buy research",
        constraints: [
          { type: "payment.amount_range", currency: "USD_SIM", max },
          { type: "payment.budget", currency: "USD_SIM", max: 2_000_000 },
          {
            type: "payment.allowed_payees",
            allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
          },
        ],
      }),
    ),
    "intent",
  );
  return {
    founder,
    desk,
    vendor,
    treasury: rt.alias("treasury"),
    intentId: (intent.data as { payload: { id: MandateId } }).payload.id,
  };
}

describe("inspect", () => {
  it("fetches a hire by id and an agent by alias", () => {
    const rt = boot();
    const { desk, vendor, intentId } = economy(rt);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.brief",
      spec: "one pager",
      price: { amount: 80_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    const hireId = (offered.attempt.value.data as HireContract).id;
    const hire = rt.inspect(hireId);
    expect(hire?.type).toBe("hire");
    expect((hire?.value as HireContract).state).toBe("offered");
    const agent = rt.inspect("procurement");
    expect(agent?.type).toBe("agent");
    expect((agent?.value as { displayName: string }).displayName).toBe("Desk");
  });
});

describe("approval expiry", () => {
  it("refuses to resolve a ticket after expiresAt and does not trap retries", () => {
    const rt = boot();
    const { desk, vendor, treasury, intentId } = economy(rt, 700_000);
    const offered = offerHire(rt, {
      buyer: desk.id,
      seller: vendor.id,
      sku: "research.deep",
      spec: "needs a grown-up",
      price: { amount: 640_000, currency: "USD_SIM" },
      intentId,
    });
    expect(offered.attempt.ok).toBe(true);
    if (!offered.attempt.ok) return;
    expect(offered.attempt.value.kind).toBe("escalated");
    const ticket = offered.attempt.value.ticket as ApprovalTicket;
    expect(ticket.status).toBe("pending");
    expect(rt.inspect(ticket.id)?.type).toBe("approval");

    rt.clock.set("2026-08-30T00:00:00.000Z");
    const late = rt.dispatch(cmd("approval.resolve", treasury.id, { approvalId: ticket.id, decision: "approved" }));
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.error.status).toBe(422);
    expect(late.error.error.type).toContain("policy.deny");
    expect(late.error.decision?.trace.find((t) => t.ruleId === "approval.pending")?.verdict).toBe("deny");
    expect(late.error.decision?.remediation?.ruleId).toBe("approval.pending");
    expect(rt.approvals.get(ticket.id)?.status).toBe("expired");

    const retry = rt.dispatch(cmd("hire.create", desk.id, { quoteId: offered.quoteId, intentId }));
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.error.decision.trace.find((t) => t.ruleId === "market.not_expired")?.verdict).toBe("deny");
    expect(rt.approvals.get(ticket.id)?.status).toBe("expired");
  });
});

describe("MCP command schemas", () => {
  it("lists real body fields so agents do not guess additionalProperties", () => {
    const mcp = new AetherMcp();
    const listed = mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (listed as { result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] } })
      .result.tools;
    const hire = tools.find((t) => t.name === "aether_hire_create");
    expect(hire?.inputSchema.properties.quoteId).toBeTruthy();
    expect(hire?.inputSchema.properties.intentId).toBeTruthy();
    expect(hire?.inputSchema.properties.actor).toBeTruthy();
    expect(tools.some((t) => t.name === "aether_get")).toBe(true);

    mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    });
    const got = mcp.callTool("aether_get", { id: "ops-human" }) as { type: string; value: { displayName: string } };
    expect(got.type).toBe("agent");
    expect(got.value.displayName).toBe("Founder");

    const cmds = mcp.handle({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "aether://commands" } });
    const text = (cmds as { result: { contents: { text: string }[] } }).result.contents[0]?.text ?? "";
    expect(text).toContain("hire.create");
  });
});
