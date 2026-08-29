# Aether — Agent Economic Runtime

**Product name:** Aether  
**Thesis:** Aether is a machine-first economic runtime that lets software agents hire, pay, escalate, and settle against a deterministic policy engine — using an in-memory/file ledger today and AP2/x402-*shaped* envelopes tomorrow — without becoming a trading bot or a checkout clone.

This document is the implementation contract. Another engineer should be able to build v0 from this file plus `packages/aether-types` without reading AP2 or x402 source. Do **not** copy those codebases. Match **shape** (field roles, envelope stages, mandate chain) only.

---

## 0. Non-negotiable constraints

| Constraint | How Aether satisfies it |
|---|---|
| Works today, no bank/crypto credentials | Single simulated rail `sim:aether-1`. Double-entry ledger in RAM + durable `world.json`. Facilitator is in-process. |
| Machine-first | JSON Schema is source of truth. OpenAPI for HTTP. MCP tools wrap the same commands. Policy engine is pure, ordered, no LLM. |
| Public ≠ live | `aether.protocol.1` is pin-able now (`liveMoney: false`). Live rails are adapters later. `AETHER_DATA_DIR` makes a hosted sim survive restart. |
| Autonomy ladder | Every agent has a level L0–L5. Every spendable action declares a minimum level. Escalation is a first-class object, not a log line. |
| AP2-compatible **shape** | Three-mandate chain: Intent → Cart → Payment. Closed payment binds to cart via hash. Open mandate carries constraints. Receipt binds to closed payment via hash. |
| x402-compatible **shape** | Three envelopes: PaymentRequired (402) → PaymentPayload (signed) → SettlementResponse. Headers exist even on the sim transport. |
| Multi-agent simulated economy | Six scripted agents: treasury, procurement, data vendor, compute vendor, market maker, auditor. |
| Hash-chained audit | Every state mutation appends one audit record. `hash = SHA-256(domain \|\| seq \|\| prevHash \|\| …)`. Genesis `prevHash` is 64 zero hex chars. |

**Clock:** inject `Clock.now(): Instant`. Default is system UTC. Demo uses a frozen/steppable clock. Never call `Date.now()` inside policy or hashing.

**IDs:** `aid_<ulid>` agents, `mid_<ulid>` mandates, `hid_<ulid>` hires, `tid_<ulid>` transfers, `rid_<ulid>` receipts, `apd_<ulid>` approvals, `jnl_<ulid>` journal entries, `rfq_<ulid>` RFQs, `qte_<ulid>` quotes, `dlg_<ulid>` KYA delegations, `hsb_<ulid>` host subscriptions, `inv_<ulid>` operator invoices, `win_<ulid>` settlement windows. ULID Crockford base32, 26 chars.

**Money:** integer **minor units** only. Safe integers only (`Number.isSafeInteger`). `USD_SIM` and `USDC_SIM` both have `decimals = 2`. Never use IEEE floats for amounts. JSON encodes `amount` as integer, `currency` as string. One cart is one currency. A line whose `unitAmount × quantity` overflows, or an FX `price × rateE6` that cannot be an integer cent, is `command.malformed`. A journal whose resulting book is not a safe integer is `ledger.safe_balance` — IEEE rounding is not a mint.

**Canonical JSON:** RFC 8785 JCS. UTF-8. That bytestring is what you hash. If a library is missing, implement the subset we use: sorted object keys, no insignificant whitespace, integers without exponent, reject `undefined`.

---

## 1. Module architecture

Monorepo. pnpm workspaces + TypeScript project references. Node 22. ESM only.

```
aether/
  package.json                         # "packageManager": "pnpm@9", workspaces
  pnpm-workspace.yaml                  # packages/*, apps/*, schemas
  tsconfig.base.json
  DESIGN.md                            # this file
  schemas/                             # JSON Schema draft 2020-12 — source of truth
    money.schema.json
    identity.schema.json
    mandate.schema.json
    envelope.schema.json
    policy.schema.json
    ledger.schema.json
    hire.schema.json
    receipt.schema.json
    audit.schema.json
    approval.schema.json
    market.schema.json
  packages/
    aether-kernel/                     # IDs, Money, Clock, Result, hashing, errors
    aether-types/                      # ALL canonical TS types (re-export schemas)
    aether-identity/                   # register agents, keypairs, DID docs
    aether-mandate/                    # issue/verify Intent→Cart→Payment chain
    aether-envelope/                   # x402-shaped encode/decode (base64 headers)
    aether-policy/                     # ordered rule table, no I/O
    aether-ledger/                     # in-memory store + JSONL persistence
    aether-audit/                      # append + verify hash chain
    aether-settlement/                 # sim facilitator: verify payload, post journal, emit receipt
    aether-escrow/                     # hire lifecycle: offer → accept → fund → deliver → release/refund
    aether-market/                     # RFQ + quote. Catalog of SKUs. NOT an order book
    aether-runtime/                    # command bus: validate → policy → mutate → audit
    aether-openapi/                    # handwritten OpenAPI 3.1 (GET /openapi.yaml)
    aether-mcp/                        # MCP server exposing Runtime commands
  apps/
    runtime-http/                      # node:http. Serves OpenAPI. Same commands as MCP
    cli/                               # `aether demo`, `aether audit verify`, `aether ledger replay`
    fixtures/
      demo/sprint-procurement/           # human-in-the-loop shopping TAP
      demo/night-watch/                  # L5 standing mandate, KYA, circuit, freeze
      demo/sub-hire/                     # L4 nested slips, parent budget, child handshake
      demo/clearing-window/              # bilateral credit, settlement photo, not a second payment
      demo/refund/                       # unwind funded escrow; quote stays spent; circuit stays sticky
      demo/replay/                       # a retry of an allow is not a second spend
      demo/nonce/                        # envelope nonce is one-shot; leftover nonce on a transfer is not
      demo/deny-cache/                   # a deny is never a cached success
      demo/recurrence/                   # a one-slot cadence is not an open checkbook
      demo/calendar/                     # a closed calendar is not a freeze on funded work
      demo/slot/                         # a refund does not restore a cadence slot
      demo/daily/                        # a cadence is a gap, not a burst
      demo/cart/                         # occupancy is a bind, not a field on fund
      demo/velocity/                     # a hot hour is not a freeze on funded work
      demo/door/                         # the public kernel is not a hosted checkout
      demo/match/                        # a cheaper cart is not a discount
      demo/room/                         # a closed room is not a bulletin board
      demo/conversion/                   # an FX window is not a hire
      demo/pair/                         # a second live hop is not a tighter grant
      demo/band/                         # a 200bps band is not decoration
      demo/nest/                         # a nested hop does not outlive its parent
  data/                                # gitignored. ledger.jsonl + audit.jsonl at runtime
```

### Package dependency DAG (strict)

```
kernel ← types
types  ← identity, mandate, envelope, policy, ledger, audit, hire/escrow, market, receipt
runtime ← (all of the above) + settlement
mcp, openapi, runtime-http, cli ← runtime
```

`aether-policy` must not import ledger or settlement. It receives a `PolicyContext` snapshot. This keeps evaluation deterministic and unit-testable.

### What each package *does* (implementation checklist)

| Package | Public surface | Persistence |
|---|---|---|
| `aether-kernel` | `ulid()`, `sha256Hex()`, `canonicalJson()`, `Money`, `Clock`, `AetherError` | none |
| `aether-identity` | `register`, `rotate`, `get` | identity table in ledger store |
| `aether-mandate` | `issueIntent`, `issueCart`, `issuePayment`, `revokeIntent`, `verifyChain` | mandate table |
| `aether-envelope` | `encodeRequired`, `encodePayload`, `encodeResponse`, header helpers | none |
| `aether-policy` | `evaluate(ctx) → PolicyDecision` | none |
| `aether-ledger` | `post(journal)`, `balance(accountId)`, `replay(jsonl)` | `data/ledger.jsonl` |
| `aether-audit` | `append(event)`, `verify(chain)`, `head()` | `data/audit.jsonl` |
| `aether-settlement` | `requirePayment`, `submitPayment`, `getReceipt` | via ledger + audit |
| `aether-escrow` | `createHire`, `acceptHire`, `fundHire`, `deliver`, `release`, `refund`, `voidHire` | hire table + ledger |
| `aether-market` | `createRfq`, `submitQuote`, `acceptQuote`, `withdrawQuote` | rfq/quote tables |
| `aether-runtime` | `dispatch(command)` | `data/world.json` + orchestrates all |

### Transport map (one command bus, three faces)

Every mutating operation is a `Command` with a `commandType` string. HTTP, MCP, and CLI all construct the same command.

| Command | HTTP | MCP tool |
|---|---|---|
| `identity.register` | `POST /v1/identities` | `aether_identity_register` |
| `identity.freeze` | `POST /v1/agents/{id}/freeze` | `aether_identity_freeze` |
| `identity.unfreeze` | `POST /v1/agents/{id}/unfreeze` | `aether_identity_unfreeze` |
| `identity.rotate` | `POST /v1/agents/{id}/rotate` | `aether_identity_rotate` |
| `mandate.issue_intent` | `POST /v1/mandates/intent` | `aether_mandate_issue_intent` |
| `mandate.revoke` | `POST /v1/mandates/{id}/revoke` | `aether_mandate_revoke` |
| `mandate.issue_cart` | `POST /v1/mandates/cart` | `aether_mandate_issue_cart` |
| `mandate.issue_payment` | `POST /v1/mandates/payment` | `aether_mandate_issue_payment` |
| `market.rfq` | `POST /v1/rfqs` | `aether_market_rfq` |
| `market.quote` | `POST /v1/quotes` | `aether_market_quote` |
| `market.withdraw` | `POST /v1/quotes/{id}/withdraw` | `aether_market_withdraw` |
| `hire.create` | `POST /v1/hires` | `aether_hire_create` |
| `hire.accept` | `POST /v1/hires/{id}/accept` | `aether_hire_accept` |
| `hire.fund` | `POST /v1/hires/{id}/fund` | `aether_hire_fund` |
| `hire.deliver` | `POST /v1/hires/{id}/deliver` | `aether_hire_deliver` |
| `hire.release` | `POST /v1/hires/{id}/release` | `aether_hire_release` |
| `hire.refund` | `POST /v1/hires/{id}/refund` | `aether_hire_refund` |
| `hire.void` | `POST /v1/hires/{id}/void` | `aether_hire_void` |
| `market.fx_settle` | `POST /v1/fx/settle` | `aether_market_fx_settle` |
| `ledger.transfer` | `POST /v1/ledger/transfers` | `aether_ledger_transfer` |
| *every CommandType* | `POST /v1/commands` `{ type, actor, …body }` | matching `aether_*` tool |
| `envelope.require` | `POST /v1/payments/require` → **HTTP 402** + `PAYMENT-REQUIRED` | `aether_payment_require` |
| `envelope.submit` | `POST /v1/payments/submit` (JSON body is the bus; `PAYMENT-SIGNATURE` is optional x402-shaped practice) | `aether_payment_submit` |
| `approval.resolve` | `POST /v1/approvals/{id}/resolve` | `aether_approval_resolve` |
| `ladder.set` | `POST /v1/agents/{id}/autonomy` | `aether_ladder_set` |
| `ledger.balances` | `GET /v1/accounts/{id}` (system speaker) | `aether_ledger_balances` |
| `audit.verify` | `GET`/`POST /v1/audit/verify` | `aether_audit_verify` |
| `receipt.get` | `GET /v1/receipts/{id}` (system speaker) | `aether_receipt_get` |
| `host.subscribe` | `POST /v1/host/subscribe` | `aether_host_subscribe` |
| operator invoice (not a Command) | `POST /v1/host/invoice` | `aether_host_invoice` |

OpenAPI lives at `GET /openapi.yaml` (the document) and `GET /openapi.json` (same YAML in `{ format, document }`). MCP tools use the JSON Schemas in `/schemas` as `inputSchema`. `POST /v1/commands` is every `CommandType` on the same bus as MCP. REST paths below are aliases.

Sim x402 headers (even on JSON body routes, so clients can practice the real handshake):

| Header | Direction | Body |
|---|---|---|
| `PAYMENT-REQUIRED` | server → client | Base64(JSON `PaymentRequired`) |
| `PAYMENT-SIGNATURE` | client → server | Base64(JSON `PaymentPayload`). Optional on this sim. The command bus is the JSON body. Omit is not malformed. |
| `PAYMENT-RESPONSE` | server → client | Base64(JSON `SettlementResponse`) |

On the sim rail, `network` is always `"sim:aether-1"` (CAIP-2 *shape*: `namespace:reference`). `scheme` is `"exact"` or `"upto"`.

---

## 2. Canonical object model

Authoritative TypeScript lives in `packages/aether-types/src`. This section is the narrative + invariants. If prose and types disagree, **types win**.

### 2.1 Money, rail, result

```ts
export type CurrencyCode = "USD_SIM" | "USDC_SIM";
export type Instant = string; // ISO-8601 milliseconds, always Z
export type HexSha256 = string; // 64 lowercase hex chars
export type Ulid = string;

export interface Money {
  amount: number;      // integer minor units, >= 0 in catalogs; signed only in journal delta
  currency: CurrencyCode;
}

export interface Rail {
  id: "sim:aether-1";
  scheme: "exact" | "upto";
  asset: CurrencyCode;
}

export type Result<T, E = AetherError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Invariant: two `Money` values may be added only if `currency` matches. Conversion is a *market-maker quote plus two journal lines*, never implicit.

### 2.2 Identity and the autonomy ladder

```ts
export type AgentRole =
  | "treasury"
  | "procurement"
  | "data_vendor"
  | "compute_vendor"
  | "market_maker"
  | "auditor"
  | "human_operator";

/**
 * L0 human-executes     — agent may draft; a human must sign every payment mandate
 * L1 human-approves     — agent may issue carts; human confirms each cart before payment
 * L2 constrained-auto   — agent may close payments that satisfy an open intent (no per-tx human)
 * L3 budget-auto        — L2 plus recurrence / remaining-budget tracking
 * L4 delegated-hire     — L3 plus authority to issue *sub-intents* (delegate budget). Vendor hires against an existing intent are L3.
 * L5 human-out-of-loop  — L4 plus standing open mandate; humans hold kill switch + auditor only
 */
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface PublicKeyRef {
  kid: string;
  kty: "OKP";
  crv: "Ed25519";
  x: string;           // base64url
}

export interface Agent {
  id: `aid_${Ulid}`;
  did: `did:aether:${string}`;
  displayName: string;
  role: AgentRole;
  autonomyLevel: AutonomyLevel;
  keys: PublicKeyRef[];
  accountId: `acct_${Ulid}`;
  supervisors: Array<`aid_${Ulid}`>;  // humans / treasury who may approve or kill
  createdAt: Instant;
  frozen: boolean;                     // kill switch
}

export interface LadderTransition {
  from: AutonomyLevel;
  to: AutonomyLevel;
  requiredApproverRoles: AgentRole[];
  extraGates: Array<
    | "auditor_ack"
    | "clean_audit_7d"
    | "circuit_breaker_configured"
    | "kill_switch_tested"
  >;
}
```

Hard-coded legal transitions (implement as a table, not `if (to > from)`):

| From → To | Approvers | Extra gates |
|---|---|---|
| any → 0 | any supervisor, or auditor | none (kill / demote is always allowed) |
| 0 → 1 | `human_operator` owner | none |
| 1 → 2 | `human_operator` owner | `auditor_ack` |
| 2 → 3 | `human_operator` owner | `clean_audit_7d` |
| 3 → 4 | owner **and** treasury (dual control) | none |
| 4 → 5 | owner **and** treasury | `circuit_breaker_configured`, `kill_switch_tested` |

Skipping rungs is `ladder.legal` (422), not a mutate throw after an allow. Listing L5 gate names is not the freeze test. `L5` still cannot violate mandate constraints or circuit breakers. “Human-out-of-the-loop” means no *per-transaction* human, not no policy.

Minimum autonomy to *execute* (not merely draft):

| Action | Min level |
|---|---|
| Draft intent / cart / RFQ | L0 |
| Close a payment (human signs) | L0 + human signature on payment mandate |
| Close a payment without per-tx human | L2 |
| Recurring / budget-consuming payment | L3 |
| Hire a vendor against an existing intent (escrow + cart) | L3 |
| Issue a sub-intent that delegates budget to another agent | L4 |
| Auto-accept inbound hires against standing mandate | L5 |

### 2.3 Mandate chain (AP2-shaped, Aether-namespaced)

We do **not** emit SD-JWT-VC. We emit a signed JWS envelope (`alg: EdDSA`) whose *payload shape* is AP2-compatible: `vct`, constraints, payee, `payment_amount` as `{amount, currency}` in minor units, `transaction_id` as hash of the prior artifact.

```ts
export type MandateVct =
  | "aether.mandate.intent.open.1"
  | "aether.mandate.intent.1"
  | "aether.mandate.cart.1"
  | "aether.mandate.payment.open.1"
  | "aether.mandate.payment.1";

export interface Merchant {
  id: `aid_${Ulid}`;
  name: string;
  website: string;
}

export interface PaymentInstrument {
  id: string;
  type: "sim_ledger";
  description: string;
}

export interface LineItem {
  sku: string;
  description: string;
  quantity: number;          // integer
  unitAmount: Money;
}

export type MandateConstraint =
  | {
      type: "payment.amount_range";
      currency: CurrencyCode;
      min?: number;
      max: number;
    }
  | {
      type: "payment.budget";
      currency: CurrencyCode;
      max: number;            // remaining computed at eval time, stored as original max
    }
  | {
      type: "payment.allowed_payees";
      allowed: Merchant[];
    }
  | {
      type: "payment.allowed_payment_instruments";
      allowed: PaymentInstrument[];
    }
  | {
      type: "payment.agent_recurrence";
      frequency: "ON_DEMAND" | "DAILY" | "WEEKLY" | "MONTHLY";
      max_occurrences?: number;
    }
    // DAILY = 24h, WEEKLY = 7d, MONTHLY = 30 × 24h. ON_DEMAND has no gap.
    // Checked on hire.create and hire.fund. Refund does not restore a slot.
  | {
      type: "payment.execution_date";
      not_before?: Instant;
      not_after?: Instant;
    }
    // Window checked on hire.create and hire.fund. Completing a funded hire after not_after is legal.
  | {
      type: "payment.reference";
      conditional_transaction_id: HexSha256;
    }
    // Binds hire.create / hire.fund to a funded payment's transaction_id once a check exists.
    // Completing funded work is legal. Before any funded payment it is still AP2-shaped catalog surface.
  | {
      type: "aether.allowed_skus";
      allowed: string[];      // glob-ish exact SKU list. Aether extension
    }
  | {
      type: "aether.max_autonomy";
      max: AutonomyLevel;
    };

export interface IntentMandate {
  vct: "aether.mandate.intent.open.1" | "aether.mandate.intent.1";
  id: `mid_${Ulid}`;
  issuerId: `aid_${Ulid}`;          // human, treasury, or L4+ agent issuing a sub-intent
  subjectId: `aid_${Ulid}`;         // agent authorized to spend
  task: string;                     // natural-language purpose (audit, not policy)
  constraints: MandateConstraint[];
  parentId?: `mid_${Ulid}`;         // L4 nested slip: child must be tighter; spend counts against parent
  iat: number;                      // unix seconds
  exp: number;                      // unix seconds. Seven days from iat (not milliseconds).
}

export interface CartMandate {
  vct: "aether.mandate.cart.1";
  id: `mid_${Ulid}`;
  intentId: `mid_${Ulid}`;
  intentHash: HexSha256;            // sha256(canonicalJson(intent))
  merchant: Merchant;
  line_items: LineItem[];
  total: Money;
  expiresAt: Instant;
  userConfirmationRequired: boolean; // true if subject autonomy < 2
}

export interface PaymentMandate {
  vct: "aether.mandate.payment.1" | "aether.mandate.payment.open.1";
  id: `mid_${Ulid}`;
  transaction_id: HexSha256;        // sha256(canonicalJson(cart)) — AP2 role of checkout hash
  payee: Merchant;
  payment_amount: { amount: number; currency: CurrencyCode };
  payment_instrument: PaymentInstrument;
  execution_date?: Instant;
  iat: number;                      // unix seconds
  exp: number;                      // unix seconds. One day from iat (not milliseconds). Matches cart expiresAt.
}

export interface Signed<T> {
  payload: T;
  issuer: `did:aether:${string}`;
  kid: string;
  alg: "EdDSA";
  jws: string;                      // compact JWS, payload is base64url(canonicalJson(T))
}
```

**Chain verification** (`aether-mandate.verifyChain`) is signatures, hashes, payee, amount, and (optionally) expiry. Intent constraints are not this function. They evaluate in the policy referee (§3).

1. Verify each JWS against the issuer’s current `kid`.
2. `cart.intentHash === sha256(canonicalJson(intent.payload))`.
3. `payment.transaction_id === sha256(canonicalJson(cart.payload))`.
4. `payment.payee.id === cart.merchant.id`.
5. `payment.payment_amount` equals `cart.total` (amount **and** currency).
6. Reject if any `exp` / `expiresAt` ≤ clock (skipped when `checkExp: false`, so completing a funded hire after the checkout window still verifies signatures and hashes).

`payment.allowed_payment_instruments` and `payment.reference` bind in §3. A ghost `conditional_transaction_id` still verifyChains. Before any funded payment, `payment.reference` is still AP2-shaped catalog surface. Cite TAP is the referee.

AP2 field map (documentation only — do not import their types):

| Aether | AP2 role |
|---|---|
| `IntentMandate` | Open intent / user instructions |
| `CartMandate` | Merchant-bound cart (our sim merchant signs with Ed25519) |
| `PaymentMandate.transaction_id` | Hash binding to cart/checkout |
| `payment_amount.{amount,currency}` | Minor units + ISO-like code |
| `payment.amount_range` etc. | Open-mandate constraints |
| Receipt `reference` | Hash of closed payment mandate |

### 2.4 x402-shaped envelopes

```ts
export interface PaymentResource {
  url: string;
  description: string;
  mimeType: "application/json";
}

export interface AcceptedPayment {
  scheme: "exact" | "upto";
  network: "sim:aether-1";
  amount: string;                   // minor units as decimal string, e.g. "80000"
  asset: CurrencyCode;
  payTo: `acct_${Ulid}`;
  maxTimeoutSeconds: number;
  extra?: {
    hireId?: `hid_${Ulid}`;
    cartId?: `mid_${Ulid}`;
    paymentMandateId?: `mid_${Ulid}`;
  };
}

export interface PaymentRequired {
  x402Version: 2;
  resource: PaymentResource;
  accepted: AcceptedPayment[];
}

export interface PaymentPayload {
  x402Version: 2;
  scheme: "exact" | "upto";
  network: "sim:aether-1";
  payload: {
    payerAccountId: `acct_${Ulid}`;
    paymentMandateId: `mid_${Ulid}`;
    nonce: string;                  // ulid, unique; settlement rejects reuse
    authorizedAmount: string;
    asset: CurrencyCode;
    validBefore: Instant;
    signature: string;              // Ed25519 over canonicalJson(payload without signature)
  };
}

export interface SettlementResponse {
  success: boolean;
  transaction: `tid_${Ulid}` | null;
  network: "sim:aether-1";
  payer: `acct_${Ulid}` | null;
  errorReason?: string;
  receiptId?: `rid_${Ulid}`;
}
```

Header codec: `Buffer.from(JSON.stringify(obj), "utf8").toString("base64")` — standard base64, not base64url, matching x402 HTTP headers.

### 2.5 Hires, RFQs, quotes (agents hiring agents)

```ts
export type HireState =
  | "offered"
  | "accepted"
  | "funded"
  | "delivered"
  | "released"
  | "refunded"
  | "void";

export interface HireContract {
  id: `hid_${Ulid}`;
  buyerId: `aid_${Ulid}`;
  sellerId: `aid_${Ulid}`;
  sku: string;
  spec: string;
  price: Money;
  state: HireState;
  rfqId: `rfq_${Ulid}`;
  quoteId: `qte_${Ulid}`;
  intentId: `mid_${Ulid}`;
  cartId?: `mid_${Ulid}`;
  escrowAccountId: `acct_${Ulid}`;  // created at offer; funded before work
  deliverableHash?: HexSha256;
  createdAt: Instant;
}

export interface Rfq {
  id: `rfq_${Ulid}`;
  buyerId: `aid_${Ulid}`;
  sku: string;
  spec: string;
  invitedSellerIds: Array<`aid_${Ulid}`>;
  expiresAt: Instant;
}

export interface Quote {
  id: `qte_${Ulid}`;
  rfqId: `rfq_${Ulid}`;
  sellerId: `aid_${Ulid}`;
  price: Money;
  /** Market maker only: convert `from` into `to` at this rate (to = from * rate / 1e6). */
  fx?: { from: CurrencyCode; to: CurrencyCode; rateE6: number; validUntil: Instant };
  expiresAt: Instant;
}
```

RFQ `expiresAt` is 24h. Quote `expiresAt` is 1h. `hire.create` against a stale quote is `market.not_expired` deny. SKUs must be keys of `CATALOG` (`market.known_sku`). The catalog is not a storefront. Non-empty `invitedSellerIds` is a closed room (`market.invited_seller`); empty or omitted is an open RFQ. An invitee that is not in this world is `identity.known` — not a closed room nobody can quote. A quote or hire against an unknown RFQ/quote is `market.known_rfq` — not a missing SKU. `market.fx_settle` requires a live unused FX quote (`market.fx_quote`). A research quote is not FX. An FX window is USD_SIM → USDC_SIM with the price in `from` (`market.fx_pair`); an FX object on a research SKU is not a dual-use quote. A swapped pair or a price in `to` is not a silent journal of the books this rail actually posts. A spent FX quote is not a second window. `hire.create` consumes the quote (`hire.quote_unspent`); so does FX settle. An FX window is not a hire (`hire.not_fx`); settle it. An FX SKU quoted without a window is not a good (`market.fx_window`). An FX window born with `validUntil` already past or unparseable is `market.fx_fresh` — not a written corpse that then fails settle as `market.not_expired`. A deny does not consume it. An escalate reserves it until the ticket is approved, rejected, or expired. A void does not restore it. A hireId that is not in this world is `hire.known` — not a broken mandate chain. An intentId that is not in this world is `mandate.known_intent` — not a missing handshake. A cartId that is not in this world is `mandate.known_cart` — not a broken payment chain. An approvalId that is not in this world is `approval.known` — not a late yes. An expired or already-resolved ticket is `approval.pending`. Approving a live ticket whose paused command is no longer legal is `approval.replay`. Accept, deliver, and payment-required belong to the seller; refund and release belong to the buyer or treasury; void of an unfunded offer belongs to the buyer, the seller, or treasury (`hire.party`). Void of funded escrow is `hire.state`. A parentId that is not in this world is `mandate.known_parent` — not a tighter child. An agentId that is not in this world is `identity.known` — not a freeze, handshake, merchant, slip subject, or revoke target. The command’s speaker (`actorId`) that is not in this world is `actor.known` — not a 500. A provided HTTP/MCP `actor` that is not a live alias is also `actor.known` — not silent system. Omit actor or pass `system` to bootstrap. Attesting yourself is `kya.not_self`. A KYA parentId that is not in this world is `kya.known_parent` — not a live nested hop. A KYA attestationId that is not in this world (or that belongs to another principal) is `kya.known_attestation` — not a silent tombstone. Revoke by principal+delegate with no id still kills implicit grants. Minting or tombstoning a handshake in someone else’s name is `kya.party` — an L4 desk cannot write a founder’s handshake by filling in the ids. Omitted `principalId` is the speaker, not the supervisor. A reused register alias (or a second market maker sharing `market_maker:cash_usd`) is `identity.unique_key` — two agents cannot share one operating book; same-body retries still replay. A receiptId that is not in this world is `receipt.known` — not an empty success. Unfreezing someone who is not frozen, or freezing someone who is already frozen, is `identity.freeze_state` — a no-op freeze is not a notary line after yes. A second live handshake for the same principal→delegate pair is `kya.unique_live` — revoke, then attest again; a second live hop is not a tighter grant. An account name that is not in this world is `ledger.known_account` — not an allocation (and not a silent zero). An FX settle without a USDC book is also `ledger.known_account` — a compute vendor’s USD cash is not a USDC wallet. One journal is one currency (`ledger.same_currency`); FX is a quote and a settle, not a transfer. A transfer cannot overdraw the source (`ledger.sufficient`). Neither can `hire.fund` — escrow cannot lock on empty operating cash. Neither can `market.fx_settle` on the vendor’s USD leg (`mm.inventory` is the market maker’s USDC). An illegal hire arrow is `hire.state` — not a 409 after an allow. Payment-required is only after deliver. An illegal ladder climb is `ladder.legal`. Required command-body fields from `schemas/commands.schema.json` are checked at dispatch before `evaluate()`; a miss is `command.malformed` (400), not a policy deny. So is a non-integer amount, a negative amount, or a currency that is not `USD_SIM` / `USDC_SIM`. So is a listed enum miss (role, approval decision, issuer kind, clearing currency) or an integer outside its schema range (ladder rung, autonomy). So is a listed field with the wrong JSON type (a number where a string id belongs, a string where an invite list belongs). So is a nested cart line missing sku, description, quantity, or unitAmount, or an intent constraint that is not an object with a listed type and its value fields (an `amount_range` without `max` is not an open checkbook). So is an FX window missing from, to, rateE6, or validUntil. So is a cart line whose cents overflow a safe integer, mixed USD and USDC in one cart, or an FX rate product that cannot be an integer cent. The 200bps band binds the nested `fx.rateE6` that is stored and settled; a decoy top-level `rateE6` does not. A hire takes one cart (`hire.unique_cart`); a second cart bound to the same hire is not a pointer swap. A cart takes one payment (`mandate.unique_payment`); a second payment for the same cart is not a second check. Funding, releasing, or submitting envelope against a live hire that has not bound that cart is `hire.bound_cart`; passing `cartId` on fund is not a pointer. A listed SKU priced in a currency the catalog does not name is `market.sku_currency`. An FX window that is not this rail’s pair is `market.fx_pair`. An FX window is not a hire (`hire.not_fx`). Settling FX with no market maker is `mm.known`. Escrow cannot lock USD cash into a USDC hire (`ledger.same_currency`).

Hire state machine (illegal arrows are `hire.state`; mutate still throws `HIRE_ILLEGAL_TRANSITION` if policy ever lies):

```
offered → accepted → funded → delivered → released
                 ↘ void
accepted → void          (before fund)
funded   → refunded      (buyer+policy or auditor after timeout)
```

Funding posts: `Dr escrow:{hire}  Cr buyer:cash`.  
Release posts: `Dr seller:cash  Cr escrow:{hire}`.  
Refund posts: `Dr buyer:cash  Cr escrow:{hire}`. Spend counters decrement along the parent intent chain. Circuit stays sticky. Live rails later implement `SIM_RAIL`’s shape (`require` / `receipt` / `ok` / `fail`); they do not enter `evaluate()`. `SIM_RAIL.live === false`.

### 2.6 Ledger (double-entry)

```ts
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  id: `acct_${Ulid}`;
  ownerId: `aid_${Ulid}` | "system";
  name: string;
  type: AccountType;
  currency: CurrencyCode;
}

export interface JournalLine {
  accountId: `acct_${Ulid}`;
  debit: number;                    // minor units >= 0
  credit: number;                   // minor units >= 0
}

export interface JournalEntry {
  id: `jnl_${Ulid}`;
  timestamp: Instant;
  description: string;
  hireId?: `hid_${Ulid}`;
  paymentMandateId?: `mid_${Ulid}`;
  lines: JournalLine[];             // sum(debit) === sum(credit), same currency
}

export interface LedgerSnapshot {
  accounts: Account[];
  entries: JournalEntry[];
}
```

Seed accounts at genesis (fixture, not user-created):

| Name | Owner | Type | Currency | Opening (debit) |
|---|---|---|---|---|
| `treasury:cash` | treasury | asset | USD_SIM | 5_000_000 ($50,000.00) |
| `procurement:cash` | procurement | asset | USD_SIM | 0 |
| `data_vendor:cash` | data vendor | asset | USD_SIM | 0 |
| `compute_vendor:cash` | compute vendor | asset | USD_SIM | 0 |
| `market_maker:cash_usd` | MM | asset | USD_SIM | 1_000_000 |
| `market_maker:cash_usdc` | MM | asset | USDC_SIM | 1_000_000 |
| `auditor:cash` | auditor | asset | USD_SIM | 0 |
| `system:equity` | system | equity | USD_SIM | 6_000_000 |
| `system:equity_usdc` | system | equity | USDC_SIM | 1_000_000 |

Opening journal: debit cash accounts, credit equity. Replay must balance. `ledger.transfer` moves operating cash only (`ledger.operating_book`). Equity is not a source (that would mint). Escrow is not an allocation (that would pick the hire lock). Opening cash is `seedOpening`.

Persistence: each `JournalEntry` is one JSONL line in `data/ledger.jsonl`. Startup replays the file into memory. No silent mutation of old lines.

### 2.7 Policy decision and approvals

```ts
export type Verdict = "allow" | "deny" | "escalate";

export interface RuleVerdict {
  ruleId: string;
  verdict: Verdict;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface PolicyDecision {
  verdict: Verdict;                 // deny > escalate > allow
  trace: RuleVerdict[];             // ALL rules, in catalog order
  approvalId?: `apd_${Ulid}`;
  remediation?: Remediation;        // on deny/escalate. `kind` is for machines
}

export interface ApprovalTicket {
  id: `apd_${Ulid}`;
  createdAt: Instant;
  expiresAt: Instant;
  commandType: string;
  commandHash: HexSha256;
  reason: string;
  ruleIds: string[];
  requiredApproverRoles: AgentRole[];
  status: "pending" | "approved" | "rejected" | "expired";
  resolvedBy?: `aid_${Ulid}`;
  resolvedAt?: Instant;
}

export interface PolicyContext {
  clock: Instant;
  actor: Agent;
  counterparties: Agent[];
  intent?: Signed<IntentMandate>;
  cart?: Signed<CartMandate>;
  payment?: Signed<PaymentMandate>;
  hire?: HireContract;
  commandType: string;
  amount?: Money;
  payeeId?: `aid_${Ulid}`;
  spentAgainstIntent: number;       // minor units already settled under this intent
  occurrenceCount: number;
  lastOccurrenceAt?: Instant;       // last fund under this intent
  velocity: { windowSeconds: number; count: number; volume: number };
  circuit: { dailySpend: number; dailyLimit: number; tripped: boolean };
  parentIntent?: Signed<IntentMandate>;
  parentSpent?: number;
  parentOccurrenceCount?: number;
  parentLastOccurrenceAt?: Instant;
  proposedConstraints?: MandateConstraint[];
  skuListed?: boolean;
  skuCurrencyOk?: boolean;          // false when quote/hire.create prices a listed SKU in a currency the catalog does not name
  fxPairOk?: boolean;               // false when an FX window is on the wrong SKU, the price is not in from, or from/to is not USD_SIM → USDC_SIM
  hireNotFx?: boolean;              // false when hire.create would treat an FX window or FX SKU as a hireable good
  fxWindowOk?: boolean;             // false when quote prices an FX SKU without an fx window
  fxMintFresh?: boolean;            // false when quote would write validUntil ≤ now (or unparseable)
  mmKnown?: boolean;                // false when fx_settle has a live FX quote but no market maker / MM books
  marketFresh?: boolean;
  sellerInvited?: boolean;
  cartMatchesHire?: boolean;
  rfqKnown?: boolean;               // false when RFQ/quote id is unknown; absent = not RFQ-gated
  fxQuoteLive?: boolean;            // false when fx_settle has no/non-FX/spent quote
  quoteUnspent?: boolean;           // false when hire.create reuses a consumed or reserved quote
  hireKnown?: boolean;              // false when hireId is not in this world
  intentKnown?: boolean;            // false when intentId is not in this world
  cartKnown?: boolean;              // false when cartId is not in this world
  approvalKnown?: boolean;          // false when approvalId is not in this world
  approvalPending?: boolean;        // false when the ticket is expired or already resolved
  replayOk?: boolean;               // false when approving a live ticket whose paused command is no longer an allow
  hirePartyOk?: boolean;            // false when the actor is not the hire counterparty
  parentKnown?: boolean;            // false when issue_intent.parentId is not in this world
  targetKnown?: boolean;            // false when freeze/ladder/attest/cart/intent/rfq invite names a missing agent
  ladderLegal?: boolean;            // false when ladder.set would skip a rung or skip a real freeze test
  kyaNotSelf?: boolean;             // false when kya.attest would make the grantor the delegate
  kyaParentKnown?: boolean;         // false when kya.attest.parentId is not in this world's graph
  kyaParentFresh?: boolean;         // false when attest/hire.create/hire.fund/issue_intent names a nested hop whose parent is expired or revoked
  kyaAttestationKnown?: boolean;    // false when kya.revoke.attestationId is missing or belongs to another principal
  kyaPartyOk?: boolean;             // false when attest/revoke names a principal that is not the actor (human/treasury exempt). omitted principalId is the speaker, not the supervisor
  aliasFree?: boolean;              // false when identity.register would reuse a runtime alias or its USD/USDC operating book
  receiptKnown?: boolean;           // false when receipt.get names a receipt that is not in this world
  freezeStateOk?: boolean;          // false when freeze is already frozen, or unfreeze is not frozen
  kyaLiveFree?: boolean;            // false when kya.attest would mint a second live hop for the same pair
  cartUnbound?: boolean;            // false when issue_cart names a live hire that already has a cartId
  paymentUnbound?: boolean;         // false when issue_payment names a cart that already has a payment
  cartBound?: boolean;              // false when fund/release/submit would move escrow on a hire that has not bound its cart and payment
  actorKnown?: boolean;             // false when Command.actorId is not system and is not a registered agent. HTTP/MCP unknown alias is this string, not silent system
  systemOk?: boolean;               // false when actorId is system and the command is not first-human bootstrap or a read
  accountsKnown?: boolean;          // false when ledger.transfer / named balances / fx_settle points at a missing book (FX needs the vendor’s USDC book)
  accountsSameCurrency?: boolean;   // false when a transfer would mix USD_SIM and USDC_SIM, the label disagrees, or hire.fund would lock USD cash into a USDC escrow
  fundsOk?: boolean;                // false when a transfer, hire.fund, or fx_settle would overdraw the source book
  balancesSafe?: boolean;           // false when a journal would leave a touched book outside Number.isSafeInteger
  operatingBooksOk?: boolean;       // false when ledger.transfer would journal against equity or escrow
  birthRungOk?: boolean;            // false when identity.register would mint L5 (L0–L4 at birth are legal)
  kyaMintFresh?: boolean;           // false when kya.attest would write expiresAt ≤ now (or an unparseable Instant)
  kyaMintWindowOk?: boolean;        // false when kya.attest would write expiresAt after now + one year (omit is the ceiling)
  windowMintFresh?: boolean;        // false when issue_intent would write an execution_date that cannot contain now
  windowReachOk?: boolean;          // false when issue_intent would write a not_before at or after the slip's seven-day exp
  occurrenceMintOk?: boolean;       // false when issue_intent would write a recurrence cap that cannot admit a first hire
  parentFresh?: boolean;            // false when issue_intent / hire.create / hire.fund names a parent past exp
}
```

Aggregation: run **every** rule. If any `deny` → `deny`. Else if any `escalate` → `escalate` and persist an `ApprovalTicket`. Else `allow`. Rules must not short-circuit; the trace is an audit artifact.

### 2.8 Receipt

```ts
export interface Receipt {
  id: `rid_${Ulid}`;
  status: "Success" | "Error";
  iss: "did:aether:runtime";
  iat: number;
  reference: HexSha256;             // sha256(canonicalJson(closed PaymentMandate))
  payment_id: `tid_${Ulid}`;
  journalId: `jnl_${Ulid}`;
  hireId?: `hid_${Ulid}`;
  network_confirmation_id: HexSha256; // hash of the journal entry
  error?: string;
  error_description?: string;
}
```

### 2.9 Hash-chained audit log

This is a core deliverable. Implement exactly.

```ts
export type AuditAction =
  | "GENESIS"
  | "IDENTITY_REGISTER"
  | "LADDER_SET"
  | "MANDATE_ISSUE"
  | "RFQ_CREATE"
  | "QUOTE_SUBMIT"
  | "HIRE_TRANSITION"
  | "POLICY_DECISION"
  | "APPROVAL_RESOLVE"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_SUBMIT"
  | "JOURNAL_POST"
  | "RECEIPT_ISSUE"
  | "FREEZE"
  | "AUDIT_VERIFY";

export interface AuditRecord {
  v: 1;
  seq: number;                      // 0-indexed. Genesis is 0
  prevHash: HexSha256;
  recordedAt: Instant;
  actorId: `aid_${Ulid}` | "system";
  action: AuditAction;
  subjects: Array<{ type: string; id: string }>;
  payload: unknown;                 // must be JCS-canonicalizable
  payloadHash: HexSha256;
  hash: HexSha256;
}
```

**Algorithm** (`packages/aether-audit`, also copied into types as comments):

```
GENESIS_PREV = "0".repeat(64)
DOMAIN       = "aether-audit-v1"

payloadHash = SHA256_HEX( UTF8( JCS(record.payload) ) )

preimage = UTF8(
    DOMAIN            + "\n" +
    decimal(seq)      + "\n" +   // no leading zeros
    prevHash          + "\n" +
    recordedAt        + "\n" +
    actorId           + "\n" +
    action            + "\n" +
    payloadHash
)

hash = SHA256_HEX(preimage)
```

Rules:

1. Genesis record: `seq=0`, `action=GENESIS`, `prevHash=GENESIS_PREV`, payload `{ "nonce": "<ulid>" }`.
2. Record `n+1` must have `prevHash === record[n].hash` and `seq === n+1`.
3. File format: `data/audit.jsonl`, one `AuditRecord` per line, append-only. `O_APPEND`. Never rewrite.
4. `verify(path)` replays from seq 0, recomputes `payloadHash` and `hash`, checks linkage. Returns first failure `{ seq, reason }` or `{ ok: true, head, length }`.
5. Compaction (v1: **do not implement**): would emit a new chain whose genesis payload is `{ snapshotHash, oldHead }`. Mentioned so nobody “rotates the file” casually.
6. Policy decisions are logged *before* mutation. If audit append fails, abort the command. Settlements without an audit line are impossible by construction (`runtime.dispatch` ordering: policy → audit(POLICY_DECISION) → mutate → audit(mutation) → receipt).
7. Do not put secrets or private keys in `payload`. Put `kid` and hashes only.

---

## 3. Policy engine rules that matter

Catalog order **is** evaluation order. IDs are stable. Implement each as `Rule = { id, evaluate(ctx): RuleVerdict }`.

| # | `ruleId` | When it fires | Deny | Escalate | Allow |
|---|---|---|---|---|---|
| 01 | `actor.not_frozen` | always | `actor.frozen` | — | otherwise |
| 02 | `actor.role_capability` | always | auditor attempting spend/hire; vendor creating hire as buyer; MM creating RFQ | — | role may perform `commandType` |
| 03 | `mandate.chain_integrity` | fund / submit | verifyChain fails (expiry is checked at fund; submit verifies signatures and hashes) | — | chain ok. Completing a funded hire after the cart window is legal. Fund of a stale cart names this first. Chain TAP is a dead cart at fund. Dust TAP is a first payment on a stale unpaid cart. |
| 04 | `mandate.not_expired` | new spend / mint (create, fund, issue_cart, issue_payment) | `exp`/`expiresAt` ≤ now | — | in window. Completing a funded hire after the cart, payment, or intent window is legal. Inspect / snapshot label that intent live / expired / funded. Dust TAP is a first payment on a stale unpaid cart. Chain TAP is a dead cart at fund. |
| 05 | `mandate.subject_is_actor` | settle / hosted host.subscribe | `intent.subjectId !== actor.id` | — | match. Subject TAP is a second desk's `hire.fund`. Seat TAP is a hosted subscribe row. |
| 06 | `payment.currency_match` | settle | cart/payment/amount currencies differ | — | match. Ink TAP is a USDC cart on a USD hire. |
| 07 | `payment.amount_range` | settle if constraint present | amount outside `[min,max]` or currency mismatch | — | in range |
| 08 | `payment.budget` | settle if constraint present | `spentAgainstIntent + amount > max` | — | remaining ≥ amount |
| 09 | `payment.allowed_payees` | settle if constraint present | payee not in list | — | listed. Rail TAP is the instrument list. |
| 10 | `payment.allowed_skus` | settle/hire if constraint present | sku not listed | — | listed |
| 11 | `payment.recurrence` | hire.create / hire.fund if constraint present | `occurrenceCount >= max` or last fund inside the frequency gap (`DAILY` 24h, `WEEKLY` 7d, `MONTHLY` 30d). `ON_DEMAND` has no gap. Completing a funded hire is not a new occurrence. Minting a cap that cannot admit a first hire is `mandate.occurrence_fresh`. | — | under cap and past the gap |
| 12 | `payment.execution_date` | hire.create / hire.fund if constraint present | now outside `[not_before, not_after]`. Completing a funded hire is not a new spend. Minting a already-closed window is `mandate.window_fresh`. | — | in window |
| 13 | `ladder.min_level` | settle/hire/sub-intent | actor.level < required **and** command is not escalatable | actor.level < required **and** command is escalatable (no ticket yet) | level ≥ required, or an approved ticket waived the hire/settle rung |
| 14 | `ladder.max_autonomy_constraint` | new spend if `aether.max_autonomy` present | actor.level > max (over-autonomy abuse) | — | actor.level ≤ max. Completing a funded hire after a climb is legal. |
| 15 | `approval.threshold` | settle/fund | — | amount ≥ role threshold **and** level < 5 | below threshold or L5 with circuit intact |
| 16 | `velocity.window` | hire.create / hire.fund / market.fx_settle | — | `count > 20` or `volume > 2_000_000` in 3600s | under cap, or not a new spend. Completing a funded hire after a hot hour is legal. Reads are not a spend. |
| 17 | `circuit.daily` | settle | `circuit.tripped` or `dailySpend + amount > dailyLimit` | — | under daily limit |
| 18 | `hire.escrow_required` | hire.accept / deliver | accept without escrow account; deliver while not `funded` | — | funded before work. Bare TAP is deliver on accepted. Arrow TAP is release before deliver. |
| 19 | `hire.no_self_deal` | hire.create | `buyerId === sellerId` | — | distinct |
| 20 | `counterparty.known` | hire/settle | payee/seller not in registry | — | registered |
| 21 | `instrument.sim_only` | settle | `payment_instrument.type !== "sim_ledger"` | — | sim. Rail TAP is a listed id on the slip (`payment.allowed_payment_instruments`). |
| 22 | `idempotency.nonce` | envelope.submit | nonce already in the settled table | — | new nonce (a leftover nonce on another verb is not this refuse) |
| 23 | `mm.spread_bound` | MM quote | `rateE6` outside `[980_000, 1_020_000]` (200 bps) | — | inside band |
| 24 | `mm.inventory` | MM accept FX | MM cash in `to` currency < payout | — | inventory exists |
| 25 | `audit.writable` | always (runtime injects) | audit head missing / verify dirty | — | chain healthy |
| 26 | `human.signature_present` | envelope.submit at L0/L1 | payment JWS issuer is not a `human_operator` supervisor | — | human signed or L2+ self-sign. Pen TAP is junior submit. |
| 27 | `clearing.bilateral_limit` | hire/settle when exposure snapshot present | projected gross > bilateral limit | — | inside limit |
| 28 | `kya.chain_intact` | spend / sub-intent / attest by an agent | no live path from principal, or revoke tombstone | — | live path, implicit supervisor, or not required. Revoke still binds after hop expiry. |
| 29 | `kya.delegation_depth` | when a KYA path exists | hop count > 3 | — | depth ≤ 3. Well TAP is a four-hop grantor chain. Nest TAP is a dead parent. Climb TAP is a grant ceiling. Cut TAP is a revoked hop. |
| 30 | `kya.principal_not_frozen` | KYA-gated spend | principal frozen (delegate keys still work) | — | principal active. Freeze still binds after hop expiry. |
| 31 | `kya.attestation_fresh` | new spend (create, fund, issue_intent) | path exists but expired | — | in window. Completing a funded hire after hop expiry is legal. Freeze and revoke still bind. |
| 32 | `kya.capability_subset` | attest / new spend | agent grants above own level (omitted `maxAutonomy` is L5), or acts above granted max | — | within grant. Completing a funded hire after a climb is legal. Freeze and revoke still bind. |
| 33 | `mandate.child_tighter` | `mandate.issue_intent` with `parentId` | child amount_range / budget / SKUs / payees / instruments / max autonomy wider than parent | — | child is a subset |
| 34 | `payment.parent_budget` | spend against a child intent | `parentSpent + amount > parent budget` | — | parent remaining ≥ amount |
| 35 | `market.known_sku` | rfq / quote / hire.create | SKU not in `CATALOG` | — | listed. Shelf TAP is a ghost SKU. SKU TAP is the slip list. Hall TAP is a ghost RFQ. Guest TAP is a missing invitee. |
| 36 | `market.not_expired` | quote / hire.create / fx_settle | RFQ, quote, or FX `validUntil` ≤ now | — | in window |
| 37 | `market.invited_seller` | quote / hire.create | seller not in `Rfq.invitedSellerIds` (when the list is non-empty) | — | invited, or open RFQ. Room TAP is a closed guest list. Hall TAP is a ghost RFQ. Guest TAP is a missing invitee. |
| 38 | `hire.cart_matches` | issue_cart (with hireId) / hire.fund / envelope.submit | cart total, seller, or SKU ≠ hire, or non-integer cents | — | cart equals hire |
| 39 | `market.known_rfq` | quote / hire.create | RFQ (or the quote’s RFQ) does not exist | — | room exists. Hall TAP is a ghost RFQ. Room TAP is a closed guest list. Shelf TAP is a ghost SKU. Guest TAP is a missing invitee. Writ TAP is a ghost slip. |
| 40 | `market.fx_quote` | fx_settle | quote missing, has no `fx`, already used, or reserved by an open hire ticket | — | live unused FX quote. Paper TAP is a research quote. Conversion TAP is hiring the window. Pane TAP is quoting an FX SKU without a window. |
| 41 | `hire.quote_unspent` | hire.create | quote already produced a hire, an FX settle, or is reserved by an open approval | — | quote unused |
| 42 | `hire.known` | accept / fund / deliver / release / refund / envelope.* / issue_cart (with hireId) | hireId not in this world | — | hire exists. Pact TAP is a ghost hire. Party TAP is a stranger on a live hire. Bare TAP is deliver before fund. Arrow TAP is release before deliver. |
| 43 | `mandate.known_intent` | hire.create / issue_cart | intentId not in this world | — | intent exists. Writ TAP is a ghost slip. Heir TAP is a dead parent. Name TAP is whose name a handshake is in. |
| 44 | `mandate.known_cart` | issue_payment | cartId not in this world | — | cart exists. Crate TAP is a ghost cart. Cart TAP is occupancy. Chain TAP is a dead cart at fund. Dust TAP is a first payment on a stale unpaid cart. |
| 45 | `approval.known` | approval.resolve | approvalId not in this world | — | ticket exists |
| 46 | `approval.pending` | approval.resolve | ticket expired or already resolved | — | ticket pending |
| 47 | `hire.party` | accept / deliver / envelope.require / refund / release / void | actor is not the seller (accept/deliver/require) or not the buyer/treasury (refund/release) or not the buyer/seller/treasury (void) | — | right party. Void TAP is tearing up funded escrow (`hire.state`). Party TAP is a stranger on a live hire. |
| 48 | `mandate.known_parent` | issue_intent with parentId | parentId not in this world | — | parent exists. Root TAP is a ghost parent. Heir TAP is a dead parent. Nest TAP is a dead hop. |
| 49 | `identity.known` | freeze / unfreeze / rotate / ladder.set / kya.attest / kya.revoke / issue_cart / issue_intent / market.rfq | named agentId / delegateId / principalId / merchantId / subjectId / invitedSellerIds not in this world | — | agent registered. Guest TAP is a missing invitee. Room TAP is a closed guest list. Lock TAP is someone else's key. |
| 50 | `hire.state` | accept / fund / deliver / refund / release / void / envelope.submit / envelope.require | command is not a legal arrow from the hire’s current state; payment-required is only after deliver; void is offered or accepted only | — | legal transition. Void TAP is tearing up funded escrow. Arrow TAP is release before deliver. Refund TAP is unwind funded escrow. Bare TAP is deliver before fund. |
| 51 | `ladder.legal` | ladder.set | skip a rung, omit a required gate, list `kill_switch_tested` without a freeze test, or wrong approver | — | legal climb (`any→L0` always). Rung TAP is skip L2→L4. Climb TAP is a handshake ceiling. Night Watch’s premature L5 is the freeze-test gate. |
| 52 | `kya.not_self` | kya.attest | grantor would attest themselves | — | handshake with another agent |
| 53 | `kya.known_parent` | kya.attest with parentId | parentId not in this world’s graph | — | parent hop exists (a dead hop is `kya.parent_fresh`) |
| 54 | `ledger.known_account` | ledger.transfer / named ledger.balances / market.fx_settle | fromAccount, toAccount, name, accountId, or the FX actor’s USDC book is not in this world | — | book exists |
| 55 | `ledger.same_currency` | ledger.transfer / hire.fund | the two books disagree, the stated amount currency disagrees, or fund would lock a cash book into an escrow of a different currency | — | one currency (`market.fx_settle` to convert). Mix TAP is USD into a USDC book. Wallet TAP is a missing dest book. Cash TAP is empty operating cash. Mint TAP is a transfer from equity. Priced TAP is catalog currency. Paper TAP is settling a research quote as FX. |
| 56 | `ledger.sufficient` | ledger.transfer / hire.fund / market.fx_settle | source book (transfer fromAccount, buyer cash at fund, or vendor USD at FX settle) balance < amount | — | source covers the cents (zero is legal) |
| 57 | `kya.known_attestation` | kya.revoke with attestationId | attestationId not in this world’s graph, or belongs to a different principal | — | handshake exists for this principal |
| 58 | `kya.party` | kya.attest / kya.revoke | actor is not the named principal, and is not a human or treasury (omitted principalId is the speaker) | — | principal, or kill-switch role |
| 59 | `identity.unique_key` | identity.register | runtime alias already taken, or an operating book already open (USD cash; USDC for data_vendor / market_maker; a second market maker collides on `market_maker:cash_usd`) | — | free alias and operating books |
| 60 | `receipt.known` | receipt.get | receiptId not in this world | — | receipt exists |
| 61 | `identity.freeze_state` | freeze / unfreeze | freeze of an already-frozen agent, or unfreeze of an agent that is not frozen | — | freeze delta matches live state |
| 62 | `kya.unique_live` | kya.attest | a live (non-revoked) hop already exists for this principal→delegate pair | — | no live hop for this pair |
| 63 | `hire.unique_cart` | issue_cart with hireId | live hire already has a cartId | — | hire has no cart yet |
| 64 | `mandate.unique_payment` | issue_payment | cart already has a payment mandate (same cart hash) | — | cart has no payment yet. Inspect / snapshot label that cart `bound`, not `live`. Inspect / snapshot label that payment `live` (or `funded` after escrow moves). Cart TAP is occupancy. Dust TAP is a first payment on a stale unpaid cart. |
| 65 | `market.sku_currency` | quote / hire.create | listed SKU priced in a currency the catalog does not name for that SKU | — | price currency is listed |
| 66 | `market.fx_pair` | quote / fx_settle | FX window on a non-FX SKU, swapped from/to, or price not in `from` (this rail journals USD_SIM → USDC_SIM) | — | USD_SIM → USDC_SIM priced in from |
| 67 | `hire.not_fx` | hire.create | quote carries an FX window (`quote.fx`) or the SKU is an FX SKU; windows settle, they are not hires | — | quote is not an FX window or FX SKU |
| 68 | `approval.replay` | approval.resolve (approved) | paused command would not allow (stale quote, expired slip, missing pending command) | — | waived replay is still allow |
| 69 | `market.fx_window` | quote | listed FX SKU quoted without an `fx` window | — | FX SKU carries a window |
| 70 | `hire.bound_cart` | fund / release / envelope.submit | live hire has not bound a cart (and that cart’s payment); a body cartId is not a pointer | — | hire holds its cart and payment |
| 71 | `mm.known` | fx_settle (live FX quote) | no market_maker agent, or missing `market_maker:cash_usd` / `market_maker:cash_usdc` | — | MM and both books exist |
| 72 | `actor.known` | always when actorId is not system | actorId is not a registered agent (HTTP/MCP unknown alias is this string, not silent system) | — | speaker exists (or is system) |
| 73 | `ledger.safe_balance` | transfer / fund / refund / release / envelope.submit / fx_settle | posting the journal would leave a book outside `Number.isSafeInteger` (dest + amount, or the matching source/equity leg) | — | resulting books stay safe integers. Brim TAP is dest overflow. |
| 74 | `actor.system_scope` | always when actorId is system | command is not first-human bootstrap or a read (catalog / audit.query / audit.verify / balances / receipt.get / host.card) | — | system may bootstrap or read |
| 75 | `ledger.operating_book` | ledger.transfer (covered, same-currency) | from or to is equity or escrow (or any non-asset book) | — | both books are operating cash |
| 76 | `ladder.birth_rung` | identity.register | autonomyLevel is 5 | — | birth rung is L0–L4 (`ladder.set` 4→5 after a freeze test) |
| 77 | `kya.mint_fresh` | kya.attest | expiresAt ≤ now, or unparseable Instant (omit is one year from now) | — | handshake expires after now |
| 78 | `kya.mint_window` | kya.attest | expiresAt after now + one year (omit is that ceiling) | — | handshake expires within one year |
| 79 | `mandate.window_fresh` | issue_intent with execution_date | not_after already past, inverted window, or unparseable Instant (a future not_before still mints if it opens while the slip lives) | — | window can still contain a now |
| 80 | `mandate.window_reach` | issue_intent with execution_date | not_before at or after the slip's seven-day exp | — | window opens while the intent is live |
| 81 | `mandate.occurrence_fresh` | issue_intent with agent_recurrence | max_occurrences ≤ 0, or not a finite number (omit is unlimited and still mints) | — | cadence can still admit a first hire |
| 82 | `mandate.parent_fresh` | issue_intent / hire.create / hire.accept / hire.fund with a parent | parent intent `exp` (unix seconds) is already past | — | parent still lives (completing a funded hire after that is legal) |
| 83 | `kya.parent_fresh` | kya.attest with a known parentId; hire.create / hire.fund / issue_intent along a nested hop | parent hop is expired or revoked (`hopStatus` is not live) | — | parent hop still lives (ghost stays `kya.known_parent`; completing a funded hire after that is legal) |
| 84 | `market.fx_fresh` | quote with an `fx` object | `validUntil` ≤ now, or unparseable Instant | — | FX window still open at mint (settle of a later lapse stays `market.not_expired`) |
| 85 | `host.not_hosted` | host.subscribe | this instance is not a hosted operator (`Runtime.hosted` is false) | — | a hosted operator (`Runtime({ hosted: true })`). `host.card` is a read. Self-host is free. GitHub is not a checkout. |
| 86 | `host.human_authority` | hosted host.subscribe with a known intent | intent issuer is not `human_operator` or `treasury` | — | live intent issued by a human or treasury (ghost stays `mandate.known_intent`; expired stays `mandate.not_expired`; wrong subject stays `mandate.subject_is_actor`) |
| 87 | `host.unique_subscriber` | hosted host.subscribe with a known intent | this agent already has a subscription row | — | one subscriber, one row. Spend is not gated on the row. |
| 88 | `payment.allowed_payment_instruments` | hire.create / hire.fund if constraint present | stamped (or implied) instrument id not in the list | — | listed. This kernel stamps `sim-ledger`. Live-rail *type* stays `instrument.sim_only`. Rail TAP is a ghost id. Payee TAP is who. |
| 89 | `payment.reference` | hire.create / hire.fund if constraint present and a funded payment exists | cited `conditional_transaction_id` is not a funded payment's `transaction_id` | — | bind. Before any funded payment the constraint is still AP2-shaped catalog surface. Cite TAP is a ghost checkout hash. Completing funded work is legal. |
| 90 | `identity.party` | identity.rotate | actor is not the named agent, and is not a human or treasury (omit agentId is the speaker) | — | own key, or a kill-switch role. Ghost rotate stays `identity.known`. Frozen speaker stays `actor.not_frozen`. System stays `actor.system_scope`. Lock TAP is a vendor turning the desk's lock. Rotation is not a new identity. Retired keys still verify. |
| 91 | `market.party` | market.withdraw | actor is not the named seller, and is not a human or treasury | — | own bid, or a kill-switch role. Ghost fold stays `market.known_rfq`. Expired/folded stays `market.not_expired`. Spent stays `hire.quote_unspent`. Fold TAP is a second vendor pulling the research desk's live bid. A folded quote is not a hire. The store stays raw. Inspect labels `withdrawn`. |
| 92 | `mandate.party` | mandate.revoke | actor is not the named issuer, and is not a human or treasury | — | own unused slip, or a kill-switch role. Ghost rip stays `mandate.known_intent`. Expired/ripped stays `mandate.not_expired`. Rip TAP is a desk tearing the founder's unused slip. Completing funded work is legal. The store stays raw. Inspect labels `revoked`. Funded wins over revoked. |

L5 does **not** skip `payment.*` constraints, `circuit.daily`, `actor.not_frozen`, `kya.*`, or `idempotency.nonce`. It only skips `approval.threshold` and `ladder.min_level` escalations. L5 cannot be minted at `identity.register` (`ladder.birth_rung`); that rung is a climb after a freeze that was actually tested.

**Role capability matrix** (`actor.role_capability`):

| Command family | treasury | procurement | vendors | MM | auditor | human |
|---|---|---|---|---|---|---|
| Fund / ladder approve | yes | no | no | no | no | yes (ladder) |
| RFQ / hire as buyer | yes | yes | no | no | no | no |
| Quote / hire as seller | no | no | yes | FX only | no | no |
| Spend / submit payment | yes | yes | receive only | FX settle | **never** | approve only |
| Audit verify / freeze | yes | no | no | no | yes | yes |
| Catalog / audit.query | yes | yes | yes | yes | yes | yes |
| KYA attest / revoke | yes | L4+ | no | no | no | yes |

**Default thresholds** (`approval.threshold`), fixture-overridable:

| Role | Per-tx escalate at |
|---|---|
| procurement | 500_000 ($5,000.00) |
| treasury | 2_000_000 |
| vendors (outbound, should be rare) | 50_000 |

**Escalation object:** on `escalate`, runtime writes `ApprovalTicket` with `commandHash = sha256(JCS(command))`. A pending `hire.create` ticket holds the quote (`hire.quote_unspent`) until approved, rejected, or expired. Resolver must replay the **same** command bytes. Mutation proceeds only after `status=approved` and re-evaluation returns `allow`. Replay waives `approval.threshold` and `ladder.min_level` on hire/settle verbs (the human signed those bytes). Caps, freeze, KYA, and nonce still bind. A velocity ticket is not a rung for `mandate.issue_intent`. Approving a live ticket whose paused command is no longer an allow is `approval.replay` — not a mutate throw after writing yes. Reject still releases the quote. A missing ticket is `approval.known`. Tickets past `expiresAt` or already resolved are `approval.pending`; resolve is a policy deny, not a late yes; the original command may be retried (new ticket) and the quote is free again. An expired escalate is not a live idempotency hit — `hire.create` is auto-idempotent, and a leftover pause must not replay as `escalated` after `expiresAt` and trap the quote until some other command arrives. Inspect / snapshot label that ticket `expired`, not `pending`. Inspect any id with `Runtime.inspect` / `GET /v1/objects/:id` / MCP `aether_get`. Command bodies: `schemas/commands.schema.json` (required fields enforced at dispatch).

---

## 4. Demo scenario — “Sprint Procurement”

**Goal:** prove agents can hire/pay each other, hit a policy wall, escalate, then settle with receipts — all offline.

**Command:** `pnpm demo` / `pnpm aether demo sprint-procurement`  
**Clock start:** `2026-08-28T00:00:00.000Z`, step +1s per command.  
**Fixture dir:** `fixtures/demo/sprint-procurement/`.

### Cast

| Agent | Role | Autonomy | Supervisors |
|---|---|---|---|
| `ops-human` | human_operator | n/a | — |
| `treasury` | treasury | L3 | ops-human |
| `procurement` | procurement | L3 | ops-human, treasury |
| `data-vendor` | data_vendor | L2 | ops-human |
| `compute-vendor` | compute_vendor | L2 | ops-human |
| `mm` | market_maker | L2 | ops-human |
| `auditor` | auditor | L0 (cannot spend) | ops-human |

Procurement open intent (issued by `ops-human`):

```json
{
  "vct": "aether.mandate.intent.open.1",
  "task": "Buy Q1 market ticks and 200 GPU-hours for the sprint.",
  "constraints": [
    { "type": "payment.amount_range", "currency": "USD_SIM", "max": 500000 },
    { "type": "payment.budget", "currency": "USD_SIM", "max": 1500000 },
    { "type": "payment.allowed_payees", "allowed": ["data-vendor", "compute-vendor", "mm"] },
    { "type": "aether.allowed_skus", "allowed": ["data.ticks.2026Q1", "compute.gpu.hours", "fx.usd_sim.usdc_sim"] },
    { "type": "payment.agent_recurrence", "frequency": "ON_DEMAND", "max_occurrences": 8 },
    { "type": "aether.max_autonomy", "max": 4 }
  ]
}
```

(`allowed` in the fixture uses agent ids after registration; names shown for readability.)

### Beat sheet (every beat is one `dispatch`)

| Step | Actor | Command | Expected policy | Ledger effect |
|---|---|---|---|---|
| 0 | system | genesis + seed accounts | — | cash/equity open |
| 1 | ops-human | register 7 agents | allow | — |
| 2 | ops-human | `ladder.set` procurement → L3 (via 0→1→2→3 with auditor acks) | allow | — |
| 3 | ops-human | `mandate.issue_intent` for procurement | allow | — |
| 4 | treasury | journal: Dr procurement:cash 1_500_000 / Cr treasury:cash | allow | $15,000 allocated |
| 5 | procurement | RFQ `data.ticks.2026Q1` to data-vendor | allow | — |
| 6 | data-vendor | quote **80_000** ($800.00) | allow | — |
| 7 | procurement | `hire.create` + accept + **fund** $800 | **allow** (under $5k, L3) | escrow funded |
| 8 | data-vendor | deliver `{ "rows": 1_000_000, "cid": "sim:ticks" }` | allow (`hire.escrow_required` funded) | — |
| 9 | procurement | 402 require → submit payment (release escrow) | allow | vendor +800, escrow 0 |
| 10 | runtime | issue receipt R1, `reference=hash(payment)` | — | — |
| 11 | procurement | RFQ `compute.gpu.hours` qty 200 | allow | — |
| 12 | compute-vendor | quote **640_000** ($6,400.00) | allow | — |
| 13 | procurement | `hire.create` / fund $6,400 | **escalate** `approval.threshold` + `payment.amount_range` is **deny**? | **deny** on `payment.amount_range` (max 500_000) |
| 14 | (wall) | decision trace includes `payment.amount_range=deny` | command aborted, no journal | — |
| 15 | procurement | `approval` is not enough — amount_range is a **hard deny**. Agent escalates by requesting a **new intent** from ops-human with `max: 700000` for sku `compute.gpu.hours` only | — | — |
| 16 | ops-human | issue amending intent I2 (range max 700_000, budget 1_000_000 remaining-style new budget 700_000) | allow | — |
| 17 | procurement | retry hire+fund under I2 | **escalate** `approval.threshold` (640k ≥ 500k) | ApprovalTicket T1 |
| 18 | treasury | `approval.resolve` T1 approved (role treasury) | re-eval **allow** | escrow $6,400 |
| 19 | compute-vendor | deliver `{ "jobId": "sim:gpu-200" }` | allow | — |
| 20 | procurement | submit payment / release | allow | vendor +6400 |
| 21 | runtime | receipt R2 | — | — |
| 22 | data-vendor | RFQ? no — **asks MM** via procurement paying MM to convert $800 USD_SIM → USDC_SIM so vendor can hold USDC. Cleaner: data-vendor sells USD to MM. Quote `fx.usd_sim.usdc_sim` `rateE6=998004` (~20 bps) | `mm.spread_bound` allow | — |
| 23 | data-vendor | settle FX: Dr mm:usd 80_000 / Cr vendor:usd; Dr vendor:usdc 79_840 / Cr mm:usdc | allow | conversion |
| 24 | auditor | `audit.verify` + check R1.reference and R2.reference bind to payment hashes; check both hires `released`; check Σ debits = Σ credits | allow | no spend |
| 25 | auditor | attempt `envelope.submit` $1 | **deny** `actor.role_capability` | proves auditor cannot spend |

**Assertions the demo CLI must print as TAP or JSON:**

```
ok 1  genesis hash-chain length >= 25
ok 2  audit.verify ok
ok 3  hire data-vendor state=released receipt=Success
ok 4  step 13 verdict=deny ruleIds∋payment.amount_range
ok 5  step 17 verdict=escalate ruleIds∋approval.threshold
ok 6  hire compute-vendor state=released after treasury approval
ok 7  procurement cash = 1_500_000 - 80_000 - 640_000 = 780_000
ok 8  data-vendor USDC_SIM = 79840
ok 9  auditor spend denied
ok 10 receipts R1,R2 reference === sha256(JCS(paymentMandate))
```

If any assertion fails, exit 1. This is the acceptance test for v0.

### Clearing window (`pnpm demo clearing`)

**Fixture:** `fixtures/demo/clearing-window/`. Instance `bilateralLimit` 100000 ($1,000). Not a Command. Not durable. Public default stays 50_000_000.

A desk hires a vendor for $800. A second $400 offer is `clearing.bilateral_limit` — projected pair gross 120000. Treasury closes a settlement window: one leg consumed, gross 80000, vendor cash unchanged. After the photo the $400 hire releases. Still 89 rules.

### Refund unwind (`pnpm demo refund`)

**Fixture:** `fixtures/demo/refund/`. Instance `dailyLimit` 80000 ($800) so the funded hire sits on the fuse.

A desk funds an $800 hire. An over-cap offer is `circuit.daily` and blows the fuse. `hire.refund` returns escrow, restores mandate spend, and reverse-records clearing (pair net 0). The quote stays spent. A later hire is still `circuit.daily`. After treasury `circuit.reset`, reusing the quote is `hire.quote_unspent`. Refund of delivered work is `hire.state`. Still 89 rules.

### Replay (`pnpm demo replay`)

**Fixture:** `fixtures/demo/replay/`.

A desk funds an $800 hire. Retrying the same `hire.fund` replays: cash and escrow unmoved, no second journal. The same `hire.create` replays the same contract. A new key on that quote is `hire.quote_unspent`. A retry is not a second spend. Still 89 rules.

### Envelope nonce (`pnpm demo nonce`)

**Fixture:** `fixtures/demo/nonce/`.

A desk releases an $800 hire. Reusing that envelope nonce on a second hire is `idempotency.nonce` — the second escrow does not release. A leftover nonce on a cash transfer is not that deny. Still 89 rules.

### Deny cache (`pnpm demo deny`)

**Fixture:** `fixtures/demo/deny-cache/`.

A frozen desk’s `hire.create` is `actor.not_frozen`. Retrying that command is a new decision (audit grows). After unfreeze the same `hire.create` allows. A deny does not consume the quote. Still 89 rules.

### Recurrence (`pnpm demo recurrence`)

**Fixture:** `fixtures/demo/recurrence/`.

A one-slot slip (`payment.agent_recurrence`, `ON_DEMAND`, `max_occurrences: 1`) funds and releases once. Completing that funded work is not a second slot. A second `hire.create` is `payment.recurrence`. That deny does not write a second hire or spend the quote. Still 89 rules.

### Calendar (`pnpm demo calendar`)

**Fixture:** `fixtures/demo/calendar/`.

A same-day `payment.execution_date` window. `hire.create` before `not_before` is `payment.execution_date`. Inside the window the desk funds. After `not_after`, that funded hire still releases. A new `hire.create` is `payment.execution_date`. A closed calendar is not a freeze on funded work. Still 89 rules.

### Slot (`pnpm demo slot`)

**Fixture:** `fixtures/demo/slot/`.

A one-slot slip funds, then `hire.refund` returns cash and mandate spend. The occurrence count stays 1. A second `hire.create` is `payment.recurrence`. A refund is not a new slot. Still 89 rules.

### Daily (`pnpm demo daily`)

**Fixture:** `fixtures/demo/daily/`.

A `DAILY` slip (`max_occurrences: 8`) funds and releases once. A same-day second `hire.create` is `payment.recurrence`. After 24 hours that command allows. A cadence is a gap, not a burst. Still 89 rules.

### Cart occupancy (`pnpm demo cart`)

**Fixture:** `fixtures/demo/cart/`.

A hire takes one cart. A cart takes one payment. Funding with a loose `cartId` is `hire.bound_cart`. A second cart is `hire.unique_cart`. A second payment is `mandate.unique_payment`. The same fund command then allows — occupancy is a bind, not a field on fund. Crate TAP is a ghost cart. Ink TAP is a USDC cart on a USD hire. Still 89 rules.

### Velocity (`pnpm demo velocity`)

**Fixture:** `fixtures/demo/velocity/`.

A cool hour funds once. After the settle hour runs hot, that funded hire still releases. A new `hire.create` is `velocity.window` (escalate, not deny). The pause holds the quote; it is not a second hire. A hot hour is not a freeze on funded work. Still 89 rules.

### Operator door (`pnpm demo door`)

**Fixture:** `fixtures/demo/door/`.

The public kernel refuses `host.subscribe` as `host.not_hosted`. A hosted instance (`Runtime({ hosted: true })`) refuses an unsigned named speaker (401) and an unpaid month (402). After an invoice, subscribe records a row. Spend is not gated on that row. `PROTOCOL.hosted` stays false. Still 89 rules.

### Cart match (`pnpm demo match`)

**Fixture:** `fixtures/demo/match/`.

A $0.01 cart on an $800 hire is `hire.cart_matches` and writes nothing. The matching cart occupies the hire (the deny did not take `unique_cart`). Funding moves $800, not a penny. A second matching cart is `hire.unique_cart`. A cheaper cart is not a discount. Ink TAP is a USDC cart on a USD hire. Still 89 rules.

### Closed room (`pnpm demo room`)

**Fixture:** `fixtures/demo/room/`.

A closed RFQ names one vendor. An outsider’s quote is `market.invited_seller` and writes nothing. The invited vendor quotes and `hire.create` allows. An empty invite list lets the outsider quote. A closed room is not a bulletin board. Hall TAP is a ghost RFQ. Guest TAP is a missing invitee. Still 89 rules.

### Conversion (`pnpm demo conversion`)

**Fixture:** `fixtures/demo/conversion/`.

`hire.create` against an FX window is `hire.not_fx` — no hire, window unspent and unreserved. `market.fx_settle` then converts. A spent window is `hire.quote_unspent`. An FX window is not a good. Still 89 rules.

### Unique live (`pnpm demo pair`)

**Fixture:** `fixtures/demo/pair/`.

A founder attests a desk. A tighter second hop is `kya.unique_live` and writes nothing. A hop to a different agent allows. Revoke, then attest again. A second live hop is not a tighter grant. Still 89 rules.

### Spread (`pnpm demo band`)

**Fixture:** `fixtures/demo/band/`.

An off-band nested FX rate is `mm.spread_bound` even with an in-band top-level decoy — no window written. An in-band quote on that RFQ allows and settles. The 200bps band is not decoration. Conversion (`hire.not_fx`) is a different object. Still 89 rules.

### Nest (`pnpm demo nest`)

**Fixture:** `fixtures/demo/nest/`.

A founder nests a scout under a desk hop. The scout funds while the parent lives. After the parent hop dies, a new `hire.create` is `kya.parent_fresh` and writes nothing. That funded work still releases. A nested hop does not outlive its parent. Graft TAP is a missing hop parent. Still 89 rules.

### Heir (`pnpm demo heir`)

**Fixture:** `fixtures/demo/heir/`.

A founder hands a tighter child slip to a desk. The desk funds while the parent lives. After the parent slip dies, a new `hire.create` is `mandate.parent_fresh` and writes nothing — the child's own `exp` still lives. That funded work still releases. A dead parent is not a parent. Nest TAP is the hop. Writ TAP is a ghost slip. Still 89 rules.

### Stock (`pnpm demo stock`)

**Fixture:** `fixtures/demo/stock/`.

A thin MM USDC book on a large FX window is `mm.inventory` and does not consume the window. Vendor USD still covers. The 200bps band still allows. A smaller window on a different RFQ converts. Empty MM USDC is not a missing maker. Maker TAP is nobody on the window. Conversion (`hire.not_fx`) and spread (`mm.spread_bound`) are different objects. Still 89 rules.

### Purse (`pnpm demo purse`)

**Fixture:** `fixtures/demo/purse/`.

A $1,000 envelope with a $5,000 per-item cap funds an $800 hire. A $400 second `hire.create` is `payment.budget` — the item cap still allows — and writes nothing. That funded work still releases. A budget is not an item cap. Lid TAP is the item cap. Sprint hits `payment.amount_range` inside a longer story. Still 89 rules.

### Seat (`pnpm demo seat`)

**Fixture:** `fixtures/demo/seat/`.

A hosted operator records one subscribe row. The desk funds an $800 hire — spend is not gated on the row. A second `host.subscribe` is `host.unique_subscriber` even on a fresh slip, and writes nothing. A different agent takes its own seat. That funded work still releases. One subscriber, one row. Door TAP is the 401/402 door. `PROTOCOL.hosted` stays false. Still 89 rules.

### Cover (`pnpm demo cover`)

**Fixture:** `fixtures/demo/cover/`.

A $1,000 parent envelope funds an $800 desk hire. A $400 scout `hire.create` on a tighter child is `payment.parent_budget` — the child's own envelope still allows — and writes nothing. That funded parent work still releases. A parent envelope is not a child's leftover. Sub-hire is nested slips. Purse is the child's own envelope. Still 89 rules.

### Mint (`pnpm demo mint`)

**Fixture:** `fixtures/demo/mint/`.

A transfer from equity is `ledger.operating_book` — not a mint. Operating cash still funds an $800 hire. A transfer out of that escrow is `ledger.operating_book` — not an allocation. That funded work still releases. Overdraft stays `ledger.sufficient`. Brim TAP is dest overflow. Still 89 rules.

### Payee (`pnpm demo payee`)

**Fixture:** `fixtures/demo/payee/`.

A listed research vendor funds an $800 hire. A registered outsider quotes; `hire.create` is `payment.allowed_payees` — amount and known counterparty still allow — and writes no hire. The quote stays unspent. That funded work still releases. A listed payee is not any registered vendor. Room TAP is the RFQ guest list. Rail TAP is the instrument list. Still 89 rules.

### Climb (`pnpm demo climb`)

**Fixture:** `fixtures/demo/climb/`.

An L3 handshake funds an $800 hire. After a climb to L4, a new `hire.create` is `kya.capability_subset` — the slip ceiling still allows — and writes nothing. That funded work still releases. A climb is not a wider handshake. Night Watch climbs inside the grant. The slip ceiling stays `ladder.max_autonomy_constraint`. Still 89 rules.

### Born (`pnpm demo born`)

**Fixture:** `fixtures/demo/born/`.

A quote whose `validUntil` is already past is `market.fx_fresh` — not a written corpse. Pair, window shape, 200bps band, and later-lapse still allow. An open window quotes and settles. Settle of a window that lapses after mint stays `market.not_expired`. Conversion TAP is `hire.not_fx`. Spread TAP is `mm.spread_bound`. Still 89 rules.

### Reach (`pnpm demo reach`)

**Fixture:** `fixtures/demo/reach/`.

A live slip funds an $800 hire. A calendar whose `not_before` is after the seven-day exp is `mandate.window_reach` — not a written corpse. A closed calendar still allows. A future window that still opens while the slip lives still mints. That funded work still releases. Calendar TAP is `payment.execution_date` on hire. Wilt TAP is a corpse calendar (`mandate.window_fresh`). Still 89 rules.

### Year (`pnpm demo year`)

**Fixture:** `fixtures/demo/year/`.

A one-year handshake funds an $800 hire. A hop whose `expiresAt` is after now + one year is `kya.mint_window` — not standing identity. Born-dead and unique-live still allow. A one-year hop still mints. That funded work still releases. Pair TAP is `kya.unique_live`. Spark TAP is a corpse mint (`kya.mint_fresh`). Still 89 rules.

### Fuse (`pnpm demo fuse`)

**Fixture:** `fixtures/demo/fuse/`.

An $800 hire funds against a $1,000 daily fuse. A $400 second `hire.create` is `circuit.daily` — the envelope and the item cap still allow — and writes nothing. The fuse blows. That funded work still releases. Lid TAP is the item cap. Night Watch first-denies `payment.amount_range` inside a longer story. Refund TAP is unwind plus sticky. Velocity TAP is a hot hour. Still 89 rules.

### SKU (`pnpm demo sku`)

**Fixture:** `fixtures/demo/sku/`.

A listed `research.brief` funds an $800 hire. Catalog `research.deep` quotes; `hire.create` is `payment.allowed_skus` — known SKU, listed payee, and room still allow — and writes no hire. The quote stays unspent. That funded work still releases. A listed SKU is not any catalog good. Payee TAP is who. Shelf TAP is a ghost SKU. Still 89 rules.

### Priced (`pnpm demo priced`)

**Fixture:** `fixtures/demo/priced/`.

A vendor quotes `research.brief` in `USDC_SIM`. That is `market.sku_currency` — known SKU, known RFQ, and FX pair still allow — and writes no quote. A USD quote still writes. That funded work still releases. Convert with `market.fx_settle`. SKU TAP is the slip list. Ink TAP is a USDC cart on a USD hire. Still 89 rules.

### Party (`pnpm demo party`)

**Fixture:** `fixtures/demo/party/`.

An $800 hire funds to the vendor who quoted. A different registered vendor’s `hire.deliver` is `hire.party` — the hire is still known; the funded arrow still allows — and writes no state change. The seller who quoted still delivers. That funded work still releases. Payee TAP is who may be hired. Room TAP is who may quote. Still 89 rules.

### Cash (`pnpm demo cash`)

**Fixture:** `fixtures/demo/cash/`.

An $800 hire empties the desk. A $400 second `hire.fund` is `ledger.sufficient` — same currency, operating cash, and the hire arrow still allow — and locks no escrow. That funded work still releases. Mint TAP is a transfer from equity. Stock TAP is empty MM USDC. Brim TAP is dest overflow. Still 89 rules.

### Stale (`pnpm demo stale`)

**Fixture:** `fixtures/demo/stale/`.

An $800 hire funds on a live quote. After that quote’s hour, `hire.create` is `market.not_expired` — known SKU, known room, unspent promise, and born-dead still allow — and writes no hire. A fresh quote on that still-live RFQ still hires. That funded work still releases. Calendar TAP is the slip calendar. Born TAP is a corpse FX window. Replay TAP is a spent quote. Still 89 rules.

### Chain (`pnpm demo chain`)

**Fixture:** `fixtures/demo/chain/`.

An $800 hire funds on a live cart. After that cart’s day, a second `hire.fund` is `mandate.chain_integrity` — occupancy, cash, and the hire arrow still allow — and locks no escrow. That funded work still releases. Cart TAP is occupancy. Calendar TAP is the slip calendar. Stale TAP is quote TTL. Crate TAP is a ghost cart. Dust TAP is a first payment on a stale unpaid cart. Still 89 rules.

### Arrow (`pnpm demo arrow`)

**Fixture:** `fixtures/demo/arrow/`.

An $800 hire funds. `hire.release` before deliver is `hire.state` — the hire is still known; the buyer is still the party; escrow discipline and the bound cart still allow — and pays the vendor nothing. After deliver that funded work still releases. Bare TAP is deliver before fund (`hire.escrow_required`). Refund TAP is unwind after deliver. Party TAP is who sits on the hire. Still 89 rules.

### Wallet (`pnpm demo wallet`)

**Fixture:** `fixtures/demo/wallet/`.

An $800 hire funds. A compute vendor’s `market.fx_settle` is `ledger.known_account` — the maker, inventory, live window, and USD cash still allow — and consumes nothing. A research vendor with a USDC book still converts. That funded work still releases. Mint TAP is a transfer from equity. Stock TAP is empty MM USDC. Maker TAP is nobody on the window. Brim TAP is dest overflow. Still 89 rules.

### Name (`pnpm demo name`)

**Fixture:** `fixtures/demo/name/`.

An $800 hire funds. An L4 scout’s `kya.attest` in the founder’s name is `kya.party` — not-self, chain, unique-live, and capability-subset still allow — and writes no hop. The founder still mints that pair. That funded work still releases. Pair TAP is a second live hop. Climb TAP is a climb above the grant. Year TAP is a hop past one year. Still 89 rules.

### Pane (`pnpm demo pane`)

**Fixture:** `fixtures/demo/pane/`.

An $800 hire funds. A market maker’s `market.quote` of an FX SKU with no window is `market.fx_window` — known SKU, known room, pair, and born-dead still allow — and writes no quote. A real window still quotes and converts. That funded work still releases. Conversion TAP is hiring the window. Born TAP is a corpse mint. Swap TAP is a swapped pair. Pair TAP is unique-live. Still 89 rules.

### Subject (`pnpm demo subject`)

**Fixture:** `fixtures/demo/subject/`.

Desk A binds an $800 hire on a slip that names desk A. Desk B’s `hire.fund` is `mandate.subject_is_actor` — the hire is still known; the accepted arrow, bound cart, cash, and intact chain still allow — and locks no escrow. Desk A still funds. That work still releases. Party TAP is who sits on the hire. Name TAP is whose name a handshake is in. Seat TAP is a hosted subscribe row. Still 89 rules.

### Paper (`pnpm demo paper`)

**Fixture:** `fixtures/demo/paper/`.

An $800 hire funds. Settling a research quote as FX is `market.fx_quote` — pair, maker, dest book, and band still allow — and consumes nothing. A real window still converts. That funded work still releases. Conversion TAP is hiring the window. Pane TAP is quoting an FX SKU without a window. Wallet TAP is a missing dest book. Still 89 rules.

### Mix (`pnpm demo mix`)

**Fixture:** `fixtures/demo/mix/`.

An $800 hire funds. Treasury posting USD into a USDC book is `ledger.same_currency` — known books, operating cash, and source still allow — and posts no journal. A real window still converts. That funded work still releases. Wallet TAP is a missing dest book. Cash TAP is empty operating cash. Mint TAP is a transfer from equity. Priced TAP is catalog currency. Paper TAP is settling a research quote as FX. Ink TAP is a USDC cart on a USD hire. Brim TAP is dest overflow. Still 89 rules.

### Rung (`pnpm demo rung`)

**Fixture:** `fixtures/demo/rung/`.

An $800 hire funds. Skipping L2→L4 on a scout is `ladder.legal` — the scout is still known; the founder may still set rungs — and the scout stays L2. A one-rung climb still goes through. That funded work still releases. Climb TAP is a handshake ceiling. Night Watch’s premature L5 is the freeze-test gate. Still 89 rules.

### Grade (`pnpm demo grade`)

**Fixture:** `fixtures/demo/grade/`.

An $800 hire funds. An L3 scout minting a nested slip is `ladder.min_level` — the parent still exists; the child is still tighter; the handshake ceiling still allows — and writes nothing. An L4 desk still mints that child. That funded work still releases. Climb TAP is a handshake ceiling. Rung TAP is a skipped climb. Sub-hire TAP is a wider child. Still 89 rules.

### Cradle (`pnpm demo cradle`)

**Fixture:** `fixtures/demo/cradle/`.

An $800 hire funds. Minting a sentinel at L5 is `ladder.birth_rung` — the alias is still free; the founder may still register; a skip is not this deny — and writes nothing. An L4 register still goes through. That funded work still releases. Rung TAP is a skipped climb. Night Watch’s premature L5 is the freeze-test gate. Grade TAP is a junior nested mint. Still 89 rules.

### Ceiling (`pnpm demo ceiling`)

**Fixture:** `fixtures/demo/ceiling/`.

An $800 hire funds under an L3 slip. After a climb to L4, a new hire is `ladder.max_autonomy_constraint` — the handshake ceiling still allows; the item cap still allows — and writes nothing. That funded work still releases. Climb TAP is a handshake ceiling. Rung TAP is a skipped climb. Grade TAP is a junior nested mint. Still 89 rules.

### Lapse (`pnpm demo lapse`)

**Fixture:** `fixtures/demo/lapse/`.

An $800 hire funds under a noon handshake. After that hop dies, a new hire is `kya.attestation_fresh` — the chain still verifies; a nested parent is not this deny; the grant still allows — and writes nothing. The pair still occupies. That funded work still releases. Nest TAP is a nested parent. Year TAP is a hop past one year. Climb TAP is a handshake ceiling. Pair TAP is a second live hop. Stale TAP is quote TTL. Still 89 rules.

### Pause (`pnpm demo pause`)

**Fixture:** `fixtures/demo/pause/`.

An $800 hire funds under the auto-approve line. A $6,400 hire pauses as `approval.threshold`. After that ticket dies, `approval.resolve` is `approval.pending` — the ticket still exists; a stale command is not this deny — and writes no hire. The quote is free again. That funded work still releases. Velocity TAP is a hot hour. Deny TAP is a cached no. Sour TAP is a stale pause. Replay TAP is a retry of an allow. Docket TAP is a missing ticket. Still 89 rules.

### Mirror (`pnpm demo mirror`)

**Fixture:** `fixtures/demo/mirror/`.

An $800 hire funds. Attesting the speaker is `kya.not_self` — someone else's name, a second hop, and a corpse mint still allow — and writes nothing. The founder still mints a real pair. That funded work still releases. Name TAP is whose name a handshake is in. Pair TAP is a second live hop. Year TAP is a hop past one year. Still 89 rules.

### Warrant (`pnpm demo warrant`)

**Fixture:** `fixtures/demo/warrant/`.

An $800 hire funds. Subscribe on an agent-issued slip is `host.human_authority` — the public kernel still allows; a missing seat is not this deny — and writes no row. A human-issued slip still seats. That funded work still releases. Door TAP is the public kernel. Seat TAP is a second subscribe row. Still 89 rules.

### Vacant (`pnpm demo vacant`)

**Fixture:** `fixtures/demo/vacant/`.

An $800 hire funds. Minting a cadence with `max_occurrences` 0 is `mandate.occurrence_fresh` — a spent slot, a closed calendar, and a nested child still allow — and writes no slip. A one-slot slip still mints. That funded work still releases. Recurrence TAP is a spent slot. Slot TAP is a refunded slot. Daily TAP is a same-day burst. Calendar TAP is `payment.execution_date`. Still 89 rules.

### Badge (`pnpm demo badge`)

**Fixture:** `fixtures/demo/badge/`.

An $800 hire funds. An auditor's `hire.create` is `actor.role_capability` — a freeze, a missing speaker, and a spent quote still allow — and writes no hire. The quote stays unspent. The auditor still verifies the notary. That funded work still releases. Deny TAP is a freeze. Replay TAP is a spent quote. Still 89 rules.

### Lid (`pnpm demo lid`)

**Fixture:** `fixtures/demo/lid/`.

A $1,000 item cap with a $5,000 envelope funds an $800 hire. A $1,500 `hire.create` is `payment.amount_range` — the envelope and the fuse still allow — and writes no hire. The quote stays unspent. That funded work still releases. Purse TAP is the envelope. Fuse TAP is the daily cap. Sprint and Night Watch hit this rule inside a longer story. Still 89 rules.

### Bare (`pnpm demo bare`)

**Fixture:** `fixtures/demo/bare/`.

An $800 hire funds. `hire.deliver` on an accepted hire is `hire.escrow_required` — the hire is still known; the seller is still the party — and writes no deliverable. The sneak hire stays accepted. That funded work still releases. Arrow TAP is release before deliver (`hire.state`). Party TAP is who sits on the hire. Still 89 rules.

### Shelf (`pnpm demo shelf`)

**Fixture:** `fixtures/demo/shelf/`.

An $800 hire of catalog `research.brief` funds. `market.rfq` of `lunch.tacos` is `market.known_sku` — the slip list still allows; catalog currency is not this deny — and writes no RFQ. That funded work still releases. SKU TAP is the slip list. Priced TAP is catalog currency. Hall TAP is a ghost RFQ. Guest TAP is a missing invitee. Still 89 rules.

### Hall (`pnpm demo hall`)

**Fixture:** `fixtures/demo/hall/`.

An $800 hire funds. `market.quote` on a ghost RFQ is `market.known_rfq` — a missing SKU still allows; a closed guest list is not this deny — and writes no quote. That funded work still releases. Room TAP is a closed guest list. Shelf TAP is a ghost SKU. Guest TAP is a missing invitee. Writ TAP is a ghost slip. Still 89 rules.

### Writ (`pnpm demo writ`)

**Fixture:** `fixtures/demo/writ/`.

An $800 hire funds. `hire.create` on a ghost intent is `mandate.known_intent` — a missing handshake still allows; a dead parent is not this deny — and writes no hire. The quote stays unspent. That funded work still releases. Hall TAP is a ghost RFQ. Heir TAP is a dead parent. Name TAP is whose name a handshake is in. Crate TAP is a ghost cart. Still 89 rules.

### Crate (`pnpm demo crate`)

**Fixture:** `fixtures/demo/crate/`.

An $800 hire funds. `mandate.issue_payment` on a ghost cart is `mandate.known_cart` — occupancy still allows; a dead cart at fund is not this deny — and writes no payment. That funded work still releases. Cart TAP is occupancy. Chain TAP is a dead cart at fund. Dust TAP is a first payment on a stale unpaid cart. Writ TAP is a ghost slip. Pact TAP is a ghost hire. Still 89 rules.

### Pact (`pnpm demo pact`)

**Fixture:** `fixtures/demo/pact/`.

An $800 hire funds. `hire.deliver` on a ghost hire is `hire.known` — a stranger’s deliver still allows; unfunded work is not this deny — and writes no deliverable. That funded work still releases. Party TAP is a stranger on a live hire. Bare TAP is deliver before fund. Arrow TAP is release before deliver. Crate TAP is a ghost cart. Root TAP is a ghost parent. Still 89 rules.

### Root (`pnpm demo root`)

**Fixture:** `fixtures/demo/root/`.

An $800 hire funds. `mandate.issue_intent` on a ghost parent is `mandate.known_parent` — a tighter child still allows; a dead parent is not this deny — and writes no child. That funded work still releases. Heir TAP is a dead parent. Nest TAP is a dead hop. Vacant TAP is a cadence with no slots. Grade TAP is a junior nested mint. Graft TAP is a missing hop parent. Still 89 rules.

### Docket (`pnpm demo docket`)

**Fixture:** `fixtures/demo/docket/`.

An $800 hire funds under the auto-approve line. `approval.resolve` on a ghost ticket is `approval.known` — a dead pause still allows; a stale command is not this deny — and writes no ticket. That funded work still releases. Pause TAP is a dead ticket. Sour TAP is a stale pause. Replay TAP is a retry of an allow. Velocity TAP is a hot hour. Still 89 rules.

### Graft (`pnpm demo graft`)

**Fixture:** `fixtures/demo/graft/`.

An $800 hire funds. `kya.attest` under a ghost parent hop is `kya.known_parent` — a dead hop still allows; a missing slip parent is not this deny — and writes no hop. That funded work still releases. Nest TAP is a dead hop. Root TAP is a missing slip parent. Pair TAP is a second live hop. Mirror TAP is a handshake with yourself. Seal TAP is a missing handshake. Still 89 rules.

### Seal (`pnpm demo seal`)

**Fixture:** `fixtures/demo/seal/`.

An $800 hire funds. A live handshake is minted. `kya.revoke` of a ghost attestation is `kya.known_attestation` — a missing hop parent still allows; someone else’s name is not this deny — and does not tombstone the live hop. That funded work still releases. Graft TAP is a missing hop parent. Name TAP is whose name a handshake is in. Night Watch is revoke of a live hop. Still 89 rules.

### Guest (`pnpm demo guest`)

**Fixture:** `fixtures/demo/guest/`.

An $800 hire funds. `market.rfq` that invites a missing seller is `identity.known` — a closed guest list still allows; a missing SKU is not this deny — and writes no RFQ. That funded work still releases. Room TAP is a closed guest list. Shelf TAP is a ghost SKU. Hall TAP is a ghost RFQ. Still 89 rules.

### Dust (`pnpm demo dust`)

**Fixture:** `fixtures/demo/dust/`.

An $800 hire funds. `mandate.issue_payment` on a stale unpaid cart is `mandate.not_expired` — occupancy still allows; a dead cart at fund is not this deny — and writes no payment. That funded work still releases. Cart TAP is occupancy. Chain TAP is a dead cart at fund. Crate TAP is a ghost cart. Still 89 rules.

### Thaw (`pnpm demo thaw`)

**Fixture:** `fixtures/demo/thaw/`.

An $800 hire funds. `identity.unfreeze` of a live unfrozen auditor is `identity.freeze_state` — a missing agent still allows; a frozen speaker is not this deny — and writes no UNFREEZE line. That funded work still releases. The auditor still verifies. Deny TAP is a frozen speaker. Night Watch is freeze then a real unfreeze. Guest TAP is a missing agent. Still 89 rules.

### Twin (`pnpm demo twin`)

**Fixture:** `fixtures/demo/twin/`.

An $800 hire funds. `identity.register` on the taken desk alias is `identity.unique_key` — L5 at birth still allows; system minting a second agent is not this deny — and writes no agent. That funded work still releases. Cradle TAP is L5 at birth. Fence TAP is system minting a second agent. Still 89 rules.

### Fence (`pnpm demo fence`)

**Fixture:** `fixtures/demo/fence/`.

An $800 hire funds. `identity.register` as system after the first human is `actor.system_scope` — a taken alias still allows; L5 at birth is not this deny — and writes no agent. System still reads the catalog. That funded work still releases. Twin TAP is a taken alias. Cradle TAP is L5 at birth. Mute TAP is a missing speaker. Still 89 rules.

### Mute (`pnpm demo mute`)

**Fixture:** `fixtures/demo/mute/`.

An $800 hire funds. `ledger.balances` from a missing actorId is `actor.known` — a missing named target still allows; a frozen speaker is not this deny; system spending is not this deny — and writes no books. The live desk still reads. That funded work still releases. Guest TAP is a missing named target. Fence TAP is system spending. Deny TAP is a frozen speaker. Nil TAP is a missing receipt. Still 89 rules.

### Nil (`pnpm demo nil`)

**Fixture:** `fixtures/demo/nil/`.

An $800 hire funds. `receipt.get` of a missing receiptId is `receipt.known` — a missing speaker still allows; a missing named target is not this deny — and writes no receipt. The live receipt still fetches. That funded work still releases. Mute TAP is a missing speaker. Guest TAP is a missing named target. Still 89 rules.

### Spark (`pnpm demo spark`)

**Fixture:** `fixtures/demo/spark/`.

An $800 hire funds with no handshake yet. `kya.attest` with `expiresAt` already past is `kya.mint_fresh` — a century mint still allows; a second live hop is not this deny — and writes no hop. A one-year hop still mints. That funded work still releases. Year TAP is a hop past one year. Pair TAP is a second live hop. Unparseable `expiresAt` is the same first deny. Still 89 rules.

### Wilt (`pnpm demo wilt`)

**Fixture:** `fixtures/demo/wilt/`.

An $800 hire funds on a live slip. `mandate.issue_intent` with `not_after` already past is `mandate.window_fresh` — a window that opens after the slip dies still allows; a hire-time calendar is not this deny — and writes no slip. A live slip still mints. That funded work still releases. Reach TAP is a window that opens after the slip dies. Calendar TAP is hire-time. Unparseable or inverted windows are the same first deny. Still 89 rules.

### Maker (`pnpm demo maker`)

**Fixture:** `fixtures/demo/maker/`.

An $800 hire funds with no market maker in the world. `market.fx_settle` of a live FX quote is `mm.known` — empty inventory still allows; a missing dest book is not this deny — and consumes nothing. A maker still sits and that same window still converts. That funded work still releases. Wallet TAP is a missing dest book. Stock TAP is empty MM USDC. Missing MM books is the same first deny. Still 89 rules.

### Ink (`pnpm demo ink`)

**Fixture:** `fixtures/demo/ink/`.

An $800 hire funds. `hire.fund` of a second accepted USD hire with a loose USDC cart is `payment.currency_match` — a mixed journal, a USDC quote, and a loose USD pointer still allow — and locks no escrow. A USD cart still binds and funds. That first funded work still releases. Mix TAP is a mixed journal. Priced TAP is a USDC quote. Cart TAP is a loose USD pointer. Match TAP is a cheaper cart. Still 89 rules.

### Brim (`pnpm demo brim`)

**Fixture:** `fixtures/demo/brim/`.

An $800 hire funds. `ledger.transfer` of one more cent into a book already at the integer ceiling is `ledger.safe_balance` — empty cash, a missing dest, a mixed journal, and a mint still allow — and posts no journal. A penny still posts to a book that can hold it. That funded work still releases. Cash TAP is empty operating cash. Wallet TAP is a missing dest book. Mix TAP is a mixed journal. Mint TAP is a transfer from equity. Still 89 rules.

### Swap (`pnpm demo swap`)

**Fixture:** `fixtures/demo/swap/`.

An $800 hire funds. A market maker’s `market.quote` of an FX SKU with swapped `from`/`to` is `market.fx_pair` — a missing window, a corpse mint, and catalog currency still allow — and writes no quote. A real window still quotes and converts. That funded work still releases. Pane TAP is a missing window. Born TAP is a corpse mint. Conversion TAP is hiring the window. Paper TAP is settling a research quote. Pair TAP is unique-live. Still 89 rules.

### Sour (`pnpm demo sour`)

**Fixture:** `fixtures/demo/sour/`.

An $800 hire funds under the auto-approve line. A $6,400 `hire.create` escalates. After that quote dies, `approval.resolve` approved is `approval.replay` — a missing ticket and a dead ticket still allow — the ticket stays pending and the quote stays held. A grown-up no still frees the quote. That funded work still releases. Pause TAP is a dead ticket. Docket TAP is a missing ticket. Replay TAP is a retry of an allow. Still 89 rules.

### Cut (`pnpm demo cut`)

**Fixture:** `fixtures/demo/cut/`.

An $800 hire funds under a live handshake. After that hop is revoked, a new `hire.create` is `kya.chain_intact` — an expired hop, a nested parent, a frozen speaker, and a ghost revoke still allow — and writes no hire. A new handshake still unlocks the lock. That funded work still releases. Lapse TAP is an expired hop. Nest TAP is a nested parent. Deny TAP is a frozen speaker. Seal TAP is a ghost revoke. Ice TAP is a frozen founder. Completing funded work after expiry is legal; freeze and revoke still bind. Still 89 rules.

### Ice (`pnpm demo ice`)

**Fixture:** `fixtures/demo/ice/`.

An $800 hire funds under a live handshake. After the founder is frozen, a new `hire.create` is `kya.principal_not_frozen` — a frozen speaker, a revoked hop, and a no-op thaw still allow — and writes no hire. An unfreeze still unlocks the lock. That funded work still releases. Deny TAP is a frozen speaker. Cut TAP is a revoked hop. Thaw TAP is a no-op unfreeze. Completing funded work after expiry is legal; freeze and revoke still bind. Still 89 rules.

### Rail (`pnpm demo rail`)

**Fixture:** `fixtures/demo/rail/`.

An $800 hire funds under a slip that lists this kernel's sim ledger. A second slip that lists a ghost rail is `payment.allowed_payment_instruments` — listed payee, amount, SKU, and `instrument.sim_only` still allow — and writes no hire. That funded work still releases. A listed rail is not decoration. Payee TAP is who. SKU TAP is what. Live rails stay `instrument.sim_only`. Empty lists and nested children that drop the parent's list are the same first deny / `mandate.child_tighter`. Cite TAP binds `payment.reference` once a funded check exists. Still 89 rules.

### Pen (`pnpm demo pen`)

**Fixture:** `fixtures/demo/pen/`.

An $800 hire funds through grown-up pauses on an L1 desk. `envelope.submit` is `human.signature_present` — role, subject, and party still allow; the rung only pauses; no ticket is minted. Treasury still releases. Grade TAP is a junior nested mint. Pause TAP is a dead ticket. Badge TAP is auditor hire. Subject TAP is a stranger's slip. A vendor pull stays `mandate.subject_is_actor`. Demoting the buyer after fund is the same first deny. Completing funded work is legal. Still 89 rules.

### Well (`pnpm demo well`)

**Fixture:** `fixtures/demo/well/`.

An $800 hire funds under a three-hop handshake. A four-hop desk's `hire.create` is `kya.delegation_depth` — a missing path, a dead parent hop, and a climb still allow — and writes no hire. That funded work still releases. A fourth hop is not a nested parent. Cut TAP is a revoked hop. Nest TAP is a dead parent hop. Climb TAP is a grant ceiling. Name TAP is attesting in someone else's name. A nested `parentId` under the same grantor does not add hops. An agent attesting the founder's principal stays `kya.party`. Completing funded work is legal. Still 89 rules.

### Cite (`pnpm demo cite`)

**Fixture:** `fixtures/demo/cite/`.

An $800 hire funds. A second slip that cites a ghost checkout is `payment.reference` — listed payee, amount, SKU, listed rail, and `instrument.sim_only` still allow — and writes no hire. A citation of that funded check still hires. That funded work still releases. A listed reference is not decoration once a check exists. Payee TAP is who. Rail TAP is which ledger. SKU TAP is what. Live rails stay `instrument.sim_only`. Before any funded payment the constraint is still AP2-shaped catalog surface. Completing funded work is legal. Nested children that drop or change the parent's hash stay `mandate.child_tighter`. Still 89 rules.

### Lock (`pnpm demo lock`)

**Fixture:** `fixtures/demo/lock/`.

An $800 hire funds. A vendor's `identity.rotate` of the desk is `identity.party` — a missing agent and a frozen speaker still allow — and writes no `IDENTITY_ROTATE` line. The desk kid is unchanged. The desk still turns its own lock. That funded work still releases. Someone else's key is not yours to turn. Ghost rotate stays `identity.known`. Frozen speaker stays `actor.not_frozen`. System stays `actor.system_scope`. Rotation is not a new identity. Retired keys still verify. Name TAP is attesting in someone else's name. Thaw TAP is a no-op unfreeze. Now 90 rules.

### Void (`pnpm demo void`)

**Fixture:** `fixtures/demo/void/`.

An $800 hire funds. `hire.void` of that funded hire is `hire.state` — the party still allows; a missing hire is not this deny — and writes no void line. An unfunded offer still voids. That quote stays spent. That funded work still releases. A void is not a refund. Ghost void stays `hire.known`. A stranger stays `hire.party`. Arrow TAP is release before deliver. Refund TAP is unwind funded escrow. Still 90 rules.

### Fold (`pnpm demo fold`)

**Fixture:** `fixtures/demo/fold/`.

An $800 hire funds. A second vendor's `market.withdraw` of the research desk's live bid is `market.party` — a missing quote and an expired window still allow — and writes no `QUOTE_WITHDRAW` line. The quote stays live. The seller still folds its own bid. Hiring that folded quote is `market.not_expired`. That funded work still releases. Someone else's bid is not yours to pull. Ghost fold stays `market.known_rfq`. Spent stays `hire.quote_unspent`. Inspect labels `withdrawn` without writing status into the store. Lock TAP is someone else's key. Void TAP is tearing up an unfunded hire. Now 91 rules.

### Rip (`pnpm demo rip`)

**Fixture:** `fixtures/demo/rip/`.

An $800 hire funds. A desk's `mandate.revoke` of the founder's unused slip is `mandate.party` — a missing slip and an expired window still allow — and writes no `MANDATE_REVOKE` line. The slip stays live. The founder still rips its own unused slip. Hiring that ripped slip is `mandate.not_expired`. That funded work still releases. Someone else's unused slip is not yours to tear. Ghost rip stays `mandate.known_intent`. Completing funded work is legal. Inspect labels `revoked` without writing status into the store. Funded wins over revoked. Fold TAP is someone else's bid. Void TAP is tearing up an unfunded hire. Cut TAP is firing a handshake. Now 92 rules.

---

## 5. What NOT to build

Aether is an **economic control plane for agents**, not a product in an adjacent graveyard.

**Do not build:**

1. **A trading bot.** No order book, no candles, no “alpha,” no inventory optimization beyond the 200 bps MM band. The market maker is a **dumb FX window** so the demo can change assets. If someone adds `BID/ASK` ladders, delete the PR.
2. **A checkout clone.** No cart UI, no SKU storefront, no Stripe-shaped “create session / redirect.” Carts exist only as signed mandates between agents.
3. **Live rails in v0.** No bank APIs, no chain RPCs, no Coinbase, no real x402 facilitator. Adapters later implement the same envelope types. Until then `instrument.sim_only` denies everything else.
4. **Copied AP2 or x402 source.** Re-implement shapes. Do not vendor their SDKs.
5. **LLM-in-the-policy-loop.** An agent may *propose* a command in natural language; `evaluate()` is a pure function of `PolicyContext`. No “ask the model if this looks risky.”
6. **Consumer wallets, KYC products, yield, lending, perpetual leverage.**
7. **Silent retries that re-spend.** Nonce table is durable. `idempotency.nonce` is deny on `envelope.submit`, not “best effort,” and not a leftover `nonce` on a transfer. Command-level idempotency caches **allow/escalate only**. A deny is never a cached success. An expired escalate is not a live hit.
8. **Mutable audit or ledger history.** Corrections are reversing journal entries + new audit lines.
9. **Autonomy L5 as ‘god mode’.** L5 skips *humans*, not constraints, circuits, or freezes.
10. **Generic multi-agent chat framework.** No mailbox product. Messages that are not commands/quotes/receipts do not belong here.

**Build later (explicitly out of v0):** real HTTP-signature adapters, SD-JWT selective disclosure, travel-rule payloads, multi-currency books with 18-decimal tokens, compaction snapshots, distributed consensus.

---

## 6. Runtime dispatch contract

```ts
async function dispatch(cmd: Command): Promise<Result<CommandResult>> {
  expireApprovals();                                  // dead pauses are not live hits
  const key = cmd.idempotencyKey ?? autoKey(cmd);     // money-moving verbs only
  if (key && cache.has(key) && !opts.thresholdWaived) return replay(cache.get(key));
  const ctx = await snapshotPolicyContext(cmd);       // read-only
  const decision = evaluate(ctx);                     // pure
  decision.remediation = remediationFor(decision);    // typed next step; not English
  await audit.append({ action: "POLICY_DECISION", payload: decision });
  if (decision.verdict === "deny") return fail(decision); // NOT cached
  if (decision.verdict === "escalate") {
    const ticket = await approvals.create(cmd, decision);
    cache.set(key, { kind: "escalated", ticket });
    return { ok: true, value: { kind: "escalated", ticket } };
  }
  const result = await mutate(cmd);                   // ledger / hire / mandate
  await audit.append({ action: mutationAction(cmd), payload: result });
  cache.set(key, result);
  return { ok: true, value: result };
}
```

Errors are RFC 7807:

```ts
export interface AetherError {
  type: `https://aether.dev/errors/${string}`;
  title: string;
  status: 400 | 401 | 403 | 402 | 409 | 422 | 500;
  detail: string;
  instance: string;
  extra?: { ruleId?: string; seq?: number; remediation?: Remediation };
}
```

`422` = policy deny. `402` = payment required (envelope.require). `409` = mutate backstop (illegal hire arrow that policy missed). HTTP advertises `200` for an allow and `422` for `hire.state` and `idempotency.nonce`. Illegal hire arrows are `hire.state` (422) first. Nonce reuse is `idempotency.nonce` (422).

---

## 7. Test plan an implementer must land with v0

| Test file | Must prove |
|---|---|
| `audit.test.ts` | Tamper a JSONL byte → verify fails at that seq; reorder fails; genesis prevHash is zeros |
| `cli.test.ts` | `aether audit verify` is `audit.verify` on the command bus (kind allow, POLICY_DECISION, AUDIT_VERIFY); `aether ledger replay` is jsonl ≡ memory after a founder opening |
| `ledger.test.ts` | Unbalanced journal rejected; replay file ≡ memory; jsonl replay restores the same books; a tampered file does not; FX keeps two books; a dest that would leave `Number.isSafeInteger` is refused at `post()`; operating books are asset cash, not equity or escrow |
| `mandate.test.ts` | Wrong cart hash / swapped payee / amount mismatch denied; `checkExp: false` still verifies hashes on an expired cart; a ghost payment.reference still verifyChains; constraint evaluation is policy, not verifyChain |
| `cart.test.ts` | A cart must equal the hire it pays; a line with no amount is `command.malformed`, not a throw after yes; a second cart on the same hire is `hire.unique_cart`, not a pointer swap; a second payment on the same cart is `mandate.unique_payment`, not a second check; payment `exp` is one day in unix seconds, not milliseconds; funding with a loose cartId (never bound to the hire) is `hire.bound_cart`, not a throw at release; a line whose cents overflow, or mixed USD/USDC lines, is `command.malformed`; fund after the cart window is `mandate.chain_integrity`; completing or refunding a funded hire after that window is legal |
| `policy.test.ts` | Table-driven: each ruleId has allow + deny fixtures; `velocity.window` escalates a new hire/fund/FX settle after a hot hour and allows complete-after-fund and reads; `host.not_hosted` refuses subscribe on the public kernel and allows `host.card`; `host.human_authority` / `host.unique_subscriber` bind hosted subscribe; system may verify the notary; hire.no_self_deal is a unit deny; dispatch cannot mint a self-deal |
| `ladder.test.ts` | Skip 2→4 is `ladder.legal`; L5 before freeze test is `ladder.legal`; minting L5 at register is `ladder.birth_rung`; freeze restores the prior rung |
| `hire.test.ts` | deliver before funded denied; self-deal is policy.test.ts (dispatch cannot mint one); illegal arrows and payment-required before deliver are `hire.state`; void of funded is `hire.state`; void of offered does not restore the quote; a stranger's void is `hire.party`; ghost void is `hire.known`; funding without cash is `ledger.sufficient`; quoting an FX SKU without a window is `market.fx_window`; minting or hiring under an expired parent is `mandate.parent_fresh`; hiring or funding under a nested hop whose parent hop died is `kya.parent_fresh`; completing a funded child hire after the parent (slip or hop) dies is legal; completing a funded hire after the hop itself expires is legal; a new hire or fund after that window is `kya.attestation_fresh`; freeze and revoke still bind on release; completing a funded hire after a climb above the handshake ceiling is legal; a new hire or fund after that climb is `kya.capability_subset`; completing a funded hire after a climb above the slip ceiling is legal; a new hire or fund after that climb is `ladder.max_autonomy_constraint`; completing a funded hire after a hot settle hour is legal; a new hire or fund after that hour is `velocity.window`; a catalog read after that hour is not a spend |
| `window.test.ts` | Completing a funded hire after `not_after` is legal; a new hire is `payment.execution_date`; minting a closed, inverted, or unparseable window is `mandate.window_fresh`, not a written corpse; a future `not_before` still mints if it opens while the slip lives; a window that opens after the seven-day exp is `mandate.window_reach`; ghost subject stays `identity.known`; ghost parent stays `mandate.known_parent`; completing after the cart window is covered in `cart.test.ts` |
| `recurrence.test.ts` | First hire with `max_occurrences: 1` then a second create is `payment.recurrence`; DAILY gap binds until 24h; minting `max_occurrences` ≤ 0 is `mandate.occurrence_fresh`, not a written corpse; one slot still mints; ghost subject stays `identity.known`; ghost parent stays `mandate.known_parent` |
| `envelope.test.ts` | 402 header round-trip; nonce reuse denied |
| `demo.test.ts` | Sprint Procurement assertions above |
| `night-watch.test.ts` | KYA, L5, sticky circuit, freeze principal, revoke |
| `clearing-window.test.ts` | Bilateral cap TAP; `settle_window` photographs gross and does not move cash; public default stays 50_000_000 |
| `refund.test.ts` | Refund TAP; escrow returns, spend restores, clearing reverse-records, quote stays spent, tripped circuit stays sticky, refund after deliver is `hire.state` |
| `replay.test.ts` | Replay TAP; same `hire.fund` does not move cash again; same `hire.create` returns the same contract; a new key is `hire.quote_unspent` |
| `nonce.test.ts` | Envelope-nonce TAP; reused submit nonce is `idempotency.nonce`; leftover nonce on a transfer is not |
| `deny-cache.test.ts` | Deny-cache TAP; frozen hire.create is `actor.not_frozen`; retry is a new decision; unfreeze lets the same command allow |
| `recurrence-cadence.test.ts` | Recurrence TAP; one-slot slip releases once; completing funded work is not a second slot; second hire.create is `payment.recurrence` |
| `calendar.test.ts` | Calendar TAP; hire.create before not_before is `payment.execution_date`; fund inside the window; release after not_after; a new hire is `payment.execution_date` |
| `cadence-slot.test.ts` | Slot TAP; refund restores cash and spend; occurrence count stays 1; second hire.create is `payment.recurrence` |
| `daily-gap.test.ts` | Daily TAP; same-day second hire.create is `payment.recurrence`; after 24 hours that command allows |
| `cart-occupancy.test.ts` | Cart occupancy TAP; loose cartId fund is `hire.bound_cart`; second cart is `hire.unique_cart`; second payment is `mandate.unique_payment`; the same fund command then allows |
| `hot-hour.test.ts` | Velocity TAP; cool hour funds; after heat the funded hire still releases; new hire.create is `velocity.window` escalate |
| `operator-door.test.ts` | Operator-door TAP; public subscribe is `host.not_hosted`; hosted unsigned is 401; unpaid is 402; subscribe is not a spend gate; `PROTOCOL.hosted` stays false |
| `cart-match.test.ts` | Cart-match TAP; cheap cart is `hire.cart_matches` and writes nothing; matching cart allows; fund moves hire price; second matching cart is `hire.unique_cart` |
| `closed-room.test.ts` | Closed-room TAP; uninvited quote is `market.invited_seller` and writes nothing; invited quote + hire.create allow; empty invite list lets the outsider quote |
| `fx-not-hire.test.ts` | Conversion TAP; hire.create against an FX window is `hire.not_fx` and does not consume the window; settle converts; spent window is `hire.quote_unspent` |
| `unique-live.test.ts` | Unique-live TAP; second attest is `kya.unique_live` and writes nothing; a different pair allows; revoke then attest again |
| `spread-bound.test.ts` | Spread TAP; off-band nested rate is `mm.spread_bound` and writes nothing even with an in-band decoy; in-band quote settles |
| `parent-fresh.test.ts` | Nest TAP; scout funds while parent hop lives; new hire.create after parent dies is `kya.parent_fresh` and writes nothing; funded work still releases |
| `mandate-parent.test.ts` | Heir TAP; desk funds against a child while parent slip lives; new hire.create after parent dies is `mandate.parent_fresh` and writes nothing; child's own exp still lives; funded work still releases |
| `mm-inventory.test.ts` | Stock TAP; thin MM USDC on a large window is `mm.inventory` and does not consume the quote; a smaller window on a different RFQ converts |
| `payment-budget.test.ts` | Purse TAP; $800 fund against a $1,000 envelope with a $5,000 item cap; $400 second hire.create is `payment.budget` and writes nothing; item cap still allows; funded work still releases |
| `host-unique.test.ts` | Seat TAP; hosted subscribe records one row; desk funds while subscribed; second host.subscribe is `host.unique_subscriber` even on a fresh slip; a different agent takes its own seat; funded work still releases; `PROTOCOL.hosted` stays false |
| `payment-parent.test.ts` | Cover TAP; desk funds $800 against a $1,000 parent envelope; $400 scout hire.create on a tighter child is `payment.parent_budget` and writes nothing; child's own envelope still allows; funded parent work still releases |
| `operating-book.test.ts` | Mint TAP; transfer from equity is `ledger.operating_book` and writes nothing; desk funds $800; transfer from that escrow is `ledger.operating_book`; funded work still releases |
| `payment-payees.test.ts` | Payee TAP; listed vendor funds $800; unlisted registered vendor hire.create is `payment.allowed_payees` and writes nothing; quote still written; amount and known counterparty still allow; funded work still releases |
| `capability-subset.test.ts` | Climb TAP; L3 handshake funds $800; climb to L4; new hire.create is `kya.capability_subset` and writes nothing; slip ceiling still allows; funded work still releases |
| `fx-fresh.test.ts` | Born TAP; dead `validUntil` is `market.fx_fresh` and writes nothing; pair/window/band/later-lapse still allow; an open window quotes and settles |
| `window-reach.test.ts` | Reach TAP; live slip funds $800; `not_before` after seven-day exp is `mandate.window_reach` and writes nothing; closed calendar still allows; reachable future still mints; funded work still releases |
| `kya-window.test.ts` | Year TAP; one-year hop funds $800; `expiresAt` after now+1y is `kya.mint_window` and writes nothing; born-dead and unique-live still allow; a one-year hop still mints; funded work still releases |
| `circuit-daily.test.ts` | Fuse TAP; $800 fund against a $1,000 daily fuse; $400 second hire.create is `circuit.daily` and writes nothing; envelope and item cap still allow; fuse blows; funded work still releases |
| `payment-skus.test.ts` | SKU TAP; listed `research.brief` funds $800; catalog `research.deep` hire.create is `payment.allowed_skus` and writes nothing; quote still written; known SKU, listed payee, and room still allow; funded work still releases |
| `sku-currency.test.ts` | Priced TAP; USDC quote of `research.brief` is `market.sku_currency` and writes nothing; known SKU, known RFQ, and FX pair still allow; a USD quote still writes; funded work still releases |
| `hire-party.test.ts` | Party TAP; $800 hire funds; a different vendor’s hire.deliver is `hire.party` and writes nothing; hire.known, hire.state, and role still allow; hire stays funded; the seller who quoted still releases |
| `ledger-sufficient.test.ts` | Cash TAP; $800 hire empties the desk; $400 second hire.fund is `ledger.sufficient` and locks nothing; same currency, operating cash, and hire arrow still allow; funded work still releases |
| `not-expired.test.ts` | Stale TAP; $800 hire funds on a live quote; lapsed quote hire.create is `market.not_expired` and writes nothing; known SKU, known room, unspent, and born-dead still allow; a fresh quote on that still-live RFQ still hires; funded work still releases |
| `chain-integrity.test.ts` | Chain TAP; $800 hire funds on a live cart; second hire.fund after the cart day is `mandate.chain_integrity` and locks nothing; occupancy, cash, and hire arrow still allow; hire stays accepted; funded work still releases |
| `hire-state.test.ts` | Arrow TAP; $800 hire funds; hire.release before deliver is `hire.state` and pays nothing; hire.known, hire.party, escrow, and bound cart still allow; hire stays funded; funded work still releases after deliver. Bare TAP is deliver before fund. |
| `ledger-known.test.ts` | Wallet TAP; $800 hire funds; compute vendor fx_settle is `ledger.known_account` and consumes nothing; maker, inventory, live quote, and USD cash still allow; a vendor with a USDC book still converts; funded work still releases |
| `kya-party.test.ts` | Name TAP; $800 hire funds; L4 scout kya.attest in the founder’s name is `kya.party` and writes nothing; not-self, chain, unique-live, and capability-subset still allow; founder still mints that pair; funded work still releases |
| `fx-window.test.ts` | Pane TAP; $800 hire funds; MM quote of an FX SKU with no window is `market.fx_window` and writes nothing; known SKU, known room, pair, and born-dead still allow; a real window still quotes and converts; funded work still releases |
| `intent-subject.test.ts` | Subject TAP; $800 hire binds to desk A; desk B hire.fund is `mandate.subject_is_actor` and locks nothing; known hire, legal arrow, bound cart, cash, intact chain, and hire.party still allow; hire stays accepted; desk A still funds; funded work still releases |
| `fx-quote.test.ts` | Paper TAP; $800 hire funds; research quote fx_settle is `market.fx_quote` and consumes nothing; pair, maker, dest book, and band still allow; a real window still converts; funded work still releases |
| `same-currency.test.ts` | Mix TAP; $800 hire funds; USD into a USDC book is `ledger.same_currency` and posts nothing; known books, operating cash, and source still allow; a real window still converts; funded work still releases |
| `ladder-legal.test.ts` | Rung TAP; $800 hire funds; ladder.set L2→L4 is `ladder.legal` and the scout stays L2; identity.known and role_capability still allow; a one-rung climb still goes through; funded work still releases |
| `min-level.test.ts` | Grade TAP; $800 hire funds; L3 scout nested mandate.issue_intent is `ladder.min_level` and writes nothing; known parent, tighter child, and capability-subset still allow; an L4 desk still mints that child; funded work still releases |
| `birth-rung.test.ts` | Cradle TAP; $800 hire funds; identity.register at L5 is `ladder.birth_rung` and writes nothing; unique_key, system_scope, role_capability, and ladder.legal still allow; an L4 register still goes through; funded work still releases |
| `max-autonomy.test.ts` | Ceiling TAP; $800 hire funds under an L3 slip; after a climb to L4 a new hire.create is `ladder.max_autonomy_constraint` and writes nothing; handshake ceiling, chain, and item cap still allow; funded work still releases |
| `attestation-fresh.test.ts` | Lapse TAP; $800 hire funds under a noon handshake; after that hop dies a new hire.create is `kya.attestation_fresh` and writes nothing; chain, nested parent, and grant still allow; the pair still occupies; funded work still releases |
| `approval-pending.test.ts` | Pause TAP; $800 hire funds under the auto-approve line; $6,400 hire.create escalates `approval.threshold`; after that ticket dies approval.resolve is `approval.pending` and writes nothing; known and replay still allow; quote unreserved; funded work still releases |
| `kya-not-self.test.ts` | Mirror TAP; $800 hire funds; kya.attest of the speaker is `kya.not_self` and writes nothing; party, unique-live, capability-subset, and mint-fresh still allow; the founder still mints a real pair; funded work still releases |
| `host-authority.test.ts` | Warrant TAP; $800 hire funds; host.subscribe on an agent-issued slip is `host.human_authority` and writes no row; not_hosted, known intent, not_expired, subject, and unique_subscriber still allow; a human-issued slip still seats; funded work still releases |
| `occurrence-fresh.test.ts` | Vacant TAP; $800 hire funds; mandate.issue_intent with max_occurrences 0 is `mandate.occurrence_fresh` and writes no slip; known_parent, window_fresh, payment.recurrence, and child_tighter still allow; a one-slot slip still mints; funded work still releases |
| `role-capability.test.ts` | Badge TAP; $800 hire funds; auditor hire.create is `actor.role_capability` and writes no hire; not_frozen, actor.known, system_scope, and quote_unspent still allow; quote unspent; auditor still verifies; funded work still releases |
| `amount-range.test.ts` | Lid TAP; $800 fund against a $1,000 item cap with a $5,000 envelope; $1,500 hire.create is `payment.amount_range` and writes nothing; envelope and fuse still allow; quote unspent; funded work still releases |
| `escrow-required.test.ts` | Bare TAP; $800 hire funds; hire.deliver on an accepted hire is `hire.escrow_required` and writes no deliverable; hire.known, hire.party, role, and not_frozen still allow; sneak stays accepted; funded work still releases |
| `known-sku.test.ts` | Shelf TAP; $800 hire of a catalog good funds; market.rfq of lunch.tacos is `market.known_sku` and writes no RFQ; slip list and catalog currency still allow; funded work still releases |
| `known-rfq.test.ts` | Hall TAP; $800 hire funds; market.quote on a ghost RFQ is `market.known_rfq` and writes no quote; missing SKU and closed guest list still allow; funded work still releases |
| `known-intent.test.ts` | Writ TAP; $800 hire funds; hire.create on a ghost intent is `mandate.known_intent` and writes no hire; missing handshake, dead parent, known room, and unspent quote still allow; funded work still releases |
| `known-cart.test.ts` | Crate TAP; $800 hire funds; mandate.issue_payment on a ghost cart is `mandate.known_cart` and writes no payment; occupancy, chain, and missing slip still allow; funded work still releases |
| `known-hire.test.ts` | Pact TAP; $800 hire funds; hire.deliver on a ghost hire is `hire.known` and writes no deliverable; party, state, escrow, and bound cart still allow; funded work still releases |
| `known-parent.test.ts` | Root TAP; $800 hire funds; mandate.issue_intent on a ghost parent is `mandate.known_parent` and writes no child; tighter child, dead parent, and vacant cadence still allow; funded work still releases |
| `known-approval.test.ts` | Docket TAP; $800 hire funds under the auto-approve line; approval.resolve on a ghost ticket is `approval.known` and writes no ticket; pending, replay, role, and not_frozen still allow; funded work still releases |
| `kya-known-parent.test.ts` | Graft TAP; $800 hire funds; kya.attest under a ghost parent hop is `kya.known_parent` and writes no hop; dead hop, missing slip parent, not_self, and unique_live still allow; funded work still releases |
| `known-attestation.test.ts` | Seal TAP; $800 hire funds; a live handshake is minted; kya.revoke of a ghost attestation is `kya.known_attestation` and does not tombstone the live hop; missing hop parent, party, and identity.known still allow; funded work still releases |
| `known-invitee.test.ts` | Guest TAP; $800 hire funds; market.rfq that invites a missing seller is `identity.known` and writes no RFQ; closed guest list, missing SKU, and missing room still allow; funded work still releases |
| `cart-fresh.test.ts` | Dust TAP; $800 hire funds; mandate.issue_payment on a stale unpaid cart is `mandate.not_expired` and writes no payment; occupancy, known cart, and chain still allow; funded work still releases |
| `freeze-state.test.ts` | Thaw TAP; $800 hire funds; identity.unfreeze of a live unfrozen auditor is `identity.freeze_state` and writes no UNFREEZE line; identity.known, not_frozen, and role still allow; auditor stays live; funded work still releases |
| `unique-key.test.ts` | Twin TAP; $800 hire funds; identity.register on the taken desk alias is `identity.unique_key` and writes no agent; birth_rung, system_scope, and role still allow; live desk still sits; funded work still releases |
| `system-scope.test.ts` | Fence TAP; $800 hire funds; identity.register as system after the first human is `actor.system_scope` and writes no agent; unique_key, birth_rung, and role still allow; catalog still reads; funded work still releases |
| `actor-known.test.ts` | Mute TAP; $800 hire funds; ledger.balances from a missing actorId is `actor.known` and writes no books; identity.known, not_frozen, role, and system_scope still allow; live desk still reads; funded work still releases |
| `receipt-known.test.ts` | Nil TAP; $800 hire funds; receipt.get of a missing receiptId is `receipt.known` and writes no receipt; actor.known, identity.known, role, and system_scope still allow; live receipt still fetches; funded work still releases |
| `kya-mint-fresh.test.ts` | Spark TAP; $800 hire funds with no handshake yet; kya.attest with expiresAt already past is `kya.mint_fresh` and writes no hop; mint_window, unique_live, not_self, identity.known, and party still allow; a one-year hop still mints; funded work still releases |
| `window-fresh.test.ts` | Wilt TAP; $800 hire funds; mandate.issue_intent with not_after already past is `mandate.window_fresh` and writes no slip; window_reach, execution_date, identity.known, known_parent, and occurrence_fresh still allow; a live slip still mints; funded work still releases |
| `mm-known.test.ts` | Maker TAP; $800 hire funds with no market maker; vendor fx_settle of a live FX quote is `mm.known` and consumes nothing; inventory, dest book, live quote, pair, band, cash, and role still allow; a maker still sits and the same window still converts; funded work still releases |
| `currency-match.test.ts` | Ink TAP; $800 hire funds; hire.fund of a second accepted USD hire with a loose USDC cart is `payment.currency_match` and locks no escrow; mixed journal, USDC quote, chain, range, and hire state still allow; a USD cart still binds and funds; first funded work still releases |
| `safe-balance.test.ts` | Brim TAP; $800 hire funds; ledger.transfer of one more cent into a book already at the integer ceiling is `ledger.safe_balance` and posts no journal; empty cash, missing dest, mixed journal, and mint still allow; a penny still posts to a book that can hold it; funded work still releases |
| `fx-pair.test.ts` | Swap TAP; $800 hire funds; MM quote of an FX SKU with swapped from/to is `market.fx_pair` and writes nothing; missing window, corpse mint, and catalog currency still allow; a real window still quotes and converts; funded work still releases |
| `approval-replay.test.ts` | Sour TAP; $800 hire funds under the auto-approve line; $6,400 hire.create escalates; after that quote dies approval.resolve approved is `approval.replay` and writes no hire; known and pending still allow; quote stays held; reject still frees it; funded work still releases |
| `chain-intact.test.ts` | Cut TAP; $800 hire funds under a live handshake; after that hop is revoked a new hire.create is `kya.chain_intact` and writes no hire; attestation_fresh, parent_fresh, speaker not_frozen, and known_attestation still allow; a new handshake still unlocks the lock; funded work still releases |
| `principal-not-frozen.test.ts` | Ice TAP; $800 hire funds under a live handshake; after the founder is frozen a new hire.create is `kya.principal_not_frozen` and writes no hire; chain_intact, attestation_fresh, speaker not_frozen, and freeze_state still allow; an unfreeze still unlocks the lock; funded work still releases |
| `allowed-instruments.test.ts` | Rail TAP; $800 hire funds under a slip that lists the sim ledger; hire.create against a ghost-rail slip is `payment.allowed_payment_instruments` and writes no hire; payee, amount, SKU, and sim_only still allow; funded work still releases |
| `human-signature.test.ts` | Pen TAP; $800 hire funds through grown-up pauses on an L1 desk; envelope.submit is `human.signature_present` and mints no ticket; role, subject, and party still allow; the rung only pauses; treasury still releases |
| `delegation-depth.test.ts` | Well TAP; $800 hire funds under a three-hop handshake; hire.create down a four-hop chain is `kya.delegation_depth` and writes no hire; chain_intact, parent_fresh, and capability_subset still allow; funded work still releases |
| `payment-reference.test.ts` | Cite TAP; $800 hire funds; hire.create against a ghost-checkout slip is `payment.reference` and writes no hire; payee, amount, SKU, listed rail, and sim_only still allow; a citation of that funded check still hires; funded work still releases |
| `identity-party.test.ts` | Lock TAP; $800 hire funds; identity.rotate of a desk by a vendor is `identity.party` and writes no IDENTITY_ROTATE line; identity.known, not_frozen, and role still allow; desk kid unchanged; desk still turns its own lock; funded work still releases |
| `hire-void.test.ts` | Void TAP; $800 hire funds; hire.void of that funded hire is `hire.state` and writes no void line; hire.party and hire.known still allow; an unfunded offer still voids; quote stays spent; funded work still releases |
| `market-party.test.ts` | Fold TAP; $800 hire funds; market.withdraw of a live quote by a second vendor is `market.party` and writes no QUOTE_WITHDRAW line; known_rfq, not_expired, and quote_unspent still allow; seller still folds its own bid; hire.create of that folded quote is `market.not_expired`; funded work still releases |
| `mandate-party.test.ts` | Rip TAP; $800 hire funds; mandate.revoke of a live unused intent by a desk is `mandate.party` and writes no MANDATE_REVOKE line; known_intent and not_expired still allow; founder still rips its own unused slip; hire.create of that ripped slip is `mandate.not_expired`; funded work still releases |
| `mcp.test.ts` | Sub-hire TAP + clearing-window TAP over `aether_demo_clearing` + refund TAP over `aether_demo_refund` + replay TAP over `aether_demo_replay` + envelope-nonce TAP over `aether_demo_nonce` + deny-cache TAP over `aether_demo_deny` + recurrence TAP over `aether_demo_recurrence` + calendar TAP over `aether_demo_calendar` + slot TAP over `aether_demo_slot` + daily TAP over `aether_demo_daily` + cart occupancy TAP over `aether_demo_cart` + velocity TAP over `aether_demo_velocity` + operator-door TAP over `aether_demo_door` + cart-match TAP over `aether_demo_match` + closed-room TAP over `aether_demo_room` + conversion TAP over `aether_demo_conversion` + unique-live TAP over `aether_demo_pair` + spread TAP over `aether_demo_band` + nest TAP over `aether_demo_nest` + heir TAP over `aether_demo_heir` + stock TAP over `aether_demo_stock` + purse TAP over `aether_demo_purse` + seat TAP over `aether_demo_seat` + cover TAP over `aether_demo_cover` + mint TAP over `aether_demo_mint` + payee TAP over `aether_demo_payee` + climb TAP over `aether_demo_climb` + born TAP over `aether_demo_born` + reach TAP over `aether_demo_reach` + year TAP over `aether_demo_year` + fuse TAP over `aether_demo_fuse` + sku TAP over `aether_demo_sku` + priced TAP over `aether_demo_priced` + party TAP over `aether_demo_party` + cash TAP over `aether_demo_cash` + stale TAP over `aether_demo_stale` + chain TAP over `aether_demo_chain` + arrow TAP over `aether_demo_arrow` + wallet TAP over `aether_demo_wallet` + name TAP over `aether_demo_name` + pane TAP over `aether_demo_pane` + subject TAP over `aether_demo_subject` + paper TAP over `aether_demo_paper` + mix TAP over `aether_demo_mix` + rung TAP over `aether_demo_rung` + grade TAP over `aether_demo_grade` + cradle TAP over `aether_demo_cradle` + ceiling TAP over `aether_demo_ceiling` + lapse TAP over `aether_demo_lapse` + pause TAP over `aether_demo_pause` + mirror TAP over `aether_demo_mirror` + warrant TAP over `aether_demo_warrant` + vacant TAP over `aether_demo_vacant` + badge TAP over `aether_demo_badge` + lid TAP over `aether_demo_lid` + bare TAP over `aether_demo_bare` + shelf TAP over `aether_demo_shelf` + hall TAP over `aether_demo_hall` + writ TAP over `aether_demo_writ` + crate TAP over `aether_demo_crate` + pact TAP over `aether_demo_pact` + root TAP over `aether_demo_root` + docket TAP over `aether_demo_docket` + graft TAP over `aether_demo_graft` + seal TAP over `aether_demo_seal` + guest TAP over `aether_demo_guest` + dust TAP over `aether_demo_dust` + thaw TAP over `aether_demo_thaw` + twin TAP over `aether_demo_twin` + fence TAP over `aether_demo_fence` + mute TAP over `aether_demo_mute` + nil TAP over `aether_demo_nil` + spark TAP over `aether_demo_spark` + wilt TAP over `aether_demo_wilt` + maker TAP over `aether_demo_maker` + ink TAP over `aether_demo_ink` + brim TAP over `aether_demo_brim` + swap TAP over `aether_demo_swap` + sour TAP over `aether_demo_sour` + cut TAP over `aether_demo_cut` + ice TAP over `aether_demo_ice` + rail TAP over `aether_demo_rail` + pen TAP over `aether_demo_pen` + well TAP over `aether_demo_well` + cite TAP over `aether_demo_cite` + lock TAP over `aether_demo_lock` + void TAP over `aether_demo_void` + fold TAP over `aether_demo_fold` + rip TAP over `aether_demo_rip` + MCP `tools/list` + `identity.register` replay + `aether_hire_refund`; command tools are 1:1 with CommandType including `aether_market_fx_settle` and `aether_ledger_transfer`; an unknown `actor` alias is `actor.known`, not silent system; omit or `system` still bootstraps; omit-actor `aether_audit_verify` is the same speaker as HTTP GET; omit-actor `aether_ledger_balances` / `aether_receipt_get` is the same speaker as HTTP GET; Demo tools are TAP runners |
| `operator.test.ts` | Register/hire/refund retries replay; denies not cached; refund restores cash; durable idempotency; `SIM_RAIL.live === false`; ghost book is `ledger.known_account`; mixed-currency transfer is `ledger.same_currency`; overdraft is `ledger.sufficient`; dest overflow is `ledger.safe_balance`; transfer from equity or escrow is `ledger.operating_book`; an amount_range with no max is `command.malformed`; a leftover nonce on a transfer is not `idempotency.nonce` |
| `inspect.test.ts` | `aether_get` / inspect by id; MCP command schemas; expired approval tickets refuse resolve; inspect / snapshot label an expired ticket `expired`, not `pending`; inspect / snapshot label a pending ticket whose paused command would not allow `stale`, not `pending`; approve of that pause still names `approval.replay`; reject still releases the quote; the store stays `pending`; inspect of a `dlg_` hop labels `live` / `expired` / `revoked` the same way the graph does, without writing status into the store; inspect of a `qte_` quote labels `live` / `expired` / `spent` / `held` / `withdrawn` without writing status into the store; spent and held win over withdrawn and expired; withdrawn wins over expired; a reservation whose ticket is past expiresAt is not held; a lapsed FX `validUntil` inside the quote envelope is `expired`; a hire quote whose parent RFQ died is `expired` even if the quote envelope still lives; an FX quote does not expire when the RFQ dies; inspect of an `rfq_` room labels `live` / `expired` without writing status into the store; quoting or hiring against a stale room still names `market.not_expired`; inspect of a cart labels `live` / `expired` / `bound` without writing status into the store; bound (unique_payment occupies) wins over expired; a hire that points at a cart is not bound; inspect of a payment labels `live` / `expired` / `funded` without writing status into the store; funded (escrow moved, including refund) wins over expired; snapshot lists payments; an accepted-but-unfunded payment is live; fund of a stale unpaid payment still names `mandate.chain_integrity`; a payment whose parent cart died is `expired` even if its own `exp` still lives; funded still wins after that cart death; inspect of an intent labels `live` / `expired` / `funded` / `revoked` without writing status into the store; funded (escrow moved against this slip, including refund) wins over revoked and expired; revoked wins over expired; a child hire does not occupy the parent; recurrence spend is not occupancy; snapshot lists signed intent views; an accepted-but-unfunded intent is live; a new hire against a stale unused slip still names `mandate.not_expired`; a child whose parent died is `expired` even if its own `exp` still lives; funded still wins after that parent death; hire against that unpaid child still names `mandate.parent_fresh`; completing a funded hire after the seven-day window is legal; inspect of a hire labels `live` / `expired` / `funded` without writing status into the store; funded (escrow moved) wins over expired; an offered hire whose slip died is `expired`; an offered child hire whose parent died is `expired` even if the child exp still lives; accept of that unpaid offer still names `mandate.not_expired` / `mandate.parent_fresh`; completing a funded hire after the slip dies is legal; a missing receipt is `receipt.known`, not an empty success |
| `host.test.ts` | System pins the host card (`hosted` false, `evaluateLlm` false, self-host 0); a desk may read it; subscribe on this kernel is `host.not_hosted`; system subscribe is `actor.system_scope`; vendor subscribe is `actor.role_capability`; MCP `aether_host_card` / `aether://host` match the pin; a hosted operator records a unique `hsb_` against a live human-issued intent; inspect / snapshot label that row `live` or `expired` without writing status into the store; a row whose slip died is `expired`, not live enrollment; unique_subscriber still occupies; ghost/omit is `mandate.known_intent`; stale is `mandate.not_expired`; wrong subject is `mandate.subject_is_actor`; agent-issued is `host.human_authority`; a second row is `host.unique_subscriber`; spend is not gated on the row; durable restore keeps the row; discovery card names POST /v1/commands and the TAP demos including refund, replay, nonce, deny, recurrence, calendar, slot, daily, cart, velocity, door, match, room, conversion, pair, band, nest, heir, stock, purse, seat, cover, mint, payee, climb, born, reach, year, fuse, sku, priced, party, cash, stale, chain, arrow, and wallet; discovery card names POST /v1/commands and the TAP demos including refund, replay, nonce, deny, recurrence, calendar, slot, daily, cart, velocity, door, match, room, conversion, pair, band, nest, heir, stock, purse, seat, cover, mint, payee, climb, born, reach, year, fuse, sku, priced, party, cash, stale, chain, arrow, wallet, name, pane, subject, paper, mix, rung, grade, cradle, ceiling, lapse, pause, mirror, warrant, vacant, badge, lid, bare, shelf, hall, writ, crate, pact, root, docket, graft, and seal, and guest, and dust, and thaw, and twin, and fence, and mute, and nil, and spark, and wilt, and maker, and ink, and brim, and swap, and sour, and cut, and ice, and rail, and pen, and well, and cite, and lock, and void, and fold, and rip |
| `approval.test.ts` | Ghost ticket is `approval.known`; expired or already-resolved is `approval.pending`; approving a stale pause or a ticket with no held command is `approval.replay`, not a mutate throw after yes; reject of a dead pause still releases the quote; an L1 hire.create ticket that a grown-up signs is an offered hire, not a stuck escalate; an expired hire.create escalate is not a leftover replay that traps the quote |
| `identity.test.ts` | Ghost freeze / rotate / handshake principal / revoke is `identity.known`; vendor rotating a live desk is `identity.party`; attesting yourself is `kya.not_self`; nested handshake with a ghost parent is `kya.known_parent`; nested handshake under an expired or revoked parent hop is `kya.parent_fresh`; ghost or foreign attestationId revoke is `kya.known_attestation`; L4 writing a founder handshake is `kya.party`; omitted principalId is the speaker, not the supervisor; L4 omitting `maxAutonomy` (L5) is `kya.capability_subset`; reused alias, second market maker, or a taken USDC book is `identity.unique_key`; vendor/MM USDC `ownerId` is the agent, not system; minting L5 at register is `ladder.birth_rung`; unfreeze of a live unfrozen agent (and a second freeze) is `identity.freeze_state`; a second live handshake for the same pair is `kya.unique_live`; a handshake born expired or unparseable is `kya.mint_fresh`; a handshake that outlives one year is `kya.mint_window`; an expired hop is `expired` in the graph view, not `live`, and still occupies the pair; a missing speaker is `actor.known`, not a throw before policy; system spending or minting a second agent is `actor.system_scope`; system may verify the notary; a vendor cannot; HTTP/MCP unknown alias is `actor.known`, not silent system; an RFQ that invites a missing seller is `identity.known`; Thaw TAP is unfreeze of a live unfrozen auditor |
| `http.test.ts` | `GET /v1/audit/verify` is `audit.verify` on the command bus (kind allow, POLICY_DECISION, AUDIT_VERIFY, clock steps); POST omit-actor is the same speaker; vendor POST is `actor.role_capability`; `GET /v1/accounts/{id}` and `GET /v1/receipts/{id}` are `ledger.balances` / `receipt.get` as system (not ops-human); a missing founder or frozen founder is not a deny; a ghost book is `ledger.known_account`; a ghost receipt is `receipt.known`; `POST /v1/commands` is every CommandType; unknown type is `command.malformed`; hire.deliver / hire.release / market.fx_settle / ledger.transfer have HTTP aliases; `POST /v1/demo/clearing` is the clearing-window TAP; `POST /v1/demo/refund` is the refund TAP; `POST /v1/demo/replay` is the replay TAP; `POST /v1/demo/nonce` is the envelope-nonce TAP; `POST /v1/demo/deny` is the deny-cache TAP; `POST /v1/demo/recurrence` is the recurrence TAP; `POST /v1/demo/calendar` is the calendar TAP; `POST /v1/demo/slot` is the slot TAP; `POST /v1/demo/daily` is the daily TAP; `POST /v1/demo/cart` is the cart occupancy TAP; `POST /v1/demo/velocity` is the velocity TAP; `POST /v1/demo/door` is the operator-door TAP; `POST /v1/demo/match` is the cart-match TAP; `POST /v1/demo/room` is the closed-room TAP; `POST /v1/demo/conversion` is the conversion TAP; `POST /v1/demo/pair` is the unique-live TAP; `POST /v1/demo/band` is the spread TAP; `POST /v1/demo/nest` is the nest TAP; `POST /v1/demo/heir` is the heir TAP; `POST /v1/demo/stock` is the stock TAP; `POST /v1/demo/purse` is the purse TAP; `POST /v1/demo/seat` is the seat TAP; `POST /v1/demo/cover` is the cover TAP; `POST /v1/demo/mint` is the mint TAP; `POST /v1/demo/payee` is the payee TAP; `POST /v1/demo/climb` is the climb TAP; `POST /v1/demo/born` is the born TAP; `POST /v1/demo/reach` is the reach TAP; `POST /v1/demo/year` is the year TAP; `POST /v1/demo/fuse` is the fuse TAP; `POST /v1/demo/sku` is the sku TAP; `POST /v1/demo/priced` is the priced TAP; `POST /v1/demo/party` is the party TAP; `POST /v1/demo/cash` is the cash TAP; `POST /v1/demo/stale` is the stale TAP; `POST /v1/demo/chain` is the chain TAP; `POST /v1/demo/arrow` is the arrow TAP; `POST /v1/demo/wallet` is the wallet TAP; `POST /v1/demo/name` is the name TAP; `POST /v1/demo/pane` is the pane TAP; `POST /v1/demo/subject` is the subject TAP; `POST /v1/demo/paper` is the paper TAP; `POST /v1/demo/mix` is the mix TAP; `POST /v1/demo/rung` is the rung TAP; `POST /v1/demo/grade` is the grade TAP; `POST /v1/demo/cradle` is the cradle TAP; `POST /v1/demo/ceiling` is the ceiling TAP; `POST /v1/demo/lapse` is the lapse TAP; `POST /v1/demo/pause` is the pause TAP; `POST /v1/demo/mirror` is the mirror TAP; `POST /v1/demo/warrant` is the warrant TAP; `POST /v1/demo/vacant` is the vacant TAP; `POST /v1/demo/badge` is the badge TAP; `POST /v1/demo/lid` is the lid TAP; `POST /v1/demo/bare` is the bare TAP; `POST /v1/demo/shelf` is the shelf TAP; `POST /v1/demo/hall` is the hall TAP; `POST /v1/demo/writ` is the writ TAP; `POST /v1/demo/crate` is the crate TAP; `POST /v1/demo/pact` is the pact TAP; `POST /v1/demo/root` is the root TAP; `POST /v1/demo/docket` is the docket TAP; `POST /v1/demo/graft` is the graft TAP; `POST /v1/demo/seal` is the seal TAP; `POST /v1/demo/guest` is the guest TAP; `POST /v1/demo/dust` is the dust TAP; `POST /v1/demo/thaw` is the thaw TAP; `POST /v1/demo/twin` is the twin TAP; `POST /v1/demo/fence` is the fence TAP; `POST /v1/demo/mute` is the mute TAP; `POST /v1/demo/nil` is the nil TAP; `POST /v1/demo/spark` is the spark TAP; `POST /v1/demo/wilt` is the wilt TAP; `POST /v1/demo/maker` is the maker TAP; `POST /v1/demo/ink` is the ink TAP; `POST /v1/demo/brim` is the brim TAP; `POST /v1/demo/swap` is the swap TAP; `POST /v1/demo/sour` is the sour TAP; `POST /v1/demo/cut` is the cut TAP; `POST /v1/demo/ice` is the ice TAP; `POST /v1/demo/rail` is the rail TAP; `POST /v1/demo/pen` is the pen TAP; `POST /v1/demo/well` is the well TAP; `POST /v1/demo/cite` is the cite TAP; `POST /v1/demo/lock` is the lock TAP; `POST /v1/demo/void` is the void TAP; `POST /v1/demo/fold` is the fold TAP; `POST /v1/demo/rip` is the rip TAP; `GET /v1/kya` lists genesis issuers; `POST /v1/clearing/windows` is the command bus; omit PAYMENT-SIGNATURE on ghost submit is hire.known 422, not a missing header; envelope.require is HTTP 402 with PAYMENT-REQUIRED; submit without the header still 200 + PAYMENT-RESPONSE |
| `openapi.test.ts` | OpenAPI advertises 200 for command allows, not 201 Created; hire.state and nonce reuse are 422, not 409; a host subscription whose slip died is expired; POST /v1/commands and hire/FX/transfer aliases; every HTTP TAP the discovery card names (sprint, night-watch, sub-hire, clearing, refund, replay, nonce, deny, recurrence, calendar, slot, daily, cart, velocity, door, match, room, conversion, pair, band, nest, heir, stock, purse, seat, cover, mint, payee, climb, born, reach, year, fuse, sku, priced, party, cash, stale, chain, arrow, wallet, name, pane, subject, paper, mix, rung, grade, cradle, ceiling, lapse, pause, mirror, warrant, vacant, badge, lid, bare, shelf, hall, writ, crate, pact, root, docket, graft, seal, guest, dust, thaw, twin, fence, mute, nil, spark, wilt, maker, ink, brim, swap, sour, cut, ice, rail, pen, well, cite, lock, void, fold, rip); HTTP aliases the bus actually serves (kya, circuit, freeze, rotate, agent-card, clearing windows); PAYMENT-SIGNATURE is optional; JSON body is the bus |
| `host-door.test.ts` | Public kernel needs no speaker proof; a hosted named speaker without a signature is 401 at the door; a priced host without a current invoice is 402 `host.unpaid`; invoicing is not a Command and not a spend gate; subscribe still does not gate hire; invoices restore from `world.json`; inspect of an `inv_` invoice labels `current` / `lapsed` without writing status into the store; MCP omit-actor cannot spend on a hosted operator; `PROTOCOL.hosted` stays false; `takeRate` is null |
| `kya.test.ts` | Nested hops; revoke cascades; unknown parent hop throws; unknown or foreign attestation throws; a second live pair throws; snapshot edges label expired hops `expired`, not `live`; revoked wins over expired; graph `attest()` still writes a nested hop under an expired parent (dispatch refuses); genesis stores four shape-only `iss_` issuers; restore without issuers synthesizes the catalog; a four-hop grantor chain reports depth 4 |
| `market.test.ts` | Catalog SKU deny; stale quote cannot be hired; audit.query by hire id; garbage role/decision/numeric agentId is `command.malformed`; a USD-only SKU quoted in USDC is `market.sku_currency`; `fxPairSettles` is the FX SKU priced in `from`; inviting a missing agent onto an RFQ is `identity.known`, not a closed room |
| `schema.test.ts` | Listed enums, integer ranges, JSON types, nested cart/constraint/FX fields, listed constraint value fields, unsafe integer cart/FX products, and mixed cart currencies in `commands.schema.json` are 400 at the shape gate |
| `fx.test.ts` | FX quote one-shot; research quote is not FX; hiring an FX window is `hire.not_fx` and does not consume or reserve the window; vendor without USD is `ledger.sufficient`; vendor without a USDC book is `ledger.known_account`; settling with no market maker is `mm.known`; an FX window with no nested rate is `command.malformed`; an off-band nested rate is `mm.spread_bound` even with an in-band decoy top-level `rateE6`; a research SKU wearing an FX window, a swapped pair, or a price in `to` is `market.fx_pair`; an FX SKU without a window is `market.fx_window`; quoting with `validUntil` already past or unparseable is `market.fx_fresh`, not a written corpse; settle of a window that lapses after mint is still `market.not_expired` |
| `world.test.ts` | Durable boot restores keys and audit head; settlement window restores; constructor `bilateralLimit` is not in `world.json`; old worlds without KYA issuers synthesize the genesis catalog |
| `clearing.test.ts` | Pair netting; bilateral wouldExceed; settleWindow archives legs; snapshot includes the instance cap |

Determinism: same fixture + frozen clock ⇒ bit-identical `payloadHash` sequence from seq 1 onward (seq 0 nonce is fixture-fixed).

---

## 8. Implementation order (so the demo is reachable)

1. `aether-kernel` (hash, JCS, Money, Clock, errors)
2. `aether-types` + JSON schemas
3. `aether-audit` + `aether-ledger` (can demo a balanced book with a chained log)
4. `aether-identity` + ladder table
5. `aether-mandate` verifyChain
6. `aether-policy` rule catalog + tests
7. `aether-escrow` + `aether-market`
8. `aether-envelope` + `aether-settlement`
9. `aether-runtime` dispatch
10. HTTP + MCP + `aether demo sprint-procurement`

The TAP demos exist. KYA issuers are genesis objects (`iss_`), shape-only. Further work is sequenced in [`docs/FOUNDATION.md`](docs/FOUNDATION.md). Do not add a UI. Do not add a live rail. Do not grind inspect overlays unless the pin would otherwise lie.

---

## 9. One-page mental model

```
 Human issues Intent (constraints)
        │
        ▼
 Agent RFQs vendors ──► Quotes
        │
        ▼
 Hire + Cart (merchant-bound) ──► PolicyEngine
        │                     deny → stop + trace
        │                     escalate → ApprovalTicket → human/treasury
        ▼                     allow
 PaymentMandate (hash-bound to cart)
        │
        ▼
 x402-shaped envelopes on sim:aether-1
        │
        ▼
 Facilitator posts balanced journal, escrow release
        │
        ▼
 Receipt.reference = hash(payment)     Audit.jsonl hash-chain += 2
        │
        ▼
 Auditor verifies chain; cannot spend
```

Aether’s product is **that loop**, not a marketplace and not a wallet.
