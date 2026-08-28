import type { AgentId } from "@aether/types";
import { Runtime, cmd, type DispatchResult } from "./index.js";

export function mustDispatch(r: DispatchResult, label: string) {
  if (!r.ok) {
    const extra = r.error.decision.trace
      .filter((t) => t.verdict !== "allow")
      .map((t) => `${t.ruleId}:${t.verdict}`)
      .join(",");
    throw new Error(`${label}: ${r.error.error.detail}${extra ? ` [${extra}]` : ""}`);
  }
  return r.value;
}

export function inviteQuote(
  rt: Runtime,
  input: {
    buyer: AgentId;
    seller: AgentId;
    sku: string;
    spec: string;
    price: { amount: number; currency: "USD_SIM" | "USDC_SIM" };
  },
) {
  const rfq = mustDispatch(
    rt.dispatch(cmd("market.rfq", input.buyer, { sku: input.sku, spec: input.spec, invitedSellerIds: [input.seller] })),
    `rfq ${input.sku}`,
  );
  const quote = mustDispatch(
    rt.dispatch(cmd("market.quote", input.seller, { rfqId: (rfq.data as { id: string }).id, price: input.price })),
    `quote ${input.sku}`,
  );
  return { rfq, quote, quoteId: (quote.data as { id: string }).id };
}

export function offerHire(
  rt: Runtime,
  input: {
    buyer: AgentId;
    seller: AgentId;
    sku: string;
    spec: string;
    price: { amount: number; currency: "USD_SIM" | "USDC_SIM" };
    intentId: string;
  },
) {
  const invited = inviteQuote(rt, input);
  const attempt = rt.dispatch(
    cmd("hire.create", input.buyer, { quoteId: invited.quoteId, intentId: input.intentId }),
  );
  return { ...invited, attempt };
}

export function completeHire(
  rt: Runtime,
  input: {
    buyer: AgentId;
    seller: AgentId;
    sku: string;
    spec: string;
    price: { amount: number; currency: "USD_SIM" | "USDC_SIM" };
    intentId: string;
    qty: number;
    deliverable: unknown;
  },
) {
  const { attempt } = offerHire(rt, input);
  const hire = mustDispatch(attempt, `hire ${input.sku}`);
  const hireId = (hire.data as { id: string }).id;
  finishHire(rt, {
    hireId,
    buyer: input.buyer,
    seller: input.seller,
    sku: input.sku,
    intentId: input.intentId,
    qty: input.qty,
    unitAmount: input.price.amount / input.qty,
    deliverable: input.deliverable,
  });
  return { hireId };
}

export function fundHire(
  rt: Runtime,
  input: {
    hireId: string;
    buyer: AgentId;
    seller: AgentId;
    sku: string;
    intentId: string;
    qty: number;
    unitAmount: number;
  },
) {
  mustDispatch(rt.dispatch(cmd("hire.accept", input.seller, { hireId: input.hireId })), "accept");
  const cart = mustDispatch(
    rt.dispatch(
      cmd("mandate.issue_cart", input.buyer, {
        intentId: input.intentId,
        merchantId: input.seller,
        hireId: input.hireId,
        line_items: [
          {
            sku: input.sku,
            description: input.sku,
            quantity: input.qty,
            unitAmount: { amount: input.unitAmount, currency: "USD_SIM" },
          },
        ],
      }),
    ),
    "cart",
  );
  const payment = mustDispatch(
    rt.dispatch(cmd("mandate.issue_payment", input.buyer, { cartId: (cart.data as { payload: { id: string } }).payload.id })),
    "payment",
  );
  mustDispatch(
    rt.dispatch(
      cmd("hire.fund", input.buyer, {
        hireId: input.hireId,
        paymentMandateId: (payment.data as { payload: { id: string } }).payload.id,
      }),
    ),
    "fund",
  );
  return { hireId: input.hireId, paymentId: (payment.data as { payload: { id: string } }).payload.id };
}

export function finishHire(
  rt: Runtime,
  input: {
    hireId: string;
    buyer: AgentId;
    seller: AgentId;
    sku: string;
    intentId: string;
    qty: number;
    unitAmount: number;
    deliverable: unknown;
  },
) {
  fundHire(rt, input);
  mustDispatch(rt.dispatch(cmd("hire.deliver", input.seller, { hireId: input.hireId, deliverable: input.deliverable })), "deliver");
  mustDispatch(rt.dispatch(cmd("envelope.require", input.seller, { hireId: input.hireId })), "require");
  mustDispatch(
    rt.dispatch(
      cmd("envelope.submit", input.buyer, {
        hireId: input.hireId,
        nonce: `nonce-${input.hireId}`,
      }),
    ),
    "submit",
  );
}
