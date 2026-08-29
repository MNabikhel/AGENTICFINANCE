import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Runtime, cmd } from "@aether/runtime";
import { PROTOCOL } from "@aether/types";

function durable(dir: string) {
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISWORLD000001",
    dailyLimit: 10_000_000,
    dataDir: dir,
  });
}

describe("durable world", () => {
  it("restores identities, keys, and the notary across process restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-world-"));
    try {
      const a = durable(dir);
      const founder = a.dispatch(
        cmd("identity.register", "system", {
          key: "ops-human",
          displayName: "Founder",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      );
      expect(founder.ok).toBe(true);
      const id = a.alias("ops-human").id;
      const head = a.audit.head();
      const auditLen = a.audit.length;

      const intent = a.dispatch(
        cmd("mandate.issue_intent", id, {
          subjectId: id,
          task: "prove keys survive restart",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100 }],
        }),
      );
      expect(intent.ok).toBe(true);

      const b = durable(dir);
      expect(b.alias("ops-human").id).toBe(id);
      expect(b.alias("ops-human").displayName).toBe("Founder");
      expect(b.audit.head()).toBe(a.audit.head());
      expect(b.audit.length).toBe(a.audit.length);
      expect(b.audit.verify().ok).toBe(true);
      expect(b.protocolCard().spec).toBe(PROTOCOL.spec);
      expect(b.protocolCard().liveMoney).toBe(false);
      expect(b.protocolCard().durable).toBe(true);
      expect(b.intents.size).toBe(1);

      const again = b.dispatch(
        cmd("mandate.issue_intent", id, {
          subjectId: id,
          task: "second slip after reboot",
          constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 50 }],
        }),
      );
      expect(again.ok).toBe(true);
      expect(b.audit.length).toBeGreaterThan(auditLen);
      expect(b.audit.head()).not.toBe(head);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("archives exposure in a settlement window and restores the photo", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-window-"));
    try {
      const a = durable(dir);
      a.dispatch(
        cmd("identity.register", "system", {
          key: "ops-human",
          displayName: "Founder",
          role: "human_operator",
          autonomyLevel: 0,
        }),
      );
      const founder = a.alias("ops-human");
      a.dispatch(
        cmd("identity.register", founder.id, {
          key: "treasury",
          displayName: "Treasury",
          role: "treasury",
          autonomyLevel: 3,
        }),
      );
      const buyer = "aid_buyer00000000000000000001" as const;
      const seller = "aid_seller0000000000000000001" as const;
      a.clearing.record(buyer, seller, 80000, "USD_SIM");
      a.clearing.record(seller, buyer, 30000, "USD_SIM");
      a.persistWorld();

      const treasury = a.alias("treasury");
      const win = a.dispatch(cmd("clearing.settle_window", treasury.id, { currency: "USD_SIM" }));
      expect(win.ok).toBe(true);
      if (!win.ok) return;
      const data = win.value.data as { nets: Array<{ net: number }>; grossVolume: number; netVolume: number; legsConsumed: number };
      expect(data.legsConsumed).toBe(2);
      expect(data.grossVolume).toBe(110000);
      expect(data.netVolume).toBe(50000);
      expect(a.clearing.snapshot().legs).toEqual([]);

      const b = durable(dir);
      expect(b.clearing.windows).toHaveLength(1);
      expect(b.clearing.windows[0]?.netVolume).toBe(50000);
      expect(b.clearing.snapshot().legs).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not persist a TAP bilateralLimit; restore without the option is the public default", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-limit-"));
    try {
      const a = new Runtime({
        startIso: "2026-08-28T00:00:00.000Z",
        genesisNonce: "01J6AETHERGENESISWORLD000002",
        dailyLimit: 10_000_000,
        dataDir: dir,
        bilateralLimit: 100000,
      });
      expect(a.clearing.snapshot().bilateralLimit).toBe(100000);
      a.persistWorld();
      const raw = JSON.parse(readFileSync(join(dir, "world.json"), "utf8")) as {
        clearing: { bilateralLimit?: number; legs: unknown[]; windows: unknown[] };
      };
      expect(raw.clearing.bilateralLimit).toBeUndefined();

      const b = durable(dir);
      expect(b.clearing.snapshot().bilateralLimit).toBe(50_000_000);

      const c = new Runtime({
        startIso: "2026-08-28T00:00:00.000Z",
        genesisNonce: "01J6AETHERGENESISWORLD000002",
        dailyLimit: 10_000_000,
        dataDir: dir,
        bilateralLimit: 100000,
      });
      expect(c.clearing.snapshot().bilateralLimit).toBe(100000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("synthesizes genesis KYA issuers when an old world omits them", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-kya-iss-"));
    try {
      const a = durable(dir);
      expect(a.kya.issuers.size).toBe(4);
      a.persistWorld();
      const raw = JSON.parse(readFileSync(join(dir, "world.json"), "utf8")) as {
        v: number;
        kya: { issuers?: unknown[] };
      };
      expect(raw.v).toBe(1);
      delete raw.kya.issuers;
      writeFileSync(join(dir, "world.json"), JSON.stringify(raw));
      const b = durable(dir);
      expect(b.kya.issuers.size).toBe(4);
      expect(b.kya.issuerOfKind("aether.self").live).toBe(false);
      expect(b.kya.issuerOfKind("erc8004.agent").adapter).toBe("shape");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
