/**
 * Aether canonical object model.
 * If DESIGN.md and these types disagree, these types win.
 *
 * Money is always integer minor units. Never IEEE floats.
 * Instant is ISO-8601 milliseconds with Z.
 * HexSha256 is 64 lowercase hex chars.
 */

export type CurrencyCode = "USD_SIM" | "USDC_SIM";
export type Instant = string;
export type HexSha256 = string;
export type Ulid = string;

export const CURRENCY_DECIMALS: Record<CurrencyCode, 2> = {
  USD_SIM: 2,
  USDC_SIM: 2,
};

export const SIM_RAIL_ID = "sim:aether-1" as const;
export const AUDIT_DOMAIN = "aether-audit-v1" as const;
export const AUDIT_GENESIS_PREV = "0".repeat(64);
export const RECEIPT_ISSUER = "did:aether:runtime" as const;

/**
 * Pin this. Further protocol bumps are not the default.
 * `liveMoney: false` until adapters exist. Public protocol ≠ live bank.
 */
export const PROTOCOL = {
  spec: "aether.protocol.1",
  version: "0.96.0",
  rail: SIM_RAIL_ID,
  liveMoney: false,
  /** `evaluate()` is deterministic. An LLM does not sit in the referee. */
  evaluateLlm: false,
  /**
   * This public kernel is not a paid operator. Self-host is free.
   * A process may construct `Runtime({ hosted: true })` (or `AETHER_HOSTED=true`).
   * That instance records `host.subscribe`. This pin stays false. GitHub is not a checkout.
   */
  hosted: false,
  currencies: ["USD_SIM", "USDC_SIM"] as const,
  /** Shape-only. Credentials never enter `evaluate()`. */
  adapters: { ap2: "shape", x402: "shape", mpp: "shape" } as const,
} as const;

export interface Money {
  /** Integer minor units. */
  amount: number;
  currency: CurrencyCode;
}

export interface Rail {
  id: typeof SIM_RAIL_ID;
  scheme: "exact" | "upto";
  asset: CurrencyCode;
}

export type Result<T, E = AetherError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface AetherError {
  type: `https://aether.dev/errors/${string}`;
  title: string;
  status: 400 | 401 | 403 | 402 | 409 | 422 | 500;
  detail: string;
  instance: string;
  extra?: { ruleId?: string; seq?: number; remediation?: Remediation };
}

// ---------------------------------------------------------------------------
// Identity + autonomy ladder
// ---------------------------------------------------------------------------

export type AgentRole =
  | "treasury"
  | "procurement"
  | "data_vendor"
  | "compute_vendor"
  | "market_maker"
  | "auditor"
  | "human_operator";

/**
 * L0 human-executes     — agent drafts; human signs every payment mandate
 * L1 human-approves     — agent issues carts; human confirms each cart
 * L2 constrained-auto   — close payments that satisfy an open intent
 * L3 budget-auto        — L2 + recurrence / remaining-budget
 * L4 delegated-hire     — L3 + sub-intents (delegate budget). Vendor hires against an existing intent are L3.
 * L5 human-out-of-loop  — L4 + standing mandate; humans hold kill switch
 */
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface PublicKeyRef {
  kid: string;
  kty: "OKP";
  crv: "Ed25519";
  x: string;
}

export type AgentId = `aid_${Ulid}`;
export type AccountId = `acct_${Ulid}`;
export type MandateId = `mid_${Ulid}`;
export type WindowId = `win_${Ulid}`;
export type HireId = `hid_${Ulid}`;
export type TransferId = `tid_${Ulid}`;
export type ReceiptId = `rid_${Ulid}`;
export type ApprovalId = `apd_${Ulid}`;
export type JournalId = `jnl_${Ulid}`;
export type RfqId = `rfq_${Ulid}`;
export type QuoteId = `qte_${Ulid}`;
export type DelegationId = `dlg_${Ulid}`;
export type IssuerId = `iss_${Ulid}`;
export type SubscriptionId = `hsb_${Ulid}`;
export type Did = `did:aether:${string}`;

export interface Agent {
  id: AgentId;
  did: Did;
  displayName: string;
  role: AgentRole;
  autonomyLevel: AutonomyLevel;
  keys: PublicKeyRef[];
  accountId: AccountId;
  supervisors: AgentId[];
  createdAt: Instant;
  frozen: boolean;
  /** Captured on freeze so unfreeze restores the rung, not a silent demotion. */
  autonomyBeforeFreeze?: AutonomyLevel;
}

export type LadderExtraGate =
  | "auditor_ack"
  | "clean_audit_7d"
  | "circuit_breaker_configured"
  | "kill_switch_tested";

export interface LadderTransition {
  from: AutonomyLevel;
  to: AutonomyLevel;
  requiredApproverRoles: AgentRole[];
  extraGates: LadderExtraGate[];
}

/** Illegal to skip rungs. any→0 is always allowed (kill / demote). */
export const LADDER_TRANSITIONS: readonly LadderTransition[] = [
  { from: 0, to: 1, requiredApproverRoles: ["human_operator"], extraGates: [] },
  { from: 1, to: 2, requiredApproverRoles: ["human_operator"], extraGates: ["auditor_ack"] },
  { from: 2, to: 3, requiredApproverRoles: ["human_operator"], extraGates: ["clean_audit_7d"] },
  { from: 3, to: 4, requiredApproverRoles: ["human_operator", "treasury"], extraGates: [] },
  { from: 4, to: 5, requiredApproverRoles: ["human_operator", "treasury"], extraGates: ["circuit_breaker_configured", "kill_switch_tested"] },
];

export const MIN_LEVEL_FOR_ACTION = {
  draft: 0,
  closePaymentWithHuman: 0,
  closePaymentAutonomous: 2,
  /** L3 may hire a vendor against an existing intent (demo: procurement). */
  hireAgainstIntent: 3,
  recurringPayment: 3,
  /** L4 issues a *sub-intent* that delegates budget to another agent. */
  issueSubIntent: 4,
  autoAcceptHire: 5,
} as const satisfies Record<string, AutonomyLevel>;

// ---------------------------------------------------------------------------
// Mandates (AP2-shaped, Aether-namespaced)
// ---------------------------------------------------------------------------

export type MandateVct =
  | "aether.mandate.intent.open.1"
  | "aether.mandate.intent.1"
  | "aether.mandate.cart.1"
  | "aether.mandate.payment.open.1"
  | "aether.mandate.payment.1";

export interface Merchant {
  id: AgentId;
  name: string;
  website: string;
}

export interface PaymentInstrument {
  id: string;
  type: "sim_ledger";
  description: string;
}

/** The only instrument `mutPayment` stamps. A listed constraint that omits this id cannot spend. */
export const SIM_LEDGER_INSTRUMENT_ID = "sim-ledger";
export const SIM_INSTRUMENT: PaymentInstrument = {
  id: SIM_LEDGER_INSTRUMENT_ID,
  type: "sim_ledger",
  description: "Aether simulated double-entry ledger",
};

export interface LineItem {
  sku: string;
  description: string;
  quantity: number;
  unitAmount: Money;
}

export type RecurrenceFrequency = "ON_DEMAND" | "DAILY" | "WEEKLY" | "MONTHLY";

/** One day in milliseconds. ISO `expiresAt` windows (cart, RFQ, approval ticket). */
export const DAY_MS = 86_400_000;
/** One day in unix seconds. Mandate `iat`/`exp` are seconds, not milliseconds. */
export const DAY_SEC = 86_400;
/** One hour in milliseconds. Quote `expiresAt`. */
export const HOUR_MS = 3_600_000;
/** One year in milliseconds. KYA hop omit and ceiling (`kya.mint_window`). */
export const KYA_TTL_MS = 365 * DAY_MS;
/** Seven days in unix seconds. Intent mandate `exp` from `iat`. */
export const INTENT_TTL_SEC = 7 * DAY_SEC;
/** Seven days in milliseconds. Execution windows must open before the slip dies. */
export const INTENT_TTL_MS = 7 * DAY_MS;

/** Minimum gap between funded occurrences. `ON_DEMAND` has no gap. Monthly is 30 × 24h on the sim clock. */
export const RECURRENCE_GAP_MS: Record<RecurrenceFrequency, number> = {
  ON_DEMAND: 0,
  DAILY: DAY_MS,
  WEEKLY: 7 * DAY_MS,
  MONTHLY: 30 * DAY_MS,
};

export type MandateConstraint =
  | {
      type: "payment.amount_range";
      currency: CurrencyCode;
      /** Omit is an open floor. min === max still mints. min > max is mandate.range_fresh. */
      min?: number;
      max: number;
    }
  | {
      type: "payment.budget";
      currency: CurrencyCode;
      /** Remaining computed at eval. max ≤ 0, or max below an amount_range floor, is mandate.budget_fresh. */
      max: number;
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
      frequency: RecurrenceFrequency;
      max_occurrences?: number;
    }
  | {
      type: "payment.execution_date";
      not_before?: Instant;
      not_after?: Instant;
    }
  | {
      type: "payment.reference";
      conditional_transaction_id: HexSha256;
    }
  | {
      type: "aether.allowed_skus";
      allowed: string[];
    }
  | {
      type: "aether.max_autonomy";
      max: AutonomyLevel;
    };

/** Closed catalog. An unknown `type` is syntax, not a silent no-op constraint. */
export const MANDATE_CONSTRAINT_TYPES = [
  "payment.amount_range",
  "payment.budget",
  "payment.allowed_payees",
  "payment.allowed_payment_instruments",
  "payment.agent_recurrence",
  "payment.execution_date",
  "payment.reference",
  "aether.allowed_skus",
  "aether.max_autonomy",
] as const satisfies ReadonlyArray<MandateConstraint["type"]>;

export interface IntentMandate {
  vct: "aether.mandate.intent.open.1" | "aether.mandate.intent.1";
  id: MandateId;
  issuerId: AgentId;
  subjectId: AgentId;
  task: string;
  constraints: MandateConstraint[];
  /** Parent intent when an L4+ agent hands a smaller slip to another agent. */
  parentId?: MandateId;
  iat: number;
  /** Unix seconds. Seven days from `iat`. Not milliseconds. */
  exp: number;
}

/**
 * Inspect / snapshot view. Funded (escrow moved against this slip, including
 * later refund/release) wins over expired. Expired includes the slip `exp` and a
 * dead parent intent, even when this child's own window still lives. A child
 * hire does not occupy the parent. Recurrence `spentByIntent` is not occupancy.
 * The store stays raw (`exp` only). Revoked (torn by mandate.revoke) wins over
 * expired. Funded wins over revoked and expired.
 */
export type IntentStatus = "live" | "expired" | "funded" | "revoked";

export interface CartMandate {
  vct: "aether.mandate.cart.1";
  id: MandateId;
  intentId: MandateId;
  intentHash: HexSha256;
  merchant: Merchant;
  line_items: LineItem[];
  total: Money;
  expiresAt: Instant;
  userConfirmationRequired: boolean;
}

/**
 * Inspect / snapshot view. Bound (unique_payment occupies) wins over revoked
 * and expired. Revoked (torn by mandate.revoke_cart) wins over expired.
 * A hire that points at this cart is not bound — that occupancy lives on the hire.
 * The store stays raw (`expiresAt` only).
 */
export type CartStatus = "live" | "expired" | "bound" | "revoked";

/**
 * Inspect / snapshot view. Funded (escrow moved, including later refund/release)
 * wins over expired. Expired includes the payment `exp` and a dead parent cart
 * (`expiresAt`), even when this check's own window still lives. A cart that this
 * payment occupies is not funded — that occupancy lives on the cart
 * (`mandate.unique_payment` / bound). Revoked (torn by mandate.revoke_payment)
 * wins over expired. Funded wins over revoked and expired. The store stays raw
 * (`exp` only).
 */
export type PaymentStatus = "live" | "expired" | "funded" | "revoked";

export interface PaymentMandate {
  vct: "aether.mandate.payment.1" | "aether.mandate.payment.open.1";
  id: MandateId;
  /** sha256(canonicalJson(cart.payload)) — AP2 checkout-hash role. */
  transaction_id: HexSha256;
  payee: Merchant;
  payment_amount: { amount: number; currency: CurrencyCode };
  payment_instrument: PaymentInstrument;
  execution_date?: Instant;
  iat: number;
  /** Unix seconds. One day from `iat`, matching the cart window. Not milliseconds. */
  exp: number;
}

export interface Signed<T> {
  payload: T;
  issuer: Did;
  kid: string;
  alg: "EdDSA";
  jws: string;
}

// ---------------------------------------------------------------------------
// x402-shaped envelopes
// ---------------------------------------------------------------------------

export interface PaymentResource {
  url: string;
  description: string;
  mimeType: "application/json";
}

export interface AcceptedPayment {
  scheme: "exact" | "upto";
  network: typeof SIM_RAIL_ID;
  amount: string;
  asset: CurrencyCode;
  payTo: AccountId;
  maxTimeoutSeconds: number;
  extra?: {
    hireId?: HireId;
    cartId?: MandateId;
    paymentMandateId?: MandateId;
  };
}

export interface PaymentRequired {
  x402Version: 2;
  resource: PaymentResource;
  accepted: AcceptedPayment[];
}

export interface PaymentPayloadInner {
  payerAccountId: AccountId;
  paymentMandateId: MandateId;
  nonce: string;
  authorizedAmount: string;
  asset: CurrencyCode;
  validBefore: Instant;
  /** Ed25519 over canonicalJson of this object without `signature`. */
  signature: string;
}

export interface PaymentPayload {
  x402Version: 2;
  scheme: "exact" | "upto";
  network: typeof SIM_RAIL_ID;
  payload: PaymentPayloadInner;
}

export interface SettlementResponse {
  success: boolean;
  transaction: TransferId | null;
  network: typeof SIM_RAIL_ID;
  payer: AccountId | null;
  errorReason?: string;
  receiptId?: ReceiptId;
}

export const X402_HEADERS = {
  required: "PAYMENT-REQUIRED",
  signature: "PAYMENT-SIGNATURE",
  response: "PAYMENT-RESPONSE",
} as const;

// ---------------------------------------------------------------------------
// Market + hire
// ---------------------------------------------------------------------------

export type HireState =
  | "offered"
  | "accepted"
  | "funded"
  | "delivered"
  | "released"
  | "refunded"
  | "void";

export const HIRE_TRANSITIONS: Readonly<Record<HireState, readonly HireState[]>> = {
  offered: ["accepted", "void"],
  accepted: ["funded", "void"],
  funded: ["delivered", "refunded"],
  delivered: ["released"],
  released: [],
  refunded: [],
  void: [],
};

/** Commands that walk the hire. Absent from this table = not a transition command. */
export const HIRE_COMMAND_TARGET = {
  "hire.accept": "accepted",
  "hire.fund": "funded",
  "hire.deliver": "delivered",
  "hire.refund": "refunded",
  "hire.release": "released",
  "hire.void": "void",
  "envelope.submit": "released",
} as const satisfies Record<string, HireState>;

/** Commands that do not walk the hire but are only legal in one state. */
export const HIRE_COMMAND_REQUIRED_STATE = {
  "envelope.require": "delivered",
} as const satisfies Record<string, HireState>;

/**
 * Inspect / snapshot view. Funded (escrow moved, including later refund/release/deliver)
 * wins over expired. Expired includes a dead intent and a dead parent intent even when
 * this child's `exp` still lives. `void` is not a live offer. The store stays raw
 * (`state` only). Fund of an unpaid expired offer still names `mandate.not_expired`
 * or `mandate.parent_fresh`. Completing a funded hire after that window is legal.
 */
export type HireStatus = "live" | "expired" | "funded";

export interface HireContract {
  id: HireId;
  buyerId: AgentId;
  sellerId: AgentId;
  sku: string;
  spec: string;
  price: Money;
  /** Current lifecycle state. Illegal arrows are `hire.state`, not a mutate throw. */
  state: HireState;
  rfqId: RfqId;
  quoteId: QuoteId;
  intentId: MandateId;
  cartId?: MandateId;
  escrowAccountId: AccountId;
  deliverableHash?: HexSha256;
  createdAt: Instant;
}

export interface Rfq {
  id: RfqId;
  buyerId: AgentId;
  sku: string;
  spec: string;
  invitedSellerIds: AgentId[];
  expiresAt: Instant;
}

/**
 * Inspect / snapshot view. A room past `expiresAt` is `expired`, not `live`.
 * Closed (torn by market.close) wins over expired. The store stays raw
 * (`expiresAt` only). Quoting or hiring a shut room still names `market.not_expired`.
 */
export type RfqStatus = "live" | "expired" | "closed";

export interface Quote {
  id: QuoteId;
  rfqId: RfqId;
  sellerId: AgentId;
  price: Money;
  fx?: {
    from: CurrencyCode;
    to: CurrencyCode;
    /** `to_minor = floor(from_minor * rateE6 / 1_000_000)` */
    rateE6: number;
    validUntil: Instant;
  };
  expiresAt: Instant;
}

/**
 * Inspect / snapshot view. Spent and held win over withdrawn and expired.
 * Withdrawn wins over expired. Expired includes the quote envelope, a lapsed FX
 * `validUntil`, and (for a hire quote) a dead parent RFQ. An FX quote is a window
 * on the quote, not the room — RFQ death does not expire it. The store stays raw.
 */
export type QuoteStatus = "live" | "expired" | "spent" | "held" | "withdrawn";

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  id: AccountId;
  ownerId: AgentId | "system";
  name: string;
  type: AccountType;
  currency: CurrencyCode;
}

export interface JournalLine {
  accountId: AccountId;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: JournalId;
  timestamp: Instant;
  description: string;
  hireId?: HireId;
  paymentMandateId?: MandateId;
  lines: JournalLine[];
}

export interface LedgerSnapshot {
  accounts: Account[];
  entries: JournalEntry[];
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type Verdict = "allow" | "deny" | "escalate";

export type RemediationKind =
  | "issue_intent"
  | "reset_circuit"
  | "unfreeze_actor"
  | "unfreeze_principal"
  | "attest_kya"
  | "wait_approval"
  | "role_forbidden"
  | "none";

export interface RuleVerdict {
  ruleId: string;
  verdict: Verdict;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface PolicyDecision {
  verdict: Verdict;
  trace: RuleVerdict[];
  approvalId?: ApprovalId;
  remediation?: Remediation;
}

export interface ApprovalTicket {
  id: ApprovalId;
  createdAt: Instant;
  expiresAt: Instant;
  commandType: string;
  commandHash: HexSha256;
  reason: string;
  ruleIds: string[];
  requiredApproverRoles: AgentRole[];
  /**
   * Store is pending | approved | rejected | expired.
   * Inspect/snapshot may overlay `expired` (clock) or `stale` (paused command
   * would not allow). Stale is never written to the store.
   */
  status: "pending" | "approved" | "rejected" | "expired" | "stale";
  resolvedBy?: AgentId;
  resolvedAt?: Instant;
}

export interface VelocityWindow {
  windowSeconds: number;
  count: number;
  volume: number;
}

export interface CircuitState {
  dailySpend: number;
  dailyLimit: number;
  tripped: boolean;
}

export interface SettlementWindow {
  id: WindowId;
  currency: CurrencyCode;
  at: Instant;
  nets: Array<{ from: AgentId; to: AgentId; currency: CurrencyCode; net: number }>;
  legsConsumed: number;
  grossVolume: number;
  netVolume: number;
}

// ---------------------------------------------------------------------------
// KYA — Know Your Agent (runtime graph the kernel consults)
// ---------------------------------------------------------------------------

export type KyaIssuerKind = "aether.self" | "tap.http-sig" | "skyfire.kya" | "erc8004.agent";

/**
 * Shape-only issuer the kernel stores. Not a live TAP/Skyfire/chain call.
 * Credentials never enter `evaluate()`. `live` stays false on this pin.
 */
export interface KyaIssuer {
  id: IssuerId;
  vct: "aether.kya.issuer.1";
  kind: KyaIssuerKind;
  label: string;
  adapter: "shape";
  live: false;
  createdAt: Instant;
}

export const KYA_MAX_DEPTH = 3;

export interface DelegationAttestation {
  id: DelegationId;
  vct: "aether.kya.delegation.1";
  issuerKind: KyaIssuerKind;
  /** Genesis issuer object this hop pins. Optional so 0.96 worlds without the catalog still boot. */
  issuerId?: IssuerId;
  /** Money owner at the root of this chain. */
  principalId: AgentId;
  /** Who signed this hop. */
  grantorId: AgentId;
  delegateId: AgentId;
  parentId?: DelegationId;
  maxAutonomy: AutonomyLevel;
  maxDepth: number;
  createdAt: Instant;
  expiresAt: Instant;
  revokedAt?: Instant;
}

/** Graph and inspect view. Revoked wins over expired. The store stays raw. */
export type KyaHopStatus = "live" | "expired" | "revoked";

export interface KyaResolution {
  required: boolean;
  pathOk: boolean;
  implicit: boolean;
  depth: number;
  maxDepth: number;
  /**
   * On `kya.attest`, omitted `principalId` is the speaker (`actor.id`), not the
   * supervisor. Spend commands still resolve from the intent issuer.
   */
  principalId?: AgentId;
  principalFrozen: boolean;
  expired: boolean;
  revoked: boolean;
  grantedMaxAutonomy?: AutonomyLevel;
  /**
   * Ceiling this attest would write. Omitted `maxAutonomy` is 5 (standing mandate).
   * An agent may not propose above its own rung (`kya.capability_subset`).
   * Humans and treasury may grant L5. Absent = not an attest, or an earlier
   * refuse (`kya.unique_live` / `kya.party` / `kya.not_self`) keeps first deny.
   */
  proposedMaxAutonomy?: AutonomyLevel;
  hops: DelegationAttestation[];
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
  payeeId?: AgentId;
  spentAgainstIntent: number;
  occurrenceCount: number;
  /** Instant of the last funded occurrence under this intent. Absent = never spent. */
  lastOccurrenceAt?: Instant;
  velocity: VelocityWindow;
  circuit: CircuitState;
  /** Market-maker FX rate in millionths. Absent unless quoting/settling FX. */
  fxRateE6?: number;
  /**
   * True when envelope.submit’s nonce was already settled.
   * Absent = not a payment submit, or the body omitted nonce (mutate mints one).
   * A leftover `nonce` on another verb is not this flag.
   */
  nonceSeen?: boolean;
  /** False when MM cannot pay the `to` currency. */
  mmInventoryOk?: boolean;
  /**
   * False when `market.fx_settle` would journal against a world with no market maker
   * (or missing `market_maker:cash_usd` / `market_maker:cash_usdc` books).
   * Absent = not a live FX settle (`market.fx_quote` handles missing/non-FX/spent quotes).
   * A window is not a journal against nobody.
   */
  mmKnown?: boolean;
  /** False when the audit chain fails verify(). */
  auditHealthy?: boolean;
  /** False when verifyChain failed for the attached mandate triple. */
  chainOk?: boolean;
  /** True when replaying a command after a matching ApprovalTicket. Waives threshold and the hire/settle rung, not caps. */
  thresholdWaived?: boolean;
  /** Current + this command’s amount vs bilateral exposure limit. */
  projectedExposure?: number;
  exposureLimit?: number;
  /** Know-Your-Agent resolution. Absent means the command is not KYA-gated. */
  kya?: KyaResolution;
  /** Parent intent when spending against a sub-slip, or when issuing one. */
  parentIntent?: Signed<IntentMandate>;
  parentSpent?: number;
  parentOccurrenceCount?: number;
  parentLastOccurrenceAt?: Instant;
  /** Child constraints when issuing a sub-intent. */
  proposedConstraints?: MandateConstraint[];
  /** False when SKU is not in the market catalog. Absent = command is not catalog-gated. */
  skuListed?: boolean;
  /**
   * False when a quote or hire.create prices a listed SKU in a currency the catalog
   * does not list for that SKU. Absent = not a priced catalog command, or the SKU/RFQ
   * is unknown (`market.known_sku` / `market.known_rfq` handle those).
   * Research is USD_SIM. Convert with `market.fx_settle`.
   */
  skuCurrencyOk?: boolean;
  /** False when RFQ/quote/FX window is past expiresAt. Absent = not a market-time command. */
  marketFresh?: boolean;
  /**
   * False when the quoting/hired seller is not on `Rfq.invitedSellerIds`.
   * Absent = command is not invite-gated. Empty invite list is an open RFQ (true).
   */
  sellerInvited?: boolean;
  /**
   * False when a cart bound to a hire disagrees with that hire (price, seller, SKU, or non-integer cents).
   * Absent = command is not cart-gated.
   */
  cartMatchesHire?: boolean;
  /** False when the RFQ (or the quote’s RFQ) does not exist. Absent = not an RFQ-gated command. */
  rfqKnown?: boolean;
  /**
   * False when `market.fx_settle` has no quote, a non-FX quote, a spent quote, or a quote held by an open hire ticket.
   * Absent = not an FX-settle command. An FX quote is a one-shot window.
   */
  fxQuoteLive?: boolean;
  /**
   * False when an FX window is on the wrong SKU, the price is not in `from`,
   * or `from`/`to` is not USD_SIM → USDC_SIM (the pair this rail actually journals).
   * Absent = not a quote/settle with an FX window, or the quote is not a live FX window
   * (`market.fx_quote` / `market.known_rfq` handle those).
   */
  fxPairOk?: boolean;
  /**
   * False when `hire.create` would treat an FX window (`quote.fx`) or an FX SKU as a hireable good.
   * Absent = not a hire.create, or the quote/RFQ is unknown (`rfqKnown` handles that).
   * FX windows settle (`market.fx_settle`). They are not hires.
   */
  hireNotFx?: boolean;
  /**
   * False when `market.quote` prices an FX SKU without an `fx` window.
   * Absent = not quoting a listed FX SKU (`market.known_sku` / `market.known_rfq` handle those).
   * An FX SKU is a conversion window, not a good.
   */
  fxWindowOk?: boolean;
  /**
   * False when `market.quote` would write an FX `validUntil` ≤ now (or unparseable).
   * Absent = not quoting with an `fx` object. A missing window stays `market.fx_window`.
   * Settle of a window that lapses after mint still names `market.not_expired`.
   * Ghost RFQ stays `market.known_rfq`. A swapped pair stays `market.fx_pair`.
   */
  fxMintFresh?: boolean;
  /**
   * False when `market.quote` would write an FX window whose floor payout is 0
   * (`floor(from * rateE6 / 1e6)`). Absent = not quoting with an `fx` object, or
   * amount/rate missing (shape / other first denies). A 200bps miss stays
   * `mm.spread_bound`. A dead window stays `market.fx_fresh`. A swapped pair
   * stays `market.fx_pair`. A missing window stays `market.fx_window`. Ghost RFQ
   * stays `market.known_rfq`. Pip TAP is a conversion that pays nothing.
   */
  fxPayoutOk?: boolean;
  /**
   * False when `market.quote` would write an FX window as a non-maker while a
   * `market_maker` already sits. Absent = not quoting with an `fx` object.
   * A research quote with no `fx` is not this deny. Quoting FX with no maker
   * on the pit is not this deny (Maker TAP still mints; settle stays `mm.known`).
   * A closed guest list stays `market.invited_seller`. A 200bps miss stays
   * `mm.spread_bound`. A conversion that pays nothing stays `market.payout_fresh`.
   * A dead window stays `market.fx_fresh`. A swapped pair stays `market.fx_pair`.
   * A missing window stays `market.fx_window`. Ghost RFQ stays `market.known_rfq`.
   * Quoin TAP is a vendor's conversion while a maker sits.
   */
  fxPartyOk?: boolean;
  /**
   * False when `market.quote` would write an FX window whose nested `rateE6`
   * sits outside the 200bps band (980000–1020000). Absent = not quoting with
   * an `fx` object, or rate missing (shape / other first denies). A maker's
   * own off-band quote stays `mm.spread_bound`. A vendor conversion while a
   * maker sits stays `market.fx_party`. A conversion that pays nothing stays
   * `market.payout_fresh`. A dead window stays `market.fx_fresh`. A swapped
   * pair stays `market.fx_pair`. A missing window stays `market.fx_window`.
   * Ghost RFQ stays `market.known_rfq`. Ashlar TAP is an empty pit that does
   * not waive the band.
   */
  fxBandOk?: boolean;
  /**
   * False when `hire.create` or `market.withdraw` would reuse a quote that already
   * produced a hire, an FX settle, or is held by an open approval ticket.
   * Absent = not those commands, or the quote/RFQ is unknown (`rfqKnown` handles that).
   * A deny does not consume the quote. An escalate *reserves* it until
   * the ticket is approved, rejected, or expired. A void/refund/withdraw of a spent
   * quote does not restore it. A folded live quote is `market.not_expired`, not this flag.
   */
  quoteUnspent?: boolean;
  /**
   * False when a hireId command points at a hire that is not in this world.
   * Absent = command does not require a live hire (`hire.create` uses a draft).
   */
  hireKnown?: boolean;
  /**
   * False when hire.create, issue_cart, mandate.revoke, or hosted `host.subscribe`
   * points at an intent that is not in this world. Absent = command does not require a live intent.
   * Public-kernel subscribe does not set this — that deny is `host.not_hosted`.
   */
  intentKnown?: boolean;
  /**
   * False when issue_payment or mandate.revoke_cart points at a cart that is not in this world.
   * Absent = command does not require a live cart.
   */
  cartKnown?: boolean;
  /**
   * False when mandate.revoke_payment points at a payment that is not in this world.
   * Absent = command does not require a live payment.
   */
  paymentKnown?: boolean;
  /**
   * False when approval.resolve points at a ticket that is not in this world.
   * Absent = not an approval.resolve.
   */
  approvalKnown?: boolean;
  /**
   * False when the ticket exists but is expired or already resolved.
   * Absent = not an approval.resolve, or the ticket is unknown (`approvalKnown` handles that).
   */
  approvalPending?: boolean;
  /**
   * False when `approval.resolve` would approve a ticket whose paused command
   * is no longer an allow (stale quote, expired intent, missing pending command).
   * Absent = not approving a live ticket (`approval.pending` / `approval.known` handle those).
   * Reject does not set this flag — you can always refuse a dead pause.
   */
  replayOk?: boolean;
  /**
   * False when the actor is not the counterparty this hire command belongs to.
   * Accept / deliver / envelope.require are the seller. Refund / release are the buyer or treasury.
   * Absent = not a party-gated command, or the hire is unknown (`hireKnown` handles that).
   */
  hirePartyOk?: boolean;
  /**
   * False when issue_intent points at a parentId that is not in this world.
   * Absent = not a sub-intent (no parentId).
   */
  parentKnown?: boolean;
  /**
   * False when freeze / unfreeze / ladder.set / kya.attest / kya.revoke / issue_cart / issue_intent /
   * market.rfq names an agent that is not in this world (delegate, principal, merchant, subject,
   * freeze target, or RFQ invitee). Absent = command does not require a registered target agent.
   * An empty or omitted invite list is an open RFQ and does not set this flag.
   */
  targetKnown?: boolean;
  /**
   * False when ladder.set would skip a rung, lack a required gate, or use the wrong approver.
   * Listing `kill_switch_tested` is not the test — freeze then unfreeze is.
   * Absent = not a ladder.set, or the target agent is unknown (`identity.known` handles that).
   */
  ladderLegal?: boolean;
  /**
   * False when kya.attest would make the grantor the delegate.
   * Absent = not a kya.attest, or the delegate is unknown (`identity.known` handles that).
   */
  kyaNotSelf?: boolean;
  /**
   * False when kya.attest points at a parentId that is not in this world’s graph.
   * Absent = not a nested hop (no parentId). Do not reuse `parentKnown` —
   * that flag is for issue_intent and would steal first deny as mandate.known_parent.
   * A parent that exists but is expired or revoked is `kya.parent_fresh`, not this flag.
   */
  kyaParentKnown?: boolean;
  /**
   * False when kya.attest names a parent hop that exists but is not live
   * (`hopStatus` is expired or revoked), or when hire.create / hire.fund /
   * mandate.issue_intent would spend along a nested hop whose parent is not live.
   * Set on attest when `kyaParentKnown === true`. Set on those spend verbs when
   * the resolved path contains a hop with parentId.
   * Absent = no parentId, or not those verbs (completing a funded hire after the
   * parent hop dies is legal). Ghost parent stays `kya.known_parent`.
   * Do not reuse `parentFresh` — that flag is for intent slips.
   * Do not add this to `proposedKyaGrant` or omit→L5 would steal `kya.capability_subset`.
   * Graph `attest()` still writes a nested hop under a corpse; dispatch does not.
   */
  kyaParentFresh?: boolean;
  /**
   * False when kya.revoke points at an attestationId that is not in this world’s graph,
   * or that belongs to a different principal. Absent = not a named-attestation revoke.
   * Do not reuse `kyaParentKnown` — that flag is for nested attest and would steal first deny.
   * Revoke by principal+delegate with no attestationId still tombstones implicit grants.
   */
  kyaAttestationKnown?: boolean;
  /**
   * False when kya.attest or kya.revoke names a principal that is not the actor,
   * and the actor is not a human or treasury. Absent = not a handshake command.
   * Omitted principalId is the speaker, not the supervisor. An L4 desk cannot mint
   * or tombstone a founder’s handshake by filling in the ids.
   */
  kyaPartyOk?: boolean;
  /**
   * False when identity.rotate names an agent that is not the speaker,
   * and the speaker is not a human or treasury. Absent = not a rotate.
   * Omitted agentId is the speaker. A vendor cannot turn a desk's lock.
   */
  identityPartyOk?: boolean;
  /**
   * False when market.withdraw names a quote whose seller is not the speaker,
   * and the speaker is not a human or treasury. Absent = not a withdraw, or the
   * quote is unknown (`rfqKnown` handles that). A vendor cannot fold someone else's bid.
   */
  marketPartyOk?: boolean;
  /**
   * False when market.close names an RFQ whose buyer is not the speaker,
   * and the speaker is not a human or treasury. Absent = not a close, or the
   * room is unknown (`rfqKnown` handles that). A desk cannot shut someone else's room.
   */
  rfqPartyOk?: boolean;
  /**
   * False when mandate.revoke_cart names a cart whose merchant, hire buyer, or
   * intent subject is not the speaker, and the speaker is not a human or treasury.
   * Absent = not a dump, or the cart is unknown (`cartKnown` handles that).
   * A desk cannot dump someone else's checkout. Do not reuse `mandate.party` —
   * that flag is the named issuer of an intent.
   */
  cartPartyOk?: boolean;
  /**
   * False when mandate.revoke_payment names a payment whose signer, payee, hire
   * buyer, or intent subject is not the speaker, and the speaker is not a human
   * or treasury. Absent = not a spike, or the payment is unknown (`paymentKnown`
   * handles that). A desk cannot spike someone else's check. Do not reuse
   * `mandate.cart_party` — that flag is the named merchant of a cart.
   */
  paymentPartyOk?: boolean;
  /**
   * False when issue_cart / issue_payment would write a checkout whose hire buyer
   * (or intent subject) is not the speaker, and the speaker is not a human or treasury.
   * Absent = not those verbs, or hire/intent/cart unknown (`hire.known` /
   * `mandate.known_intent` / `mandate.known_cart` handle those). Buyer still mints.
   * Human/treasury still mint. Dump stays `mandate.cart_party`. Spike stays
   * `mandate.payment_party`. A second cart stays `hire.unique_cart`. A cheaper
   * cart stays `hire.cart_matches`.
   */
  checkoutPartyOk?: boolean;
  /**
   * False when hire.create would consume a quote whose RFQ buyer is not the
   * speaker, and the speaker is not a human or treasury. Absent = not a
   * hire.create, or the quote/RFQ is unknown (`rfqKnown` handles that).
   * Buyer still hires. Human/treasury still hire. Ghost quote stays
   * `market.known_rfq`. A spent quote stays `hire.quote_unspent`. A shut
   * room stays `market.not_expired`. Shut TAP is tearing the room
   * (`market.rfq_party`). Fold TAP is tearing the bid (`market.party`).
   */
  hireRoomPartyOk?: boolean;
  /**
   * False when mandate.revoke names an intent whose issuer is not the speaker,
   * and the speaker is not a human or treasury. Absent = not a revoke, or the
   * intent is unknown (`intentKnown` handles that). A desk cannot rip someone else's slip.
   */
  mandatePartyOk?: boolean;
  /**
   * False when hire.create / hire.fund / issue_cart / host.subscribe / mandate.revoke
   * would use an intent that mandate.revoke already tore up.
   * Absent = not those commands, or the intent is unknown (`intentKnown` handles that).
   * Completing funded work after that is legal (`mandate.not_expired` allows complete-after-fund).
   * A ripped unused slip is `mandate.not_expired` on a new hire, not occupancy.
   */
  intentWindowLive?: boolean;
  /**
   * False when issue_payment / hire.fund / mandate.revoke_cart would use a cart
   * that mandate.revoke_cart already tore up, or when mandate.revoke_cart names a
   * cart a payment already occupies. Absent = not those commands, or the cart is
   * unknown (`cartKnown` handles that). Completing funded work after that is legal.
   * A dumped unused cart is `mandate.not_expired` on a new payment, not occupancy.
   * Bound is when a payment occupies it — dump of a bound cart is not a refund.
   */
  cartWindowLive?: boolean;
  /**
   * False when hire.fund / mandate.revoke_payment would use a payment that
   * mandate.revoke_payment already tore up, or when mandate.revoke_payment names a
   * payment escrow already occupies. Absent = not those commands, or the payment is
   * unknown (`paymentKnown` handles that). Completing funded work after that is legal.
   * A spiked unused payment is `mandate.not_expired` on fund, not occupancy.
   * Funded is when escrow occupies it — spike of a funded payment is not a refund.
   */
  paymentWindowLive?: boolean;
  /**
   * False when identity.register would reuse a runtime alias or its operating book
   * (USD cash, and USDC for data_vendor / market_maker).
   * Absent = not a register. Two agents cannot share one operating book.
   * A second market maker collides on `market_maker:cash_usd` even with a new alias.
   * A stray `key:usdc` is the same refuse — not `account exists` after opening USD cash.
   */
  aliasFree?: boolean;
  /**
   * False when ledger.transfer, a named ledger.balances, or market.fx_settle points at a book
   * that is not in this world. FX settle needs the actor’s USDC book (compute vendors and
   * treasury are registered with USD only). Absent = not an account-name command
   * (full balance listing has no name).
   */
  accountsKnown?: boolean;
  /**
   * False when ledger.transfer would post two currencies in one journal, or the stated
   * amount currency disagrees with the books, or hire.fund would lock a cash book into
   * an escrow of a different currency. Absent = not a transfer or fund, or a book is
   * missing (`ledger.known_account` handles that). FX is market.fx_settle, not a transfer.
   */
  accountsSameCurrency?: boolean;
  /**
   * False when ledger.transfer, hire.fund, or market.fx_settle would overdraw the source book.
   * Absent = not a cash-gated command, or a book is missing / mixed (`ledger.known_account` /
   * `ledger.same_currency` handle those). A transfer is not an overdraft. Escrow cannot lock on empty
   * cash, and cannot mix USD cash into a USDC hire. An FX settle cannot spend USD the vendor does
   * not hold (`mm.inventory` is the MM’s USDC).
   */
  fundsOk?: boolean;
  /**
   * False when a journal would leave a touched book outside `Number.isSafeInteger`
   * (dest + amount, or the matching source/equity leg).
   * Absent = not a cash-moving command, or a book is missing / mixed / overdrawn
   * (`ledger.known_account` / `ledger.same_currency` / `ledger.sufficient` handle those).
   * Also set on hire.refund / hire.release / envelope.submit when a live hire’s dest
   * (buyer on refund, seller on release) would overflow. IEEE rounding is not a mint.
   */
  balancesSafe?: boolean;
  /**
   * False when ledger.transfer would journal against equity or escrow
   * (or any non-asset book). Absent = not a transfer, or a book is missing / mixed / overdrawn
   * (`ledger.known_account` / `ledger.same_currency` / `ledger.sufficient` handle those).
   * Dest overflow of operating cash stays `ledger.safe_balance`.
   * Opening cash is `seedOpening`. Escrow moves through hire.fund / refund / release.
   * A transfer is not a mint, and it cannot pick the escrow lock.
   */
  operatingBooksOk?: boolean;
  /**
   * False when identity.register would mint L5.
   * Absent = not a register. L0–L4 at birth are legal.
   * L5 skips per-tx humans. That rung is a climb (`ladder.set` 4→5) after a freeze
   * that was actually tested — not a field on the birth certificate.
   * A reused alias stays `identity.unique_key`. System minting a second agent stays
   * `actor.system_scope`. Skipping a rung on an existing agent stays `ladder.legal`.
   */
  birthRungOk?: boolean;
  /**
   * False when receipt.get names a receipt that is not in this world.
   * Absent = not a receipt.get. A missing receipt is not an empty success.
   * `aether_get` / inspect of a miss still returns nothing; the command bus does not pretend yes.
   */
  receiptKnown?: boolean;
  /**
   * False when identity.freeze targets an already-frozen agent, or identity.unfreeze
   * targets an agent that is not frozen. Absent = not a freeze/unfreeze, or the target
   * is unknown (`identity.known` handles that). A no-op freeze is not a notary line after yes.
   */
  freezeStateOk?: boolean;
  /**
   * False when kya.attest would mint a second live (non-revoked) hop for the same
   * principal→delegate pair. Absent = not an attest, or the delegate is unknown / self
   * (`identity.known` / `kya.not_self` handle those). Revoke, then attest again.
   */
  kyaLiveFree?: boolean;
  /**
   * False when kya.attest would write expiresAt ≤ now (or an unparseable Instant).
   * Absent = not a kya.attest. Omit expiresAt is one year from now.
   * A handshake cannot be born dead. New spends still name `kya.attestation_fresh`
   * when a live hop later expires. Completing a funded hire after that window is
   * legal. Ghost, self, party, unique_live, and over-grant keep first deny.
   */
  kyaMintFresh?: boolean;
  /**
   * False when kya.attest would write expiresAt after now + one year.
   * Absent = not a kya.attest. Omit is exactly one year — the ceiling, not a
   * suggestion. A year-9999 hop is not standing identity. Past stays
   * `kya.mint_fresh`. Ghost, self, party, unique_live, and over-grant keep first deny.
   */
  kyaMintWindowOk?: boolean;
  /**
   * False when mandate.issue_intent would write an execution_date window that
   * cannot contain now (already closed, inverted, or unparseable Instant).
   * Absent = not issue_intent, or the slip has no execution_date constraint.
   * Hire/fund still names `payment.execution_date`. A future not_before still mints
   * if it opens before the slip dies (`mandate.window_reach`). Ghost subject,
   * missing parent, and a wider child keep first deny.
   */
  windowMintFresh?: boolean;
  /**
   * False when mandate.issue_intent would write a not_before at or after the
   * slip's seven-day exp. Absent = not issue_intent, or no execution_date constraint.
   * A closed calendar stays `mandate.window_fresh`. Ghost, parent, and wider child
   * keep first deny.
   */
  windowReachOk?: boolean;
  /**
   * False when mandate.issue_intent would write a recurrence cap that cannot
   * admit a first hire (`max_occurrences` ≤ 0, or not a finite number).
   * Absent = not issue_intent, or the slip has no agent_recurrence constraint.
   * Omit max_occurrences is unlimited and still mints. Hire/fund still names
   * `payment.recurrence`. Ghost subject, missing parent, and a wider child
   * keep first deny. A week that cannot admit a second hire is `mandate.cadence_reach`.
   */
  occurrenceMintOk?: boolean;
  /**
   * False when mandate.issue_intent would write a recurrence whose next slot
   * opens at or after the slip's seven-day exp (`WEEKLY` / `MONTHLY` with the
   * cap omitted or greater than one). Absent = not issue_intent, or no
   * agent_recurrence constraint. A vacant cap stays `mandate.occurrence_fresh`.
   * A one-shot WEEKLY (`max_occurrences` 1) still mints. DAILY still mints.
   * Hire/fund still names `payment.recurrence`.
   */
  cadenceReachOk?: boolean;
  /**
   * False when mandate.issue_intent would write an amount_range whose min
   * exceeds max. Absent = not issue_intent, or no amount_range constraint.
   * Omit min is an open floor and still mints. min === max still mints (exact).
   * Hire/fund still names `payment.amount_range`. A vacant cap stays
   * `mandate.occurrence_fresh`. A week that cannot admit a second hire stays
   * `mandate.cadence_reach`. Lid TAP is hire-time max. A closed hatch is
   * `mandate.lid_fresh`. A closed coffer is `mandate.budget_fresh`.
   */
  rangeMintOk?: boolean;
  /**
   * False when mandate.issue_intent would write a payment.budget whose max
   * cannot admit an amount the lid would allow (`max` ≤ 0, or `max` below an
   * amount_range floor). Absent = not issue_intent, or no budget constraint.
   * A budget that covers the floor still mints. An open floor still mints.
   * Hire/fund still names `payment.budget`. Purse TAP is hire-time envelope.
   * A floor above the lid stays `mandate.range_fresh`. A mixed envelope is
   * `mandate.currency_fresh`.
   */
  budgetMintOk?: boolean;
  /**
   * False when mandate.issue_intent would write an amount_range and a
   * payment.budget in different currencies. Absent = not issue_intent, or
   * only one of those constraints is present. Matching USD still mints.
   * Matching USDC still mints. Hire/fund still names `payment.currency_match`.
   * A closed coffer stays `mandate.budget_fresh`. A floor above the lid stays
   * `mandate.range_fresh`. Mix TAP is a mixed journal. Ink TAP is cart vs hire.
   * A closed hatch is `mandate.lid_fresh`.
   */
  currencyMintOk?: boolean;
  /**
   * False when mandate.issue_intent with a known parent would write an
   * amount_range or payment.budget whose currency differs from the parent's
   * matching constraint. Absent = not a nested mint, or parent unknown
   * (`mandate.known_parent`). Missing currency keeps hire-time first deny.
   * Matching USD still mints. Matching USDC still mints. Same-slip lid vs
   * coffer stays `mandate.currency_fresh`. A wider nested slip stays
   * `mandate.child_tighter`. Clash TAP is a mixed envelope. Header TAP is a
   * nested child in a different currency.
   */
  childCurrencyOk?: boolean;
  /**
   * False when mandate.issue_intent would write an amount_range whose max
   * cannot admit a positive hire (`max` ≤ 0). Absent = not issue_intent, or
   * no amount_range constraint. Missing/non-finite max keeps hire-time first
   * deny. A live lid still mints. An open floor with max > 0 still mints.
   * Hire/fund still names `payment.amount_range`. Lid TAP is hire-time max.
   * A floor above the lid stays `mandate.range_fresh`. A closed coffer is
   * `mandate.budget_fresh`. A mixed envelope is `mandate.currency_fresh`.
   */
  lidMintOk?: boolean;
  /**
   * False when mandate.issue_intent would write an aether.max_autonomy below
   * the named subject's live rung. Absent = not issue_intent, no max_autonomy
   * constraint, or the subject is unknown (`identity.known` handles that).
   * Exact cap (max === rung) still mints. An open ceiling (omit the constraint)
   * still mints. Hire/fund still names `ladder.max_autonomy_constraint`.
   * Ceiling TAP is a climb after mint. Grade TAP is a junior nested mint.
   * A closed hatch stays `mandate.lid_fresh`.
   */
  capMintOk?: boolean;
  /**
   * False when kya.attest would write a maxAutonomy below the named delegate's
   * live rung. Absent = not attest, omitted maxAutonomy (open ceiling / L5),
   * or the delegate is unknown (`identity.known` handles that).
   * Exact grant (max === rung) still mints. Hire still names
   * `kya.capability_subset`. Climb TAP is a climb after mint.
   * Eave TAP is a slip cap below the desk (`mandate.cap_fresh`).
   */
  grantMintOk?: boolean;
  /**
   * False when kya.attest would write a nested hop whose ceiling is wider
   * than its live parent's maxAutonomy. Absent = not attest, no parentId,
   * parent unknown (`kya.known_parent`), or parent not live (`kya.parent_fresh`).
   * Omitted maxAutonomy is L5. Exact match (child === parent) still mints.
   * A tighter child still mints. A grant below the desk stays `kya.grant_fresh`.
   * Mandate `child_tighter` is a nested slip, not a nested hop.
   * A nested hop under another principal is `kya.nest_party`.
   */
  nestTighterOk?: boolean;
  /**
   * False when kya.attest would write a hop in another principal's name
   * whose ceiling is wider than the speaker's live incoming hop from that
   * principal. Absent = not attest, speaker is the principal, or no live
   * path from that principal (`kya.path_live`). Omitted maxAutonomy is L5. Exact match
   * (child === incoming) still mints. A tighter child still mints.
   * A nested grant wider than its parentId hop stays `kya.nest_tighter`.
   * A grant below the desk stays `kya.grant_fresh`.
   */
  pathTighterOk?: boolean;
  /**
   * False when kya.attest would write a hop in another known principal's
   * name and the speaker has no live path from that principal. Absent = not
   * attest, speaker is the principal, principal unknown (`identity.known`),
   * or a live incoming hop exists (`kya.path_tighter` owns width). An agent
   * filling in another principal's id stays `kya.party`. Speaker granting in
   * their own name is not this deny. A dead incoming hop is this deny, not
   * `kya.parent_fresh` (that rule is an explicit parentId).
   */
  pathLiveOk?: boolean;
  /**
   * False when kya.attest would write a nested hop whose principal is not
   * the live parent hop's principal. Absent = not attest, no parentId,
   * parent unknown (`kya.known_parent`), or parent not live (`kya.parent_fresh`).
   * Same-principal nest still mints. Speaker granting in their own name
   * without parentId is not this deny. A nested grant wider than its parent
   * stays `kya.nest_tighter`. An orphan hop stays `kya.path_live`.
   * Whose name a handshake is in stays `kya.party`.
   */
  nestPartyOk?: boolean;
  /**
   * False when the parent intent is past `exp` (unix seconds).
   * Set on `mandate.issue_intent`, `hire.create`, and `hire.fund` when a parent exists.
   * Absent = no parent, or not those verbs (completing a funded hire after the parent
   * dies is legal). Ghost parent stays `mandate.known_parent`. The child's own
   * expiry stays `mandate.not_expired` on a new spend. Completing a funded hire after that is legal.
   */
  parentFresh?: boolean;
  /**
   * False when issue_cart names a live hire that already has a cartId.
   * Absent = not binding a cart to a hire, or the hire is unknown (`hire.known` handles that).
   * A hire takes one cart. A second cart is not a pointer swap.
   */
  cartUnbound?: boolean;
  /**
   * False when issue_payment points at a cart that already has a payment mandate
   * (same cart hash / transaction_id) that is not revoked.
   * Absent = not issue_payment, or the cart is unknown (`mandate.known_cart` handles that).
   * A cart takes one occupying payment. A second payment is not a second check.
   * A spiked unused payment frees occupancy.
   */
  paymentUnbound?: boolean;
  /**
   * False when hire.fund / hire.release / envelope.submit would move escrow
   * against a live hire that has not bound a cart (and that cart’s payment).
   * Absent = not those commands, or the hire is unknown (`hire.known` handles that).
   * Passing cartId on fund is not a pointer. Issue the cart with hireId.
   */
  cartBound?: boolean;
  /**
   * False when the command’s actorId is not `system` and is not a registered agent.
   * Absent = the speaker is system or a live agent (`identity.known` is for *named targets*, not the speaker).
   * A missing speaker is not a 500 after yes. HTTP/MCP unknown alias becomes this string, not silent system.
   */
  actorKnown?: boolean;
  /**
   * False when Command.actorId is `system` and the command is not a bootstrap of the
   * first human or a read (catalog / audit.query / audit.verify / balances / receipt.get / host.card).
   * Absent = speaker is not system. System is the runtime, not a treasurer.
   * HTTP/MCP omitting actor still becomes system; this rule is the fence.
   * A provided name that is not a live alias is `actor.known`, not silent system.
   * `GET /v1/audit/verify` is this read, not a bypass of evaluate().
   * `GET /v1/accounts/{id}` and `GET /v1/receipts/{id}` are this read as system, not ops-human.
   */
  systemOk?: boolean;
  /**
   * False when `host.subscribe` targets an instance that is not hosted
   * (`Runtime.hosted` / `PROTOCOL.hosted` is false). Absent = not a subscribe.
   * Self-host is free. GitHub is not a checkout. `host.card` is a read, not a subscribe.
   */
  hostedOk?: boolean;
  /**
   * False when hosted `host.subscribe` carries a live intent whose issuer is not
   * `human_operator` or `treasury`. Absent = not a hosted subscribe with a known intent
   * (`mandate.known_intent` handles a ghost). An agent-issued slip is not host authority.
   */
  hostIssuerOk?: boolean;
  /**
   * False when hosted `host.subscribe` would bind an agent that already has a row.
   * Absent = not a hosted subscribe with a known intent. One subscriber, one row.
   */
  subscribeUnique?: boolean;
  /**
   * False when hire.create / hire.fund cites a `payment.reference` whose
   * `conditional_transaction_id` is not a funded payment's `transaction_id`
   * (cart hash) in this world, after at least one funded payment exists.
   * Absent = not a spend-start, no `payment.reference` constraint, or no
   * funded payment yet (AP2-shaped catalog surface until a prior payment exists).
   * Completing funded work does not set this flag.
   */
  referenceOk?: boolean;
}

/**
 * Recorded when a hosted operator allows `host.subscribe`.
 * The store stays raw. Spend is not gated on this row.
 */
export interface HostSubscription {
  id: SubscriptionId;
  subscriberId: AgentId;
  intentId: MandateId;
  createdAt: Instant;
}

/**
 * Inspect / snapshot view. Expired includes a dead intent and a dead parent
 * intent. Unique_subscriber still occupies. Spend is not gated on the row.
 * The store stays raw (`intentId` / `createdAt` only).
 */
export type SubscriptionStatus = "live" | "expired";

/**
 * Off-band monthly payment for a hosted operator. Not a Command. Not a spend gate.
 * Humans pay the operator (invoice or Stripe). The public kernel has no invoices.
 */
export interface OperatorInvoice {
  id: string;
  at: Instant;
  amount: number;
  currency: CurrencyCode;
  method: "invoice" | "stripe";
  actorId: AgentId;
  reference?: string;
}

/**
 * Inspect / snapshot view. Current is inside the 31-day door window.
 * Lapsed is not a current invoice. The store stays raw (`at` only).
 * Spend is not gated on a row; the door asks whether *any* invoice is current.
 */
export type InvoiceStatus = "current" | "lapsed";

export const DEFAULT_APPROVAL_THRESHOLDS: Record<AgentRole, number> = {
  procurement: 500_000,
  treasury: 2_000_000,
  data_vendor: 50_000,
  compute_vendor: 50_000,
  market_maker: 50_000,
  auditor: 0,
  human_operator: 0,
};

export const VELOCITY_CAPS = {
  windowSeconds: 3600,
  maxCount: 20,
  maxVolume: 2_000_000,
} as const;

export const MM_RATE_BAND_E6 = {
  min: 980_000,
  max: 1_020_000,
} as const;

// ---------------------------------------------------------------------------
// Receipt + audit
// ---------------------------------------------------------------------------

export interface Receipt {
  id: ReceiptId;
  status: "Success" | "Error";
  iss: typeof RECEIPT_ISSUER;
  iat: number;
  /** sha256(canonicalJson(closed PaymentMandate)) */
  reference: HexSha256;
  payment_id: TransferId;
  journalId: JournalId;
  hireId?: HireId;
  network_confirmation_id: HexSha256;
  error?: string;
  error_description?: string;
}

export type AuditAction =
  | "GENESIS"
  | "IDENTITY_REGISTER"
  | "LADDER_SET"
  | "MANDATE_ISSUE"
  | "MANDATE_REVOKE"
  | "CART_REVOKE"
  | "PAYMENT_REVOKE"
  | "RFQ_CREATE"
  | "RFQ_CLOSE"
  | "QUOTE_SUBMIT"
  | "QUOTE_WITHDRAW"
  | "HIRE_TRANSITION"
  | "POLICY_DECISION"
  | "APPROVAL_RESOLVE"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_SUBMIT"
  | "JOURNAL_POST"
  | "RECEIPT_ISSUE"
  | "FREEZE"
  | "UNFREEZE"
  | "IDENTITY_ROTATE"
  | "KYA_ATTEST"
  | "KYA_REVOKE"
  | "CIRCUIT_RESET"
  | "CLEARING_WINDOW"
  | "AUDIT_VERIFY"
  | "HOST_SUBSCRIBE"
  | "HOST_INVOICE";

export interface AuditSubject {
  type: string;
  id: string;
}

export interface AuditRecord {
  v: 1;
  seq: number;
  prevHash: HexSha256;
  recordedAt: Instant;
  actorId: AgentId | "system";
  action: AuditAction;
  subjects: AuditSubject[];
  payload: unknown;
  payloadHash: HexSha256;
  hash: HexSha256;
}

export interface AuditVerifyOk {
  ok: true;
  head: HexSha256;
  length: number;
}

export interface AuditVerifyFail {
  ok: false;
  seq: number;
  reason: string;
}

export type AuditVerifyResult = AuditVerifyOk | AuditVerifyFail;

// ---------------------------------------------------------------------------
// Command bus
// ---------------------------------------------------------------------------

export type CommandType =
  | "identity.register"
  | "identity.freeze"
  | "identity.unfreeze"
  | "identity.rotate"
  | "kya.attest"
  | "kya.revoke"
  | "circuit.reset"
  | "mandate.issue_intent"
  | "mandate.revoke"
  | "mandate.revoke_cart"
  | "mandate.revoke_payment"
  | "mandate.issue_cart"
  | "mandate.issue_payment"
  | "market.rfq"
  | "market.close"
  | "market.quote"
  | "market.withdraw"
  | "market.fx_settle"
  | "market.catalog"
  | "hire.create"
  | "hire.accept"
  | "hire.fund"
  | "hire.deliver"
  | "hire.release"
  | "hire.refund"
  | "hire.void"
  | "envelope.require"
  | "envelope.submit"
  | "approval.resolve"
  | "ladder.set"
  | "ledger.transfer"
  | "ledger.balances"
  | "clearing.settle_window"
  | "audit.verify"
  | "audit.query"
  | "receipt.get"
  | "host.card"
  | "host.subscribe";

/**
 * What another agent should do next. English is for humans; `kind` is for machines.
 * `commandType` is a hint for a follow-up Command, not a guaranteed second dispatch.
 */
export interface Remediation {
  kind: RemediationKind;
  ruleId: string;
  hint: string;
  commandType?: CommandType;
}

export interface Command<T extends CommandType = CommandType, B = unknown> {
  type: T;
  actorId: AgentId | "system";
  body: B;
  /** Client-supplied or auto-hashed for money-moving verbs. Denies are never keyed. */
  idempotencyKey?: string;
}

/** Commands that spend, close, or hand down authority. The kernel consults KYA.
 *  Hop expiry does not trap funded escrow (`kya.attestation_fresh` allows complete-after-fund).
 *  Freeze and revoke still bind on those verbs. Do not drop them from this list.
 */
export const KYA_GATED_COMMANDS: readonly CommandType[] = [
  "hire.create",
  "hire.fund",
  "hire.release",
  "hire.refund",
  "envelope.submit",
  "mandate.issue_intent",
  "kya.attest",
];

/**
 * Commands `system` may run besides bootstrapping the first human_operator.
 * System is the runtime, not a treasurer. HTTP/MCP omitting actor still becomes system.
 * A provided name that is not a live alias is `actor.known`, not silent system.
 * `audit.verify` is a notary read: `GET /v1/audit/verify` is this command, not a bypass.
 * `ledger.balances` / `receipt.get`: `GET /v1/accounts/{id}` and `GET /v1/receipts/{id}`
 * are these commands as system, not ops-human.
 */
export const SYSTEM_READ_COMMANDS: readonly CommandType[] = [
  "market.catalog",
  "audit.query",
  "audit.verify",
  "ledger.balances",
  "receipt.get",
  "host.card",
];

export const ROLE_CAPABILITY: Record<
  AgentRole,
  readonly CommandType[]
> = {
  treasury: [
    "identity.register",
    "identity.freeze",
    "identity.unfreeze",
    "identity.rotate",
    "kya.attest",
    "kya.revoke",
    "circuit.reset",
    "mandate.issue_intent",
    "mandate.revoke",
    "mandate.revoke_cart",
    "mandate.revoke_payment",
    "mandate.issue_cart",
    "mandate.issue_payment",
    "market.rfq",
    "market.close",
    "market.fx_settle",
    "market.withdraw",
    "hire.create",
    "hire.accept",
    "hire.fund",
    "hire.release",
    "hire.refund",
    "hire.void",
    "envelope.require",
    "envelope.submit",
    "approval.resolve",
    "ladder.set",
    "ledger.transfer",
    "ledger.balances",
    "clearing.settle_window",
    "audit.verify",
    "audit.query",
    "market.catalog",
    "receipt.get",
    "host.card",
    "host.subscribe",
  ],
  procurement: [
    "identity.rotate",
    "mandate.issue_intent",
    "mandate.revoke",
    "mandate.revoke_cart",
    "mandate.revoke_payment",
    "kya.attest",
    "kya.revoke",
    "mandate.issue_cart",
    "mandate.issue_payment",
    "market.rfq",
    "market.close",
    "hire.create",
    "hire.accept",
    "hire.fund",
    "hire.release",
    "hire.refund",
    "hire.void",
    "envelope.require",
    "envelope.submit",
    "ledger.balances",
    "audit.query",
    "market.catalog",
    "receipt.get",
    "host.card",
    "host.subscribe",
  ],
  data_vendor: [
    "identity.rotate",
    "mandate.revoke_cart",
    "mandate.revoke_payment",
    "market.quote",
    "market.withdraw",
    "market.fx_settle",
    "hire.accept",
    "hire.void",
    "hire.deliver",
    "envelope.require",
    "envelope.submit",
    "ledger.balances",
    "audit.query",
    "market.catalog",
    "receipt.get",
    "host.card",
  ],
  compute_vendor: [
    "identity.rotate",
    "mandate.revoke_cart",
    "mandate.revoke_payment",
    "market.quote",
    "market.withdraw",
    "market.fx_settle",
    "hire.accept",
    "hire.void",
    "hire.deliver",
    "envelope.require",
    "envelope.submit",
    "ledger.balances",
    "audit.query",
    "market.catalog",
    "receipt.get",
    "host.card",
  ],
  market_maker: [
    "identity.rotate",
    "market.quote",
    "market.withdraw",
    "market.fx_settle",
    "envelope.require",
    "envelope.submit",
    "ledger.balances",
    "audit.query",
    "market.catalog",
    "receipt.get",
    "host.card",
  ],
  auditor: ["audit.verify", "audit.query", "identity.freeze", "identity.unfreeze", "identity.rotate", "ledger.balances", "receipt.get", "market.catalog", "host.card"],
  human_operator: [
    "identity.register",
    "identity.freeze",
    "identity.unfreeze",
    "identity.rotate",
    "market.withdraw",
    "market.close",
    "kya.attest",
    "kya.revoke",
    "circuit.reset",
    "mandate.issue_intent",
    "mandate.revoke",
    "mandate.revoke_cart",
    "mandate.revoke_payment",
    "approval.resolve",
    "ladder.set",
    "audit.verify",
    "audit.query",
    "market.catalog",
    "ledger.balances",
    "clearing.settle_window",
    "receipt.get",
    "host.card",
    "host.subscribe",
  ],
};
