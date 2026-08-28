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

**IDs:** `aid_<ulid>` agents, `mid_<ulid>` mandates, `hid_<ulid>` hires, `tid_<ulid>` transfers, `rid_<ulid>` receipts, `apd_<ulid>` approvals, `jnl_<ulid>` journal entries, `rfq_<ulid>` RFQs, `qte_<ulid>` quotes, `dlg_<ulid>` KYA delegations, `win_<ulid>` settlement windows. ULID Crockford base32, 26 chars.

**Money:** integer **minor units** only. `USD_SIM` and `USDC_SIM` both have `decimals = 2`. Never use IEEE floats for amounts. JSON encodes `amount` as integer, `currency` as string.

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
    aether-mcp/                        # MCP server exposing Runtime commands
    aether-openapi/                    # generated OpenAPI 3.1 from schemas + route table
  apps/
    runtime-http/                      # Fastify. Serves OpenAPI. Same commands as MCP
    cli/                               # `aether demo`, `aether audit verify`, `aether ledger replay`
    fixtures/
      demo/sprint-procurement/           # human-in-the-loop shopping TAP
      demo/night-watch/                  # L5 standing mandate, KYA, circuit, freeze
      demo/sub-hire/                     # L4 nested slips, parent budget, child handshake
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
| `aether-identity` | `registerAgent`, `rotateKey`, `getAgent` | identity table in ledger store |
| `aether-mandate` | `issueIntent`, `issueCart`, `issuePayment`, `verifyChain` | mandate table |
| `aether-envelope` | `encodeRequired`, `encodePayload`, `encodeResponse`, header helpers | none |
| `aether-policy` | `evaluate(ctx) → PolicyDecision` | none |
| `aether-ledger` | `post(journal)`, `balance(accountId)`, `replay(jsonl)` | `data/ledger.jsonl` |
| `aether-audit` | `append(event)`, `verify(chain)`, `head()` | `data/audit.jsonl` |
| `aether-settlement` | `requirePayment`, `submitPayment`, `getReceipt` | via ledger + audit |
| `aether-escrow` | `createHire`, `acceptHire`, `fundHire`, `deliver`, `release`, `refund` | hire table + ledger |
| `aether-market` | `createRfq`, `submitQuote`, `acceptQuote` | rfq/quote tables |
| `aether-runtime` | `dispatch(command)` | `data/world.json` + orchestrates all |

### Transport map (one command bus, three faces)

Every mutating operation is a `Command` with a `commandType` string. HTTP, MCP, and CLI all construct the same command.

| Command | HTTP | MCP tool |
|---|---|---|
| `identity.register` | `POST /v1/identities` | `aether_identity_register` |
| `mandate.issue_intent` | `POST /v1/mandates/intent` | `aether_mandate_issue_intent` |
| `mandate.issue_cart` | `POST /v1/mandates/cart` | `aether_mandate_issue_cart` |
| `mandate.issue_payment` | `POST /v1/mandates/payment` | `aether_mandate_issue_payment` |
| `market.rfq` | `POST /v1/rfqs` | `aether_market_rfq` |
| `market.quote` | `POST /v1/quotes` | `aether_market_quote` |
| `hire.create` | `POST /v1/hires` | `aether_hire_create` |
| `hire.accept` | `POST /v1/hires/{id}/accept` | `aether_hire_accept` |
| `envelope.require` | `POST /v1/payments/require` → **HTTP 402** + `PAYMENT-REQUIRED` | `aether_payment_require` |
| `envelope.submit` | `POST /v1/payments/submit` + `PAYMENT-SIGNATURE` | `aether_payment_submit` |
| `approval.resolve` | `POST /v1/approvals/{id}/resolve` | `aether_approval_resolve` |
| `ladder.set` | `POST /v1/agents/{id}/autonomy` | `aether_ladder_set` |
| `ledger.balances` | `GET /v1/accounts/{id}` | `aether_ledger_balances` |
| `audit.verify` | `POST /v1/audit/verify` | `aether_audit_verify` |
| `receipt.get` | `GET /v1/receipts/{id}` | `aether_receipt_get` |

OpenAPI lives at `GET /openapi.json`. MCP tools use the JSON Schemas in `/schemas` as `inputSchema`.

Sim x402 headers (even on JSON body routes, so clients can practice the real handshake):

| Header | Direction | Body |
|---|---|---|
| `PAYMENT-REQUIRED` | server → client | Base64(JSON `PaymentRequired`) |
| `PAYMENT-SIGNATURE` | client → server | Base64(JSON `PaymentPayload`) |
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
  exp: number;
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
  iat: number;
  exp: number;
}

export interface Signed<T> {
  payload: T;
  issuer: `did:aether:${string}`;
  kid: string;
  alg: "EdDSA";
  jws: string;                      // compact JWS, payload is base64url(canonicalJson(T))
}
```

**Chain verification** (`aether-mandate.verifyChain`):

1. Verify each JWS against the issuer’s current `kid`.
2. `cart.intentHash === sha256(canonicalJson(intent.payload))`.
3. `payment.transaction_id === sha256(canonicalJson(cart.payload))`.
4. `payment.payee.id === cart.merchant.id`.
5. `payment.payment_amount` equals `cart.total` (amount **and** currency).
6. Every intent constraint evaluates true against the closed payment (see §3).
7. Reject if any `exp` / `expiresAt` ≤ clock.

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

RFQ `expiresAt` is 24h. Quote `expiresAt` is 1h. `hire.create` against a stale quote is `market.not_expired` deny. SKUs must be keys of `CATALOG` (`market.known_sku`). The catalog is not a storefront. Non-empty `invitedSellerIds` is a closed room (`market.invited_seller`); empty or omitted is an open RFQ. A quote or hire against an unknown RFQ/quote is `market.known_rfq` — not a missing SKU. `market.fx_settle` requires a live unused FX quote (`market.fx_quote`). A research quote is not FX. A spent FX quote is not a second window. `hire.create` consumes the quote (`hire.quote_unspent`); so does FX settle. A deny does not consume it. An escalate reserves it until the ticket is approved, rejected, or expired. A void does not restore it. A hireId that is not in this world is `hire.known` — not a broken mandate chain. An intentId that is not in this world is `mandate.known_intent` — not a missing handshake. A cartId that is not in this world is `mandate.known_cart` — not a broken payment chain. An approvalId that is not in this world is `approval.known` — not a late yes. An expired or already-resolved ticket is `approval.pending`. Accept, deliver, and payment-required belong to the seller; refund and release belong to the buyer or treasury (`hire.party`). A parentId that is not in this world is `mandate.known_parent` — not a tighter child. An agentId that is not in this world is `identity.known` — not a freeze, handshake, merchant, slip subject, or revoke target. Attesting yourself is `kya.not_self`. A KYA parentId that is not in this world is `kya.known_parent` — not a live nested hop. A KYA attestationId that is not in this world (or that belongs to another principal) is `kya.known_attestation` — not a silent tombstone. Revoke by principal+delegate with no id still kills implicit grants. An account name that is not in this world is `ledger.known_account` — not an allocation (and not a silent zero). One journal is one currency (`ledger.same_currency`); FX is a quote and a settle, not a transfer. A transfer cannot overdraw the source (`ledger.sufficient`). Neither can `hire.fund` — escrow cannot lock on empty operating cash. Neither can `market.fx_settle` on the vendor’s USD leg (`mm.inventory` is the market maker’s USDC). An illegal hire arrow is `hire.state` — not a 409 after an allow. Payment-required is only after deliver. An illegal ladder climb is `ladder.legal`. Required command-body fields from `schemas/commands.schema.json` are checked at dispatch before `evaluate()`; a miss is `command.malformed` (400), not a policy deny. So is a non-integer amount, a negative amount, or a currency that is not `USD_SIM` / `USDC_SIM`.

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

Opening journal: debit cash accounts, credit equity. Replay must balance.

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
  hirePartyOk?: boolean;            // false when the actor is not the hire counterparty
  parentKnown?: boolean;            // false when issue_intent.parentId is not in this world
  targetKnown?: boolean;            // false when freeze/ladder/attest/cart/intent names a missing agent
  ladderLegal?: boolean;            // false when ladder.set would skip a rung or skip a real freeze test
  kyaNotSelf?: boolean;             // false when kya.attest would make the grantor the delegate
  kyaParentKnown?: boolean;         // false when kya.attest.parentId is not in this world's graph
  kyaAttestationKnown?: boolean;    // false when kya.revoke.attestationId is missing or belongs to another principal
  accountsKnown?: boolean;          // false when ledger.transfer / named balances points at a missing book
  accountsSameCurrency?: boolean;   // false when a transfer would mix USD_SIM and USDC_SIM, or the label disagrees
  fundsOk?: boolean;                // false when a transfer, hire.fund, or fx_settle would overdraw the source book
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
| 03 | `mandate.chain_integrity` | any settle/fund | verifyChain fails | — | chain ok |
| 04 | `mandate.not_expired` | any mandate use | `exp`/`expiresAt` ≤ now | — | in window |
| 05 | `mandate.subject_is_actor` | settle | `intent.subjectId !== actor.id` | — | match |
| 06 | `payment.currency_match` | settle | cart/payment/amount currencies differ | — | match |
| 07 | `payment.amount_range` | settle if constraint present | amount outside `[min,max]` or currency mismatch | — | in range |
| 08 | `payment.budget` | settle if constraint present | `spentAgainstIntent + amount > max` | — | remaining ≥ amount |
| 09 | `payment.allowed_payees` | settle if constraint present | payee not in list | — | listed |
| 10 | `payment.allowed_skus` | settle/hire if constraint present | sku not listed | — | listed |
| 11 | `payment.recurrence` | hire.create / hire.fund if constraint present | `occurrenceCount >= max` or last fund inside the frequency gap (`DAILY` 24h, `WEEKLY` 7d, `MONTHLY` 30d). `ON_DEMAND` has no gap. Completing a funded hire is not a new occurrence. | — | under cap and past the gap |
| 12 | `payment.execution_date` | hire.create / hire.fund if constraint present | now outside `[not_before, not_after]`. Completing a funded hire is not a new spend. | — | in window |
| 13 | `ladder.min_level` | settle/hire/sub-intent | actor.level < required **and** no pending human signature path | actor.level < required **and** command is escalatable | level ≥ required |
| 14 | `ladder.max_autonomy_constraint` | settle if `aether.max_autonomy` present | actor.level > max (over-autonomy abuse) | — | actor.level ≤ max |
| 15 | `approval.threshold` | settle/fund | — | amount ≥ role threshold **and** level < 5 | below threshold or L5 with circuit intact |
| 16 | `velocity.window` | settle | — | `count > 20` or `volume > 2_000_000` in 3600s | under cap |
| 17 | `circuit.daily` | settle | `circuit.tripped` or `dailySpend + amount > dailyLimit` | — | under daily limit |
| 18 | `hire.escrow_required` | hire.accept / deliver | accept without escrow account; deliver while not `funded` | — | funded before work |
| 19 | `hire.no_self_deal` | hire.create | `buyerId === sellerId` | — | distinct |
| 20 | `counterparty.known` | hire/settle | payee/seller not in registry | — | registered |
| 21 | `instrument.sim_only` | settle | `payment_instrument.type !== "sim_ledger"` | — | sim |
| 22 | `idempotency.nonce` | submit payment | nonce seen | — | new nonce |
| 23 | `mm.spread_bound` | MM quote | `rateE6` outside `[980_000, 1_020_000]` (200 bps) | — | inside band |
| 24 | `mm.inventory` | MM accept FX | MM cash in `to` currency < payout | — | inventory exists |
| 25 | `audit.writable` | always (runtime injects) | audit head missing / verify dirty | — | chain healthy |
| 26 | `human.signature_present` | settle at L0/L1 | payment JWS issuer is not a `human_operator` supervisor | — | human signed |
| 27 | `clearing.bilateral_limit` | hire/settle when exposure snapshot present | projected gross > bilateral limit | — | inside limit |
| 28 | `kya.chain_intact` | spend / sub-intent / attest by an agent | no live path from principal, or revoke tombstone | — | live path, implicit supervisor, or not required |
| 29 | `kya.delegation_depth` | when a KYA path exists | hop count > 3 | — | depth ≤ 3 |
| 30 | `kya.principal_not_frozen` | KYA-gated spend | principal frozen (delegate keys still work) | — | principal active |
| 31 | `kya.attestation_fresh` | KYA-gated spend | path exists but expired | — | in window |
| 32 | `kya.capability_subset` | attest / spend | agent grants above own level, or acts above granted max | — | within grant |
| 33 | `mandate.child_tighter` | `mandate.issue_intent` with `parentId` | child amount_range / budget / SKUs / payees / max autonomy wider than parent | — | child is a subset |
| 34 | `payment.parent_budget` | spend against a child intent | `parentSpent + amount > parent budget` | — | parent remaining ≥ amount |
| 35 | `market.known_sku` | rfq / quote / hire.create | SKU not in `CATALOG` | — | listed |
| 36 | `market.not_expired` | quote / hire.create / fx_settle | RFQ, quote, or FX `validUntil` ≤ now | — | in window |
| 37 | `market.invited_seller` | quote / hire.create | seller not in `Rfq.invitedSellerIds` (when the list is non-empty) | — | invited, or open RFQ |
| 38 | `hire.cart_matches` | issue_cart (with hireId) / hire.fund / envelope.submit | cart total, seller, or SKU ≠ hire, or non-integer cents | — | cart equals hire |
| 39 | `market.known_rfq` | quote / hire.create | RFQ (or the quote’s RFQ) does not exist | — | room exists |
| 40 | `market.fx_quote` | fx_settle | quote missing, has no `fx`, already used, or reserved by an open hire ticket | — | live unused FX quote |
| 41 | `hire.quote_unspent` | hire.create | quote already produced a hire, an FX settle, or is reserved by an open approval | — | quote unused |
| 42 | `hire.known` | accept / fund / deliver / release / refund / envelope.* / issue_cart (with hireId) | hireId not in this world | — | hire exists |
| 43 | `mandate.known_intent` | hire.create / issue_cart | intentId not in this world | — | intent exists |
| 44 | `mandate.known_cart` | issue_payment | cartId not in this world | — | cart exists |
| 45 | `approval.known` | approval.resolve | approvalId not in this world | — | ticket exists |
| 46 | `approval.pending` | approval.resolve | ticket expired or already resolved | — | ticket pending |
| 47 | `hire.party` | accept / deliver / envelope.require / refund / release | actor is not the seller (accept/deliver/require) or not the buyer/treasury (refund/release) | — | right party |
| 48 | `mandate.known_parent` | issue_intent with parentId | parentId not in this world | — | parent exists |
| 49 | `identity.known` | freeze / unfreeze / ladder.set / kya.attest / kya.revoke / issue_cart / issue_intent | named agentId / delegateId / principalId / merchantId / subjectId not in this world | — | agent registered |
| 50 | `hire.state` | accept / fund / deliver / refund / release / envelope.submit / envelope.require | command is not a legal arrow from the hire’s current state; payment-required is only after deliver | — | legal transition |
| 51 | `ladder.legal` | ladder.set | skip a rung, omit a required gate, list `kill_switch_tested` without a freeze test, or wrong approver | — | legal climb (`any→L0` always) |
| 52 | `kya.not_self` | kya.attest | grantor would attest themselves | — | handshake with another agent |
| 53 | `kya.known_parent` | kya.attest with parentId | parentId not in this world’s graph | — | parent hop exists |
| 54 | `ledger.known_account` | ledger.transfer / named ledger.balances | fromAccount, toAccount, name, or accountId is not in this world | — | book exists |
| 55 | `ledger.same_currency` | ledger.transfer | the two books disagree, or the stated amount currency disagrees with the books | — | one currency (`market.fx_settle` to convert) |
| 56 | `ledger.sufficient` | ledger.transfer / hire.fund / market.fx_settle | source book (transfer fromAccount, buyer cash at fund, or vendor USD at FX settle) balance < amount | — | source covers the cents (zero is legal) |
| 57 | `kya.known_attestation` | kya.revoke with attestationId | attestationId not in this world’s graph, or belongs to a different principal | — | handshake exists for this principal |

L5 does **not** skip `payment.*` constraints, `circuit.daily`, `actor.not_frozen`, `kya.*`, or `idempotency.nonce`. It only skips `approval.threshold` and `ladder.min_level` escalations.

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

**Escalation object:** on `escalate`, runtime writes `ApprovalTicket` with `commandHash = sha256(JCS(command))`. A pending `hire.create` ticket holds the quote (`hire.quote_unspent`) until approved, rejected, or expired. Resolver must replay the **same** command bytes. Mutation proceeds only after `status=approved` and re-evaluation returns `allow`. A missing ticket is `approval.known`. Tickets past `expiresAt` or already resolved are `approval.pending`; resolve is a policy deny, not a late yes; the original command may be retried (new ticket) and the quote is free again. Inspect any id with `Runtime.inspect` / `GET /v1/objects/:id` / MCP `aether_get`. Command bodies: `schemas/commands.schema.json` (required fields enforced at dispatch).

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
7. **Silent retries that re-spend.** Nonce table is durable. `idempotency.nonce` is deny, not “best effort.” Command-level idempotency caches **allow/escalate only**. A deny is never a cached success.
8. **Mutable audit or ledger history.** Corrections are reversing journal entries + new audit lines.
9. **Autonomy L5 as ‘god mode’.** L5 skips *humans*, not constraints, circuits, or freezes.
10. **Generic multi-agent chat framework.** No mailbox product. Messages that are not commands/quotes/receipts do not belong here.

**Build later (explicitly out of v0):** real HTTP-signature adapters, SD-JWT selective disclosure, travel-rule payloads, multi-currency books with 18-decimal tokens, compaction snapshots, distributed consensus.

---

## 6. Runtime dispatch contract

```ts
async function dispatch(cmd: Command): Promise<Result<CommandResult>> {
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

`422` = policy deny. `402` = payment required (envelope.require). `409` = mutate backstop (illegal hire arrow that policy missed, or nonce reuse). Illegal hire arrows are `hire.state` (422) first.

---

## 7. Test plan an implementer must land with v0

| Test file | Must prove |
|---|---|
| `audit.test.ts` | Tamper a JSONL byte → verify fails at that seq; reorder fails; genesis prevHash is zeros |
| `ledger.test.ts` | Unbalanced journal rejected; replay file ≡ memory; FX keeps two books |
| `mandate.test.ts` | Wrong cart hash / swapped payee / amount mismatch denied |
| `policy.test.ts` | Table-driven: each ruleId has allow + deny fixtures |
| `ladder.test.ts` | Skip 2→4 is `ladder.legal`; L5 before freeze test is `ladder.legal`; freeze restores the prior rung |
| `hire.test.ts` | deliver before funded denied; self-deal denied; illegal arrows and payment-required before deliver are `hire.state`; funding without cash is `ledger.sufficient` |
| `envelope.test.ts` | 402 header round-trip; nonce reuse denied |
| `demo.test.ts` | Sprint Procurement assertions above |
| `night-watch.test.ts` | KYA, L5, sticky circuit, freeze principal, revoke |
| `mcp.test.ts` | Sub-hire TAP + MCP `tools/list` + `identity.register` replay + `aether_hire_refund` |
| `operator.test.ts` | Register/hire/refund retries replay; denies not cached; refund restores cash; durable idempotency; `SIM_RAIL.live === false`; ghost book is `ledger.known_account`; mixed-currency transfer is `ledger.same_currency`; overdraft is `ledger.sufficient` |
| `inspect.test.ts` | `aether_get` / inspect by id; MCP command schemas; expired approval tickets refuse resolve |
| `identity.test.ts` | Ghost freeze / handshake principal / revoke is `identity.known`; attesting yourself is `kya.not_self`; nested handshake with a ghost parent is `kya.known_parent`; ghost or foreign attestationId revoke is `kya.known_attestation` |
| `kya.test.ts` | Nested hops; revoke cascades; unknown parent hop throws; unknown or foreign attestation throws |
| `market.test.ts` | Catalog SKU deny; stale quote cannot be hired; audit.query by hire id |
| `fx.test.ts` | FX quote one-shot; research quote is not FX; reserved hire ticket holds the window; vendor without USD is `ledger.sufficient` |
| `world.test.ts` | Durable boot restores keys and audit head; settlement window restores |

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

Stop after step 10. Do not add a UI. Do not add a live rail.

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
