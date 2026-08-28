import { encodeRequired, encodeResponse } from "@aether/envelope";
import { payloadHash } from "@aether/kernel";
import type {
  AccountId,
  CurrencyCode,
  HireId,
  MandateId,
  PaymentMandate,
  PaymentRequired,
  Receipt,
  ReceiptId,
  SettlementResponse,
  TransferId,
  JournalId,
} from "@aether/types";
import { RECEIPT_ISSUER, SIM_RAIL_ID } from "@aether/types";

export function paymentRequired(input: {
  url: string;
  description: string;
  amount: number;
  asset: CurrencyCode;
  payTo: AccountId;
  hireId?: HireId;
  cartId?: MandateId;
  paymentMandateId?: MandateId;
}): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: input.url,
      description: input.description,
      mimeType: "application/json",
    },
    accepted: [
      {
        scheme: "exact",
        network: SIM_RAIL_ID,
        amount: String(input.amount),
        asset: input.asset,
        payTo: input.payTo,
        maxTimeoutSeconds: 60,
        extra: {
          ...(input.hireId ? { hireId: input.hireId } : {}),
          ...(input.cartId ? { cartId: input.cartId } : {}),
          ...(input.paymentMandateId ? { paymentMandateId: input.paymentMandateId } : {}),
        },
      },
    ],
  };
}

export function settlementOk(input: {
  transaction: TransferId;
  payer: AccountId;
  receiptId: ReceiptId;
}): SettlementResponse {
  return {
    success: true,
    transaction: input.transaction,
    network: SIM_RAIL_ID,
    payer: input.payer,
    receiptId: input.receiptId,
  };
}

export function settlementFail(reason: string): SettlementResponse {
  return {
    success: false,
    transaction: null,
    network: SIM_RAIL_ID,
    payer: null,
    errorReason: reason,
  };
}

export function issueReceipt(input: {
  id: ReceiptId;
  payment: PaymentMandate;
  paymentId: TransferId;
  journalId: JournalId;
  hireId?: HireId;
  iat: number;
}): Receipt {
  return {
    id: input.id,
    status: "Success",
    iss: RECEIPT_ISSUER,
    iat: input.iat,
    reference: payloadHash(input.payment),
    payment_id: input.paymentId,
    journalId: input.journalId,
    ...(input.hireId ? { hireId: input.hireId } : {}),
    network_confirmation_id: payloadHash({ journalId: input.journalId, paymentId: input.paymentId }),
  };
}

export { encodeRequired, encodeResponse };

/** The only rail in v0. Live adapters later implement this shape. They do not enter evaluate(). */
export const SIM_RAIL = {
  id: SIM_RAIL_ID,
  live: false as const,
  require: paymentRequired,
  receipt: issueReceipt,
  ok: settlementOk,
  fail: settlementFail,
};
