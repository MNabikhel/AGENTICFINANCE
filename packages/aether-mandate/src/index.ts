import {
  canonicalJson,
  compactJws,
  parseJws,
  payloadHash,
  unixSeconds,
  verifyBytes,
  type Ed25519Keypair,
} from "@aether/kernel";
import type {
  CartMandate,
  IntentMandate,
  PaymentMandate,
  Result,
  Signed,
} from "@aether/types";
import { err } from "@aether/kernel";
import type { AetherError } from "@aether/types";

export function signMandate<T>(payload: T, issuerDid: Signed<T>["issuer"], keypair: Ed25519Keypair): Signed<T> {
  return {
    payload,
    issuer: issuerDid,
    kid: keypair.kid,
    alg: "EdDSA",
    jws: compactJws(payload, keypair.privateKey, keypair.kid),
  };
}

export function verifyJws<T>(signed: Signed<T>, keypair: Ed25519Keypair): boolean {
  try {
    const parsed = parseJws<T>(signed.jws);
    if (parsed.header.kid !== keypair.kid) return false;
    if (payloadHash(parsed.payload) !== payloadHash(signed.payload)) return false;
    return verifyBytes(keypair.publicKey, parsed.signingInput, parsed.signature);
  } catch {
    return false;
  }
}

export function intentHash(intent: IntentMandate): string {
  return payloadHash(intent);
}

export function cartHash(cart: CartMandate): string {
  return payloadHash(cart);
}

export function paymentHash(payment: PaymentMandate): string {
  return payloadHash(payment);
}

export function verifyChain(input: {
  intent: Signed<IntentMandate>;
  cart: Signed<CartMandate>;
  payment: Signed<PaymentMandate>;
  intentKey: Ed25519Keypair;
  cartKey: Ed25519Keypair;
  paymentKey: Ed25519Keypair;
  nowIso: string;
  /**
   * When false, skip exp / expiresAt. Completing a funded hire after the
   * checkout window still verifies signatures and hashes. Default true.
   */
  checkExp?: boolean;
}): Result<true, AetherError> {
  if (!verifyJws(input.intent, input.intentKey)) {
    return { ok: false, error: err("mandate.jws", "Bad intent JWS", 401, "intent signature invalid") };
  }
  if (!verifyJws(input.cart, input.cartKey)) {
    return { ok: false, error: err("mandate.jws", "Bad cart JWS", 401, "cart signature invalid") };
  }
  if (!verifyJws(input.payment, input.paymentKey)) {
    return { ok: false, error: err("mandate.jws", "Bad payment JWS", 401, "payment signature invalid") };
  }
  if (input.cart.payload.intentHash !== intentHash(input.intent.payload)) {
    return { ok: false, error: err("mandate.hash", "Intent hash mismatch", 422, "cart.intentHash != sha256(intent)") };
  }
  if (input.cart.payload.intentId !== input.intent.payload.id) {
    return { ok: false, error: err("mandate.link", "Cart/intent id mismatch", 422, "cart.intentId") };
  }
  if (input.payment.payload.transaction_id !== cartHash(input.cart.payload)) {
    return {
      ok: false,
      error: err("mandate.hash", "Cart hash mismatch", 422, "payment.transaction_id != sha256(cart)"),
    };
  }
  if (input.payment.payload.payee.id !== input.cart.payload.merchant.id) {
    return { ok: false, error: err("mandate.payee", "Payee mismatch", 422, "payment.payee != cart.merchant") };
  }
  const pay = input.payment.payload.payment_amount;
  const tot = input.cart.payload.total;
  if (pay.amount !== tot.amount || pay.currency !== tot.currency) {
    return { ok: false, error: err("mandate.amount", "Amount mismatch", 422, "payment_amount != cart.total") };
  }
  if (input.checkExp !== false) {
    const nowSec = unixSeconds(input.nowIso);
    if (input.intent.payload.exp <= nowSec || input.payment.payload.exp <= nowSec) {
      return { ok: false, error: err("mandate.exp", "Mandate expired", 422, "exp") };
    }
    if (Date.parse(input.cart.payload.expiresAt) <= Date.parse(input.nowIso)) {
      return { ok: false, error: err("mandate.exp", "Cart expired", 422, "expiresAt") };
    }
  }
  return { ok: true, value: true };
}

export function canonicalBytes(value: unknown): string {
  return canonicalJson(value);
}
