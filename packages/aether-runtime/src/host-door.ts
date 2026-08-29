/**
 * Hosted-operator door. Around the kernel, not inside evaluate().
 * Public kernel: actor in JSON is fine. Paid host: named speakers prove Ed25519.
 * Monthly invoice is access to the host, not a money verdict on a hire.
 */

import {
  canonicalJson,
  err,
  exportKeypair,
  signBytes,
  verifyBytes,
  type Ed25519Keypair,
  type ExportedKeypair,
} from "@aether/kernel";
import { DAY_MS, type AgentId, type AetherError, type CommandType } from "@aether/types";

export interface HostDoorRuntime {
  hosted: boolean;
  hostedMonthly: number | null;
  clock: { now(): string };
  invoices: Map<string, { at: string }>;
  speakerOf(input: { actor?: unknown; actorId?: unknown }): AgentId | "system";
  identity: { keys: Map<AgentId, Ed25519Keypair> };
}

export const HOST_INVOICE_WINDOW_MS = 31 * DAY_MS;

export function speakerMessage(input: {
  type: string;
  actorId: AgentId | "system";
  body: Record<string, unknown>;
  idempotencyKey?: string;
}): string {
  const payload: Record<string, unknown> = { type: input.type, actorId: input.actorId, body: input.body };
  if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 0) {
    payload.idempotencyKey = input.idempotencyKey;
  }
  return canonicalJson(payload);
}

export function signSpeaker(
  keypair: Ed25519Keypair,
  input: {
    type: string;
    actorId: AgentId | "system";
    body: Record<string, unknown>;
    idempotencyKey?: string;
  },
): string {
  return signBytes(keypair.privateKey, speakerMessage(input));
}

export function speakerKeyOf(rt: HostDoorRuntime, agentId: AgentId): ExportedKeypair | undefined {
  const kp = rt.identity.keys.get(agentId);
  return kp ? exportKeypair(kp) : undefined;
}

export type AdmitOk = { ok: true; actorId: AgentId | "system" };
export type AdmitFail = { ok: false; error: AetherError };
export type AdmitResult = AdmitOk | AdmitFail;

function failDoor(code: string, title: string, status: AetherError["status"], detail: string): AdmitFail {
  return { ok: false, error: err(code, title, status, detail) };
}

/** Commands that stay open on a hosted operator without a speaker proof (system speaker). */
export function hostedSystemOpen(type: CommandType): boolean {
  return (
    type === "host.card" ||
    type === "market.catalog" ||
    type === "audit.query" ||
    type === "audit.verify" ||
    type === "ledger.balances" ||
    type === "receipt.get" ||
    type === "identity.register"
  );
}

export function invoiceCurrent(rt: HostDoorRuntime, atIso = rt.clock.now()): boolean {
  if (rt.hostedMonthly === null || rt.hostedMonthly <= 0) return true;
  const now = Date.parse(atIso);
  if (!Number.isFinite(now)) return false;
  for (const inv of rt.invoices.values()) {
    const at = Date.parse(inv.at);
    if (Number.isFinite(at) && now - at <= HOST_INVOICE_WINDOW_MS) return true;
  }
  return false;
}

export function admitSpeaker(
  rt: HostDoorRuntime,
  input: {
    type: CommandType;
    actor?: unknown;
    actorId?: unknown;
    body: Record<string, unknown>;
    idempotencyKey?: string;
    proof?: string;
  },
): AdmitResult {
  const actorId = rt.speakerOf({ actor: input.actor, actorId: input.actorId });
  if (!rt.hosted) return { ok: true, actorId };

  if (actorId === "system") {
    if (!hostedSystemOpen(input.type)) {
      return failDoor(
        "speaker.proof",
        "Speaker proof required",
        401,
        "hosted operator does not take unsigned system spend",
      );
    }
    return { ok: true, actorId: "system" };
  }

  const proof = input.proof;
  if (typeof proof !== "string" || proof.length === 0) {
    return failDoor("speaker.proof", "Speaker proof required", 401, "hosted named speaker must sign");
  }
  const kp = rt.identity.keys.get(actorId);
  if (!kp) {
    return failDoor("speaker.proof", "Speaker proof required", 401, "unknown hosted speaker");
  }
  const msgInput: {
    type: CommandType;
    actorId: AgentId | "system";
    body: Record<string, unknown>;
    idempotencyKey?: string;
  } = { type: input.type, actorId, body: input.body };
  if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 0) {
    msgInput.idempotencyKey = input.idempotencyKey;
  }
  if (!verifyBytes(kp.publicKey, speakerMessage(msgInput), proof)) {
    return failDoor("speaker.proof", "Speaker proof required", 401, "hosted speaker proof failed");
  }

  if (input.type !== "host.card" && !invoiceCurrent(rt)) {
    return failDoor(
      "host.unpaid",
      "Host invoice required",
      402,
      "hosted operator requires a current monthly invoice from a human",
    );
  }
  return { ok: true, actorId };
}

/** Record an invoice: named speaker must sign, but an unpaid host must still be able to pay. */
export function admitInvoice(
  rt: HostDoorRuntime,
  input: {
    actor?: unknown;
    actorId?: unknown;
    body: Record<string, unknown>;
    proof?: string;
  },
): AdmitResult {
  const actorId = rt.speakerOf({ actor: input.actor, actorId: input.actorId });
  if (!rt.hosted) {
    return failDoor("host.not_hosted", "Not a hosted operator", 422, "public kernel does not invoice");
  }
  if (actorId === "system") {
    return failDoor("speaker.proof", "Speaker proof required", 401, "system does not invoice this host");
  }
  const proof = input.proof;
  if (typeof proof !== "string" || proof.length === 0) {
    return failDoor("speaker.proof", "Speaker proof required", 401, "hosted named speaker must sign");
  }
  const kp = rt.identity.keys.get(actorId);
  if (!kp) {
    return failDoor("speaker.proof", "Speaker proof required", 401, "unknown hosted speaker");
  }
  const message = speakerMessage({ type: "host.invoice", actorId, body: input.body });
  if (!verifyBytes(kp.publicKey, message, proof)) {
    return failDoor("speaker.proof", "Speaker proof required", 401, "hosted speaker proof failed");
  }
  return { ok: true, actorId };
}

export function parseHostedMonthly(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return undefined;
  return n;
}
