import { b64std, canonicalJson, fromB64std, signBytes, verifyBytes, type Ed25519Keypair } from "@aether/kernel";
import type { PaymentPayload, PaymentPayloadInner, PaymentRequired, SettlementResponse } from "@aether/types";

export function encodeRequired(body: PaymentRequired): string {
  return b64std(JSON.stringify(body));
}

export function encodePayload(body: PaymentPayload): string {
  return b64std(JSON.stringify(body));
}

export function encodeResponse(body: SettlementResponse): string {
  return b64std(JSON.stringify(body));
}

export function decodeRequired(header: string): PaymentRequired {
  return JSON.parse(fromB64std(header).toString("utf8")) as PaymentRequired;
}

export function decodePayload(header: string): PaymentPayload {
  return JSON.parse(fromB64std(header).toString("utf8")) as PaymentPayload;
}

export function decodeResponse(header: string): SettlementResponse {
  return JSON.parse(fromB64std(header).toString("utf8")) as SettlementResponse;
}

export function unsignedInner(inner: PaymentPayloadInner): Omit<PaymentPayloadInner, "signature"> {
  const { signature: _s, ...rest } = inner;
  return rest;
}

export function signInner(inner: Omit<PaymentPayloadInner, "signature">, keypair: Ed25519Keypair): PaymentPayloadInner {
  const signature = signBytes(keypair.privateKey, canonicalJson(inner));
  return { ...inner, signature };
}

export function verifyInner(inner: PaymentPayloadInner, keypair: Ed25519Keypair): boolean {
  return verifyBytes(keypair.publicKey, canonicalJson(unsignedInner(inner)), inner.signature);
}
