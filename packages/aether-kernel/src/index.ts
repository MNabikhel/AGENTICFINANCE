/**
 * Kernel primitives: hashing, RFC 8785-subset canonical JSON, money, clock, errors.
 * Implementers: replace nothing here without updating DESIGN.md §0 and the audit preimage.
 */

import { createHash } from "node:crypto";
import type { AetherError, CurrencyCode, HexSha256, Money } from "@aether/types";

export type Clock = { now(): string };

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export function frozenClock(iso: string): Clock {
  return { now: () => iso };
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
