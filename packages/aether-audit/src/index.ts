/**
 * Hash-chained audit log.
 *
 * preimage = UTF8(
 *   "aether-audit-v1" + "\n" +
 *   decimal(seq)      + "\n" +
 *   prevHash          + "\n" +
 *   recordedAt        + "\n" +
 *   actorId           + "\n" +
 *   action            + "\n" +
 *   payloadHash
 * )
 * hash = SHA256_HEX(preimage)
 *
 * File: append-only JSONL. Never rewrite. Compaction is out of v0.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  AUDIT_DOMAIN,
  AUDIT_GENESIS_PREV,
  type AgentId,
  type AuditAction,
  type AuditRecord,
  type AuditSubject,
  type AuditVerifyResult,
  type HexSha256,
  type Instant,
} from "@aether/types";
import { payloadHash, sha256Hex, type Clock } from "@aether/kernel";

export function auditPreimage(input: {
  seq: number;
  prevHash: HexSha256;
  recordedAt: Instant;
  actorId: AgentId | "system";
  action: AuditAction;
  payloadHash: HexSha256;
}): string {
  return [
    AUDIT_DOMAIN,
    String(input.seq),
    input.prevHash,
    input.recordedAt,
    input.actorId,
    input.action,
    input.payloadHash,
  ].join("\n");
}

export function computeAuditHash(input: {
  seq: number;
  prevHash: HexSha256;
  recordedAt: Instant;
  actorId: AgentId | "system";
  action: AuditAction;
  payloadHash: HexSha256;
}): HexSha256 {
  return sha256Hex(auditPreimage(input));
}

export function makeRecord(args: {
  seq: number;
  prevHash: HexSha256;
  recordedAt: Instant;
  actorId: AgentId | "system";
  action: AuditAction;
  subjects: AuditSubject[];
  payload: unknown;
}): AuditRecord {
  const pHash = payloadHash(args.payload);
  const hash = computeAuditHash({
    seq: args.seq,
    prevHash: args.prevHash,
    recordedAt: args.recordedAt,
    actorId: args.actorId,
    action: args.action,
    payloadHash: pHash,
  });
  return {
    v: 1,
    seq: args.seq,
    prevHash: args.prevHash,
    recordedAt: args.recordedAt,
    actorId: args.actorId,
    action: args.action,
    subjects: args.subjects,
    payload: args.payload,
    payloadHash: pHash,
    hash,
  };
}

export function genesisRecord(clock: Clock, nonce: string): AuditRecord {
  return makeRecord({
    seq: 0,
    prevHash: AUDIT_GENESIS_PREV,
    recordedAt: clock.now(),
    actorId: "system",
    action: "GENESIS",
    subjects: [],
    payload: { nonce },
  });
}

export class AuditLog {
  private records: AuditRecord[] = [];

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      const text = readFileSync(path, "utf8").trim();
      if (text.length > 0) {
        this.records = text.split("\n").map((line) => JSON.parse(line) as AuditRecord);
      }
    }
  }

  get length(): number {
    return this.records.length;
  }

  head(): HexSha256 | typeof AUDIT_GENESIS_PREV {
    const last = this.records[this.records.length - 1];
    return last ? last.hash : AUDIT_GENESIS_PREV;
  }

  append(args: {
    clock: Clock;
    actorId: AgentId | "system";
    action: AuditAction;
    subjects?: AuditSubject[];
    payload: unknown;
  }): AuditRecord {
    const record = makeRecord({
      seq: this.records.length,
      prevHash: this.head(),
      recordedAt: args.clock.now(),
      actorId: args.actorId,
      action: args.action,
      subjects: args.subjects ?? [],
      payload: args.payload,
    });
    this.records.push(record);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(record)}\n`, { flag: "a" });
    }
    return record;
  }

  verify(): AuditVerifyResult {
    return verifyRecords(this.records);
  }

  all(): readonly AuditRecord[] {
    return this.records;
  }
}

export function verifyRecords(records: readonly AuditRecord[]): AuditVerifyResult {
  if (records.length === 0) {
    return { ok: false, seq: -1, reason: "empty chain" };
  }
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.v !== 1) return { ok: false, seq: i, reason: "unsupported version" };
    if (r.seq !== i) return { ok: false, seq: i, reason: `seq ${r.seq} !== index ${i}` };
    const expectedPrev = i === 0 ? AUDIT_GENESIS_PREV : records[i - 1]!.hash;
    if (r.prevHash !== expectedPrev) {
      return { ok: false, seq: i, reason: "prevHash mismatch" };
    }
    const expectedPayloadHash = payloadHash(r.payload);
    if (r.payloadHash !== expectedPayloadHash) {
      return { ok: false, seq: i, reason: "payloadHash mismatch (payload tampered)" };
    }
    const expectedHash = computeAuditHash({
      seq: r.seq,
      prevHash: r.prevHash,
      recordedAt: r.recordedAt,
      actorId: r.actorId,
      action: r.action,
      payloadHash: r.payloadHash,
    });
    if (r.hash !== expectedHash) {
      return { ok: false, seq: i, reason: "hash mismatch (record tampered)" };
    }
  }
  return { ok: true, head: records[records.length - 1]!.hash, length: records.length };
}
