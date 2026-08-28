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
 * Pin this. There is no finish date for the kernel.
 * `liveMoney: false` until adapters exist. Public protocol ≠ live bank.
 */
export const PROTOCOL = {
  spec: "aether.protocol.1",
  version: "0.27.0",
  rail: SIM_RAIL_ID,
  liveMoney: false,
  currencies: ["USD_SIM", "USDC_SIM"] as const,
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

export interface LineItem {
  sku: string;
  description: string;
  quantity: number;
  unitAmount: Money;
}

export type RecurrenceFrequency = "ON_DEMAND" | "DAILY" | "WEEKLY" | "MONTHLY";

/** Minimum gap between funded occurrences. `ON_DEMAND` has no gap. Monthly is 30 × 24h on the sim clock. */
export const RECURRENCE_GAP_MS: Record<RecurrenceFrequency, number> = {
  ON_DEMAND: 0,
  DAILY: 86_400_000,
  WEEKLY: 7 * 86_400_000,
  MONTHLY: 30 * 86_400_000,
};

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
  exp: number;
}

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
  "envelope.submit": "released",
} as const satisfies Record<string, HireState>;

/** Commands that do not walk the hire but are only legal in one state. */
export const HIRE_COMMAND_REQUIRED_STATE = {
  "envelope.require": "delivered",
} as const satisfies Record<string, HireState>;

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
  status: "pending" | "approved" | "rejected" | "expired";
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

export const KYA_MAX_DEPTH = 3;

export interface DelegationAttestation {
  id: DelegationId;
  vct: "aether.kya.delegation.1";
  issuerKind: KyaIssuerKind;
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

export interface KyaResolution {
  required: boolean;
  pathOk: boolean;
  implicit: boolean;
  depth: number;
  maxDepth: number;
  principalId?: AgentId;
  principalFrozen: boolean;
  expired: boolean;
  revoked: boolean;
  grantedMaxAutonomy?: AutonomyLevel;
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
  /** True when envelope nonce was already settled. */
  nonceSeen?: boolean;
  /** False when MM cannot pay the `to` currency. */
  mmInventoryOk?: boolean;
  /** False when the audit chain fails verify(). */
  auditHealthy?: boolean;
  /** False when verifyChain failed for the attached mandate triple. */
  chainOk?: boolean;
  /** True when replaying a command after a matching ApprovalTicket. */
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
   * False when `hire.create` would reuse a quote that already produced a hire, an FX settle,
   * or is held by an open approval ticket.
   * Absent = not a hire.create, or the quote/RFQ is unknown (`rfqKnown` handles that).
   * A deny does not consume the quote. An escalate *reserves* it until
   * the ticket is approved, rejected, or expired. A void/refund does not restore it.
   */
  quoteUnspent?: boolean;
  /**
   * False when a hireId command points at a hire that is not in this world.
   * Absent = command does not require a live hire (`hire.create` uses a draft).
   */
  hireKnown?: boolean;
  /**
   * False when hire.create or issue_cart points at an intent that is not in this world.
   * Absent = command does not require a live intent.
   */
  intentKnown?: boolean;
  /**
   * False when issue_payment points at a cart that is not in this world.
   * Absent = command does not require a live cart.
   */
  cartKnown?: boolean;
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
   * False when freeze / unfreeze / ladder.set / kya.attest / kya.revoke / issue_cart / issue_intent
   * names an agent that is not in this world (delegate, principal, merchant, subject, or freeze target).
   * Absent = command does not require a registered target agent.
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
   */
  kyaParentKnown?: boolean;
}

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
  | "UNFREEZE"
  | "KYA_ATTEST"
  | "KYA_REVOKE"
  | "CIRCUIT_RESET"
  | "CLEARING_WINDOW"
  | "AUDIT_VERIFY";

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
  | "kya.attest"
  | "kya.revoke"
  | "circuit.reset"
  | "mandate.issue_intent"
  | "mandate.issue_cart"
  | "mandate.issue_payment"
  | "market.rfq"
  | "market.quote"
  | "market.fx_settle"
  | "market.catalog"
  | "hire.create"
  | "hire.accept"
  | "hire.fund"
  | "hire.deliver"
  | "hire.release"
  | "hire.refund"
  | "envelope.require"
  | "envelope.submit"
  | "approval.resolve"
  | "ladder.set"
  | "ledger.transfer"
  | "ledger.balances"
  | "clearing.settle_window"
  | "audit.verify"
  | "audit.query"
  | "receipt.get";

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

/** Commands that spend, close, or hand down authority. The kernel consults KYA. */
export const KYA_GATED_COMMANDS: readonly CommandType[] = [
  "hire.create",
  "hire.fund",
  "hire.release",
  "hire.refund",
  "envelope.submit",
  "mandate.issue_intent",
  "kya.attest",
];

export const ROLE_CAPABILITY: Record<
  AgentRole,
  readonly CommandType[]
> = {
  treasury: [
    "identity.register",
    "identity.freeze",
    "identity.unfreeze",
    "kya.attest",
    "kya.revoke",
    "circuit.reset",
    "mandate.issue_intent",
    "mandate.issue_cart",
    "mandate.issue_payment",
    "market.rfq",
    "market.fx_settle",
    "hire.create",
    "hire.accept",
    "hire.fund",
    "hire.release",
    "hire.refund",
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
  ],
  procurement: [
    "mandate.issue_intent",
    "kya.attest",
    "kya.revoke",
    "mandate.issue_cart",
    "mandate.issue_payment",
    "market.rfq",
    "hire.create",
    "hire.accept",
    "hire.fund",
    "hire.release",
    "hire.refund",
    "envelope.require",
    "envelope.submit",
    "ledger.balances",
    "audit.query",
    "market.catalog",
    "receipt.get",
  ],
  data_vendor: [
    "market.quote",
    "market.fx_settle",
    "hire.accept",
    "hire.deliver",
    "envelope.require",
    "envelope.submit",
    "ledger.balances",
    "audit.query",
    "market.catalog",
    "receipt.get",
  ],
  compute_vendor: [
    "market.quote",
    "market.fx_settle",
    "hire.accept",
    "hire.deliver",
    "envelope.require",
    "envelope.submit",
    "ledger.balances",
    "audit.query",
    "market.catalog",
    "receipt.get",
  ],
  market_maker: [
    "market.quote",
    "market.fx_settle",
    "envelope.require",
    "envelope.submit",
    "ledger.balances",
    "audit.query",
    "market.catalog",
    "receipt.get",
  ],
  auditor: ["audit.verify", "audit.query", "identity.freeze", "identity.unfreeze", "ledger.balances", "receipt.get", "market.catalog"],
  human_operator: [
    "identity.register",
    "identity.freeze",
    "identity.unfreeze",
    "kya.attest",
    "kya.revoke",
    "circuit.reset",
    "mandate.issue_intent",
    "approval.resolve",
    "ladder.set",
    "audit.verify",
    "audit.query",
    "market.catalog",
    "ledger.balances",
    "clearing.settle_window",
    "receipt.get",
  ],
};
