import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS_PREV } from "@aether/types";
import { computeAuditHash, genesisRecord, makeRecord, verifyRecords } from "@aether/audit";
import { frozenClock, payloadHash } from "@aether/kernel";

describe("audit chain", () => {
  it("genesis prevHash is 64 zeros", () => {
    const g = genesisRecord(frozenClock("2026-08-28T00:00:00.000Z"), "nonce-1");
    expect(g.prevHash).toBe(AUDIT_GENESIS_PREV);
    expect(g.seq).toBe(0);
    expect(verifyRecords([g]).ok).toBe(true);
  });

  it("detects payload tamper", () => {
    const clock = frozenClock("2026-08-28T00:00:00.000Z");
    const a = genesisRecord(clock, "n");
    const b = makeRecord({
      seq: 1,
      prevHash: a.hash,
      recordedAt: clock.now(),
      actorId: "system",
      action: "JOURNAL_POST",
      subjects: [],
      payload: { n: 1 },
    });
    const tampered = { ...b, payload: { n: 2 } };
    const result = verifyRecords([a, tampered]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/payloadHash/);
  });

  it("detects reorder", () => {
    const clock = frozenClock("2026-08-28T00:00:00.000Z");
    const a = genesisRecord(clock, "n");
    const b = makeRecord({
      seq: 1,
      prevHash: a.hash,
      recordedAt: clock.now(),
      actorId: "system",
      action: "FREEZE",
      subjects: [],
      payload: { x: 1 },
    });
    const result = verifyRecords([b, a]);
    expect(result.ok).toBe(false);
  });

  it("hash matches preimage algorithm", () => {
    const clock = frozenClock("2026-08-28T00:00:00.000Z");
    const g = genesisRecord(clock, "n");
    expect(g.hash).toBe(
      computeAuditHash({
        seq: 0,
        prevHash: AUDIT_GENESIS_PREV,
        recordedAt: g.recordedAt,
        actorId: "system",
        action: "GENESIS",
        payloadHash: payloadHash(g.payload),
      }),
    );
  });
});
