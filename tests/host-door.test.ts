import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importKeypair } from "@aether/kernel";
import { AetherMcp } from "../packages/aether-mcp/src/host.ts";
import {
  Runtime,
  admitSpeaker,
  cmd,
  invoiceCurrent,
  signSpeaker,
  HOST_INVOICE_WINDOW_MS,
} from "@aether/runtime";
import { PROTOCOL, type AgentId } from "@aether/types";

type ExportedKey = {
  kid: string;
  x: string;
  pkcs8: string;
  spki: string;
};

function boot(opts?: { hosted?: boolean; hostedMonthly?: number; dataDir?: string }) {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISDOOR000001",
    dailyLimit: 10_000_000,
    ...(opts?.hosted ? { hosted: true } : {}),
    ...(opts?.hostedMonthly !== undefined ? { hostedMonthly: opts.hostedMonthly } : {}),
    ...(opts?.dataDir ? { dataDir: opts.dataDir } : {}),
  });
}

function mustDispatch(r: { ok: boolean; value?: { data: unknown }; error?: { error: { detail: string } } }): { data: unknown } {
  if (!r.ok) throw new Error(r.error?.error.detail ?? "dispatch failed");
  return r.value as { data: unknown };
}

describe("hosted operator door", () => {
  it("does not require a speaker proof on the public kernel", () => {
    const rt = boot();
    const r = admitSpeaker(rt, {
      type: "mandate.issue_intent",
      actor: "ghost",
      body: {},
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.actorId).toBe("ghost");
  });

  it("lists a monthly price only on a hosted operator and never flips PROTOCOL.hosted", () => {
    const publicRt = boot();
    expect(publicRt.protocolCard().pricing.hostedMonthly).toBeNull();
    expect(publicRt.protocolCard().hosted).toBe(false);
    expect(PROTOCOL.hosted).toBe(false);
    expect(PROTOCOL.liveMoney).toBe(false);
    expect(PROTOCOL.version).toBe("0.96.0");

    const hosted = boot({ hosted: true, hostedMonthly: 50_000 });
    const card = hosted.protocolCard();
    expect(card.hosted).toBe(true);
    expect(card.pricing.hostedMonthly).toEqual({ amount: 50_000 });
    expect(card.pricing.takeRate).toBeNull();
    expect(card.authority.speakerProof).toBe("ed25519");
    expect(card.authority.invoice).toBe("host.invoice");
    expect(card.authority.liveMoneyOnThisHost).toBe(false);
    expect(PROTOCOL.hosted).toBe(false);
  });

  it("refuses an unsigned named speaker on a hosted operator before evaluate()", () => {
    const rt = boot({ hosted: true });
    mustDispatch(
      rt.dispatch(
        cmd("identity.register", "system", {
          key: "ops-human",
          displayName: "Founder",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
    );
    const founder = rt.alias("ops-human");
    const r = admitSpeaker(rt, {
      type: "mandate.issue_intent",
      actor: "ops-human",
      actorId: founder.id,
      body: { task: "x" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.status).toBe(401);
    expect(r.error.type).toContain("speaker.proof");
  });

  it("lets a signed human invoice the host, then use the door; subscribe is enrollment not a spend gate", () => {
    const rt = boot({ hosted: true, hostedMonthly: 50_000 });
    mustDispatch(
      rt.dispatch(
        cmd("identity.register", "system", {
          key: "ops-human",
          displayName: "Founder",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
    );
    const founder = rt.alias("ops-human");
    const kp = rt.identity.keys.get(founder.id)!;
    const intentBody = {
      subjectId: founder.id,
      task: "desk work",
      constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 500_000 }],
    };
    const unpaid = admitSpeaker(rt, {
      type: "mandate.issue_intent",
      actorId: founder.id,
      body: intentBody,
      proof: signSpeaker(kp, { type: "mandate.issue_intent", actorId: founder.id, body: intentBody }),
    });
    expect(unpaid.ok).toBe(false);
    if (unpaid.ok) return;
    expect(unpaid.error.status).toBe(402);
    expect(unpaid.error.type).toContain("host.unpaid");

    const invoiced = rt.recordHostInvoice(founder.id, { method: "invoice" });
    expect(invoiced.ok).toBe(true);
    if (!invoiced.ok) return;
    expect(invoiced.value.amount).toBe(50_000);
    expect(invoiceCurrent(rt)).toBe(true);
    expect(rt.audit.query({ action: "HOST_INVOICE" }).matched).toBe(1);

    const paid = admitSpeaker(rt, {
      type: "mandate.issue_intent",
      actorId: founder.id,
      body: intentBody,
      proof: signSpeaker(kp, { type: "mandate.issue_intent", actorId: founder.id, body: intentBody }),
    });
    expect(paid.ok).toBe(true);

    const issued = mustDispatch(rt.dispatch(cmd("mandate.issue_intent", founder.id, intentBody)));
    const intentId = (issued.data as { payload: { id: string } }).payload.id;
    const sub = rt.dispatch(cmd("host.subscribe", founder.id, { intentId }));
    expect(sub.ok).toBe(true);
    const hireAttempt = rt.dispatch(cmd("hire.create", founder.id, { quoteId: "qte_ghost", intentId }));
    expect(hireAttempt.ok).toBe(false);
    if (hireAttempt.ok) return;
    expect(hireAttempt.error.decision?.remediation?.ruleId).not.toBe("host.unique_subscriber");
    expect(rt.subscriptions.size).toBe(1);
  });

  it("keeps invoices across durable restore", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-host-"));
    try {
      const a = boot({ hosted: true, hostedMonthly: 12_000, dataDir: dir });
      mustDispatch(
        a.dispatch(
          cmd("identity.register", "system", {
            key: "ops-human",
            displayName: "Founder",
            role: "human_operator",
            autonomyLevel: 0,
          }),
        ),
      );
      const founder = a.alias("ops-human");
      const billed = a.recordHostInvoice(founder.id, { method: "stripe", reference: "cs_test_1" });
      expect(billed.ok).toBe(true);
      const b = boot({ hosted: true, hostedMonthly: 12_000, dataDir: dir });
      expect(b.invoices.size).toBe(1);
      expect([...b.invoices.values()][0]?.reference).toBe("cs_test_1");
      expect(invoiceCurrent(b)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a public kernel invoice and does not let MCP omit-actor spend on a hosted operator", () => {
    const pub = boot();
    expect(pub.recordHostInvoice("aid_nope" as AgentId, { method: "invoice" }).ok).toBe(false);

    const rt = boot({ hosted: true, hostedMonthly: 1 });
    const mcp = new AetherMcp({ runtime: rt });
    const spend = mcp.callTool("aether_mandate_issue_intent", {
      task: "no",
      constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 1 }],
    }) as { ok: boolean; error: { status: number; type: string } };
    expect(spend.ok).toBe(false);
    expect(spend.error.status).toBe(401);

    const bootHuman = mcp.callTool("aether_identity_register", {
      actor: "system",
      key: "ops-human",
      displayName: "Founder",
      role: "human_operator",
      autonomyLevel: 0,
    }) as { ok: boolean; data: { id: string; speakerKey: ExportedKey } };
    expect(bootHuman.ok).toBe(true);
    expect(bootHuman.data.speakerKey.pkcs8.length).toBeGreaterThan(0);
    const kp = importKeypair(bootHuman.data.speakerKey);
    const invoiceBody = { method: "invoice" };
    const invProof = signSpeaker(kp, { type: "host.invoice", actorId: bootHuman.data.id, body: invoiceBody });
    const billed = mcp.callTool("aether_host_invoice", {
      actorId: bootHuman.data.id,
      speakerProof: invProof,
      method: "invoice",
    }) as { ok: boolean };
    expect(billed.ok).toBe(true);
  });

  it("labels an operator invoice current then lapsed without writing status into the store", () => {
    const rt = boot({ hosted: true, hostedMonthly: 12_000 });
    mustDispatch(
      rt.dispatch(
        cmd("identity.register", "system", {
          key: "ops-human",
          displayName: "Founder",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      ),
    );
    const founder = rt.alias("ops-human");
    const billed = rt.recordHostInvoice(founder.id, { method: "invoice" });
    expect(billed.ok).toBe(true);
    if (!billed.ok) return;
    const id = billed.value.id;
    expect((rt.inspect(id)?.value as { status: string }).status).toBe("current");
    expect(rt.snapshotState().invoices.find((i) => i.id === id)?.status).toBe("current");
    expect("status" in (rt.invoices.get(id) ?? {})).toBe(false);
    rt.clock.set(new Date(Date.parse(rt.clock.now()) + HOST_INVOICE_WINDOW_MS + 1).toISOString());
    expect((rt.inspect(id)?.value as { status: string }).status).toBe("lapsed");
    expect(rt.snapshotState().invoices.find((i) => i.id === id)?.status).toBe("lapsed");
    expect("status" in (rt.invoices.get(id) ?? {})).toBe(false);
    expect(invoiceCurrent(rt)).toBe(false);
  });
});
