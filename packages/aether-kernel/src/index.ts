/**
 * Kernel primitives: hashing, RFC 8785-subset canonical JSON, money, clock, errors, IDs, Ed25519.
 * Implementers: replace nothing here without updating DESIGN.md §0 and the audit preimage.
 */

import {
  createHash,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import type { AetherError, CurrencyCode, HexSha256, Money } from "@aether/types";

export type Clock = { now(): string };

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export function frozenClock(iso: string): Clock {
  return { now: () => iso };
}

export class ManualClock implements Clock {
  private t: number;
  constructor(startIso: string) {
    this.t = Date.parse(startIso);
  }
  now(): string {
    return new Date(this.t).toISOString();
  }
  step(ms = 1000): string {
    this.t += ms;
    return this.now();
  }
}

export function steppingClock(startIso: string, stepMs = 1000): Clock {
  let t = Date.parse(startIso);
  return {
    now() {
      const iso = new Date(t).toISOString();
      t += stepMs;
      return iso;
    },
  };
}

export function sha256Hex(data: string | Uint8Array): HexSha256 {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * RFC 8785 JCS subset sufficient for Aether objects:
 * - objects: keys sorted lexicographically, no undefined values
 * - arrays: preserve order
 * - numbers: integers only (reject non-integers)
 * - no insignificant whitespace
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) {
    throw new Error("canonicalJson rejects undefined");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`canonicalJson rejects non-integer number: ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(`canonicalJson rejects unsafe integer: ${value}`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${serialize(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalJson rejects type ${typeof value}`);
}

export function payloadHash(payload: unknown): HexSha256 {
  return sha256Hex(canonicalJson(payload));
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amount)) throw new Error("amount must be integer minor units");
  return { amount, currency };
}

export function err(
  code: string,
  title: string,
  status: AetherError["status"],
  detail: string,
  extra?: AetherError["extra"],
): AetherError {
  return {
    type: `https://aether.dev/errors/${code}`,
    title,
    status,
    detail,
    instance: extra?.seq !== undefined ? `seq:${extra.seq}` : code,
    ...(extra ? { extra } : {}),
  };
}

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function fail<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// IDs — Crockford ULID. Entropy is a counter so frozen clocks stay deterministic.
// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeCrockford(value: bigint, length: number): string {
  let out = "";
  let n = value;
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[Number(n % 32n)] + out;
    n /= 32n;
  }
  return out;
}

export function encodeUlid(timeMs: number, counter: number): string {
  const time = encodeCrockford(BigInt(timeMs), 10);
  const rand = encodeCrockford(BigInt(counter), 16);
  return `${time}${rand}`;
}

export class IdFactory {
  private n = 0;
  constructor(private readonly clock: Clock) {}

  next(prefix: string): string {
    this.n += 1;
    const ms = Date.parse(this.clock.now());
    return `${prefix}_${encodeUlid(Number.isFinite(ms) ? ms : 0, this.n)}`;
  }
}

export function b64url(data: Buffer | Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return buf.toString("base64url");
}

export function b64std(data: Buffer | Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return buf.toString("base64");
}

export function fromB64std(s: string): Buffer {
  return Buffer.from(s, "base64");
}

export interface Ed25519Keypair {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  x: string;
}

export function generateEd25519(kid: string): Ed25519Keypair {
  const pair = generateKeyPairSync("ed25519");
  const der = pair.publicKey.export({ type: "spki", format: "der" });
  const x = Buffer.from(der.subarray(-32)).toString("base64url");
  return { kid, privateKey: pair.privateKey, publicKey: pair.publicKey, x };
}

export function signBytes(privateKey: KeyObject, message: string): string {
  const sig = nodeSign(null, Buffer.from(message, "utf8"), privateKey);
  return b64url(sig);
}

export function verifyBytes(publicKey: KeyObject, message: string, signatureB64url: string): boolean {
  try {
    return nodeVerify(null, Buffer.from(message, "utf8"), publicKey, Buffer.from(signatureB64url, "base64url"));
  } catch {
    return false;
  }
}

export function compactJws(payload: unknown, privateKey: KeyObject, kid: string): string {
  const header = { alg: "EdDSA", kid, typ: "aether+jws" };
  const h = b64url(JSON.stringify(header));
  const p = b64url(canonicalJson(payload));
  const sig = signBytes(privateKey, `${h}.${p}`);
  return `${h}.${p}.${sig}`;
}

export function parseJws<T>(jws: string): { header: { kid: string; alg: string }; payload: T; signingInput: string; signature: string } {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("jws must have 3 parts");
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { kid: string; alg: string };
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as T;
  return { header, payload, signingInput: `${h}.${p}`, signature: s };
}

export function unixSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}
