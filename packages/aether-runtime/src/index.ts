import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuditLog, genesisRecord } from "@aether/audit";
import { signInner, verifyInner } from "@aether/envelope";
import { transitionHire } from "@aether/escrow";
import { IdentityRegistry, ladderClimbLegal, makeAgent } from "@aether/identity";
import {
  exportKeypair,
  err,
  fail,
  IdFactory,
  importKeypair,
  ManualClock,
  ok,
  payloadHash,
  unixSeconds,
  type Clock,
  type Ed25519Keypair,
} from "@aether/kernel";
import { isOperatingBook, Ledger } from "@aether/ledger";
import { cartHash, intentHash, signMandate, verifyChain } from "@aether/mandate";
import { CATALOG, isCatalogSku, skuAllowsCurrency, fxPairSettles, fxPayout, isFxSku } from "@aether/market";
import { ExposureBook } from "@aether/clearing";
import { DelegationGraph, hopStatus, resolveKya } from "@aether/kya";
import { evaluate, remediationFor } from "@aether/policy";
import { SIM_RAIL, settlementFail } from "@aether/settlement";
import { commandShapeError } from "./command-schema.js";
import { HOST_INVOICE_WINDOW_MS } from "./host-door.js";
import {
  analog,
  autoBeat,
  IDLE_TLDR,
  SPRINT_TLDR,
  NIGHT_WATCH_TLDR,
  SUBHIRE_TLDR,
  CLEARING_TLDR,
  REFUND_TLDR,
  REPLAY_TLDR,
  NONCE_TLDR,
  DENY_CACHE_TLDR,
  RECURRENCE_TLDR,
  CALENDAR_TLDR,
  SLOT_TLDR,
  DAILY_TLDR,
  CART_TLDR,
  VELOCITY_TLDR,
  DOOR_TLDR,
  MATCH_TLDR,
  ROOM_TLDR,
  CONVERSION_TLDR,
  PAIR_TLDR,
  BAND_TLDR,
  NEST_TLDR,
  HEIR_TLDR,
  STOCK_TLDR,
  PURSE_TLDR,
  SEAT_TLDR,
  COVER_TLDR,
  MINT_TLDR,
  PAYEE_TLDR,
  CLIMB_TLDR,
  BORN_TLDR,
  REACH_TLDR,
  YEAR_TLDR,
  FUSE_TLDR,
  SKU_TLDR,
  PRICED_TLDR,
  PARTY_TLDR,
  CASH_TLDR,
  STALE_TLDR,
  CHAIN_TLDR,
  ARROW_TLDR,
  WALLET_TLDR,
  NAME_TLDR,
  PANE_TLDR,
  SUBJECT_TLDR,
  PAPER_TLDR,
  MIX_TLDR,
  RUNG_TLDR,
  GRADE_TLDR,
  CRADLE_TLDR,
  CEILING_TLDR,
  LAPSE_TLDR,
  PAUSE_TLDR,
  MIRROR_TLDR,
  WARRANT_TLDR,
  VACANT_TLDR,
  BADGE_TLDR,
  LID_TLDR,
  BARE_TLDR,
  SHELF_TLDR,
  HALL_TLDR,
  WRIT_TLDR,
  CRATE_TLDR,
  PACT_TLDR,
  ROOT_TLDR,
  DOCKET_TLDR,
  GRAFT_TLDR,
  SEAL_TLDR,
  GUEST_TLDR,
  DUST_TLDR,
  THAW_TLDR,
  TWIN_TLDR,
  FENCE_TLDR,
  MUTE_TLDR,
  NIL_TLDR,
  SPARK_TLDR,
  WILT_TLDR,
  MAKER_TLDR,
  INK_TLDR,
  BRIM_TLDR,
  SWAP_TLDR,
  SOUR_TLDR,
  CUT_TLDR,
  ICE_TLDR,
  RAIL_TLDR,
  PEN_TLDR,
  WELL_TLDR,
  CITE_TLDR,
  LOCK_TLDR,
  VOID_TLDR,
  FOLD_TLDR,
  RIP_TLDR,
  SHUT_TLDR,
  DUMP_TLDR,
  SPIKE_TLDR,
  WEEK_TLDR,
  GULF_TLDR,
  COFFER_TLDR,
  CLASH_TLDR,
  HATCH_TLDR,
  nightWatchAnalog,
  type Analog,
  type StoryBeat,
} from "./story.js";
import { WORLD_VERSION, type WorldState } from "./world.js";
import type {
  Account,
  AccountId,
  Agent,
  AgentId,
  AgentRole,
  AetherError,
  ApprovalId,
  ApprovalTicket,
  AutonomyLevel,
  CartMandate,
  CartStatus,
  PaymentStatus,
  Command,
  CommandType,
  CurrencyCode,
  DelegationAttestation,
  DelegationId,
  HireContract,
  HireId,
  HireStatus,
  HostSubscription,
  OperatorInvoice,
  Instant,
  IntentMandate,
  IntentStatus,
  InvoiceStatus,
  JournalEntry,
  KyaIssuerKind,
  KyaHopStatus,
  IssuerId,
  LadderExtraGate,
  LineItem,
  MandateConstraint,
  MandateId,
  RecurrenceFrequency,
  Merchant,
  Money,
  PaymentMandate,
  PolicyContext,
  PolicyDecision,
  Quote,
  QuoteStatus,
  Receipt,
  Result,
  Rfq,
  RfqStatus,
  Signed,
  SubscriptionId,
  SubscriptionStatus,
  WindowId,
} from "@aether/types";
import { KYA_GATED_COMMANDS, KYA_MAX_DEPTH, DAY_MS, DAY_SEC, HOUR_MS, INTENT_TTL_MS, INTENT_TTL_SEC, KYA_TTL_MS, PROTOCOL, RECURRENCE_GAP_MS, ROLE_CAPABILITY, SIM_INSTRUMENT, SIM_RAIL_ID, SYSTEM_READ_COMMANDS, VELOCITY_CAPS } from "@aether/types";

export type DispatchOk = {
  kind: "allow" | "escalated";
  decision: PolicyDecision;
  data: unknown;
  ticket?: ApprovalTicket;
  replayed?: true;
};

export type DispatchFail = {
  error: AetherError;
  /** Present on policy deny/escalate. Absent on malformed commands (no evaluate()). */
  decision?: PolicyDecision;
};

export type DispatchResult = Result<DispatchOk, DispatchFail>;

/** Same body, same actor: replay. Denies are not cached so a fix can be retried. */
const AUTO_IDEMPOTENT = new Set<CommandType>([
  "identity.register",
  "identity.rotate",
  "hire.create",
  "hire.fund",
  "hire.release",
  "hire.refund",
  "envelope.submit",
  "market.fx_settle",
]);

const HIRE_LIVE_COMMANDS = new Set<CommandType>([
  "hire.accept",
  "hire.fund",
  "hire.deliver",
  "hire.release",
  "hire.refund",
  "hire.void",
  "envelope.require",
  "envelope.submit",
]);

function idempotencyKeyOf(cmd: Command): string | undefined {
  if (typeof cmd.idempotencyKey === "string" && cmd.idempotencyKey.length > 0) return cmd.idempotencyKey;
  if (!AUTO_IDEMPOTENT.has(cmd.type)) return undefined;
  return payloadHash({ type: cmd.type, actorId: cmd.actorId, body: cmd.body });
}

function cloneResult(result: DispatchResult): DispatchResult {
  return JSON.parse(JSON.stringify(result)) as DispatchResult;
}

/** Closed when now > not_after (same exclusive end as hire). Inverted or unparseable is not a window. */
function executionWindowMintable(c: { not_before?: unknown; not_after?: unknown }, nowIso: Instant): boolean {
  const now = Date.parse(nowIso);
  const before =
    c.not_before === undefined || c.not_before === null
      ? undefined
      : typeof c.not_before === "string"
        ? Date.parse(c.not_before)
        : Number.NaN;
  const after =
    c.not_after === undefined || c.not_after === null
      ? undefined
      : typeof c.not_after === "string"
        ? Date.parse(c.not_after)
        : Number.NaN;
  if (before !== undefined && !Number.isFinite(before)) return false;
  if (after !== undefined && !Number.isFinite(after)) return false;
  if (before !== undefined && after !== undefined && after < before) return false;
  if (after !== undefined && now > after) return false;
  return true;
}

/** A not_before at or after the slip's seven-day exp never overlaps a live intent. */
function executionWindowReachable(c: { not_before?: unknown }, nowIso: Instant): boolean {
  if (c.not_before === undefined || c.not_before === null) return true;
  if (typeof c.not_before !== "string") return false;
  const before = Date.parse(c.not_before);
  if (!Number.isFinite(before)) return false;
  return before < (unixSeconds(nowIso) + INTENT_TTL_SEC) * 1000;
}

/** A cap that cannot admit a first hire (count starts at 0) is not a cadence. Omit is unlimited. */
function recurrenceMintable(c: { max_occurrences?: unknown }): boolean {
  if (c.max_occurrences === undefined) return true;
  if (typeof c.max_occurrences !== "number" || !Number.isFinite(c.max_occurrences)) return false;
  return c.max_occurrences > 0;
}

/**
 * A frequency whose next slot opens at or after the seven-day exp cannot admit
 * hire 2. Vacant caps stay occurrence_fresh. One-shot WEEKLY still mints.
 */
function cadenceReachable(c: { frequency?: unknown; max_occurrences?: unknown }): boolean {
  if (!recurrenceMintable(c)) return true;
  if (typeof c.frequency !== "string") return false;
  if (!(c.frequency in RECURRENCE_GAP_MS)) return false;
  const gap = RECURRENCE_GAP_MS[c.frequency as RecurrenceFrequency];
  if (gap === 0) return true;
  if (c.max_occurrences === 1) return true;
  return gap < INTENT_TTL_MS;
}

/** A min that exceeds max cannot admit any amount. Omit min is an open floor. min === max still mints. */
function rangeMintable(c: { min?: unknown; max?: unknown }): boolean {
  if (typeof c.max !== "number" || !Number.isFinite(c.max)) return true;
  if (c.min === undefined) return true;
  if (typeof c.min !== "number" || !Number.isFinite(c.min)) return false;
  return c.min <= c.max;
}

/**
 * A lid that cannot admit a positive hire is not a range. Missing/non-finite max
 * keeps hire-time first deny. max ≤ 0 is empty even when min is omitted or equal.
 */
function lidMintable(c: { min?: unknown; max?: unknown }): boolean {
  if (typeof c.max !== "number" || !Number.isFinite(c.max)) return true;
  return c.max > 0;
}

/**
 * A budget that cannot admit a positive amount, or that sits below an amount_range
 * floor, is not an envelope. Missing/non-finite max keeps hire-time first deny.
 */
function budgetMintable(
  budget: { max?: unknown },
  range?: { min?: unknown; max?: unknown },
): boolean {
  if (typeof budget.max !== "number" || !Number.isFinite(budget.max)) return true;
  if (budget.max <= 0) return false;
  if (!range) return true;
  if (typeof range.min !== "number" || !Number.isFinite(range.min)) return true;
  return budget.max >= range.min;
}

/** Lid and coffer in different currencies cannot admit any amount. Missing currency keeps hire-time first deny. */
function moneyCurrenciesAligned(
  range: { currency?: unknown },
  budget: { currency?: unknown },
): boolean {
  if (typeof range.currency !== "string" || typeof budget.currency !== "string") return true;
  return range.currency === budget.currency;
}

/** Closed when validUntil ≤ now (same exclusive end as quote expiresAt). Unparseable is not a window. */
function fxWindowMintable(fx: { validUntil?: unknown }, nowIso: Instant): boolean {
  if (typeof fx.validUntil !== "string") return false;
  const until = Date.parse(fx.validUntil);
  const now = Date.parse(nowIso);
  return Number.isFinite(until) && until > now;
}

/** New spend (not completing funded work). Nested hops on these verbs must have a live parent. */
const KYA_NESTED_SPEND: ReadonlySet<CommandType> = new Set([
  "mandate.issue_intent",
  "hire.create",
  "hire.fund",
]);

/**
 * Pair gross is reserved at offer and recorded at fund. Completing funded work
 * (deliver / submit / release) is not a second leg. FX settle records both books.
 */
const CLEARING_SPEND: ReadonlySet<CommandType> = new Set([
  "hire.create",
  "hire.fund",
  "market.fx_settle",
]);

/** Undefined = no nested hop on the path. False = a parent hop is expired or revoked. */
function nestedKyaParentsLive(
  hops: ReadonlyArray<{ parentId?: DelegationId }>,
  lookup: (id: DelegationId) => DelegationAttestation | undefined,
  nowIso: Instant,
): boolean | undefined {
  let saw = false;
  for (const hop of hops) {
    if (hop.parentId === undefined) continue;
    saw = true;
    const parent = lookup(hop.parentId);
    if (!parent || hopStatus(parent, nowIso) !== "live") return false;
  }
  return saw ? true : undefined;
}

export class Runtime {
  readonly clock: ManualClock;
  readonly ids: IdFactory;
  readonly audit: AuditLog;
  readonly ledger: Ledger;
  readonly identity = new IdentityRegistry();
  readonly aliases = new Map<string, AgentId>();
  readonly intents = new Map<MandateId, Signed<IntentMandate>>();
  readonly carts = new Map<MandateId, Signed<CartMandate>>();
  readonly payments = new Map<MandateId, Signed<PaymentMandate>>();
  readonly hires = new Map<HireId, HireContract>();
  readonly rfqs = new Map<string, Rfq>();
  readonly quotes = new Map<string, Quote>();
  readonly receipts = new Map<string, Receipt>();
  readonly approvals = new Map<ApprovalId, ApprovalTicket>();
  readonly pending = new Map<ApprovalId, Command>();
  readonly nonces = new Set<string>();
  readonly spentByIntent = new Map<MandateId, number>();
  readonly occurrences = new Map<MandateId, number>();
  readonly lastOccurrence = new Map<MandateId, Instant>();
  readonly consumedQuotes = new Set<string>();
  readonly withdrawnQuotes = new Set<string>();
  readonly closedRfqs = new Set<string>();
  readonly revokedIntents = new Set<MandateId>();
  readonly revokedCarts = new Set<MandateId>();
  readonly revokedPayments = new Set<MandateId>();
  readonly reservedQuotes = new Map<string, ApprovalId>();
  readonly settleEvents: { at: string; volume: number }[] = [];
  dailySpend = 0;
  dailyLimit: number;
  readonly decisions: { at: string; type: CommandType; decision: PolicyDecision }[] = [];
  readonly journals: JournalEntry[] = [];
  readonly story: StoryBeat[] = [];
  readonly clearing = new ExposureBook();
  readonly kya = new DelegationGraph();
  readonly killSwitchTested = new Set<AgentId>();
  readonly idempotency = new Map<string, DispatchResult>();
  readonly subscriptions = new Map<SubscriptionId, HostSubscription>();
  readonly invoices = new Map<string, OperatorInvoice>();
  circuitTripped = false;
  tldr = IDLE_TLDR;
  analogDoc: Analog = analog();
  readonly genesisNonce: string;
  readonly hosted: boolean;
  readonly hostedMonthly: number | null;
  readonly dataDir?: string;
  private readonly worldPath?: string;

  constructor(opts: {
    startIso: string;
    genesisNonce: string;
    dailyLimit?: number;
    auditPath?: string;
    ledgerPath?: string;
    dataDir?: string;
    /** Hosted operator. Default is `PROTOCOL.hosted` (false) or the restored world's flag. */
    hosted?: boolean;
    /**
     * Monthly operator price in integer USD_SIM cents. Only listed when `hosted` is true.
     * Public kernel card stays `hostedMonthly: null`. Env: `AETHER_HOSTED_MONTHLY`.
     */
    hostedMonthly?: number;
    /**
     * Pairwise gross credit cap in integer minor units. Default is 50_000_000 ($500,000).
     * A TAP may lower it. Not a Command. Not durable. Public kernel default stays 50_000_000.
     */
    bilateralLimit?: number;
  }) {
    const worldPath = opts.dataDir ? join(opts.dataDir, "world.json") : undefined;
    const existing =
      worldPath && existsSync(worldPath) ? (JSON.parse(readFileSync(worldPath, "utf8")) as WorldState) : undefined;
    this.clock = new ManualClock(existing?.clock ?? opts.startIso);
    this.ids = new IdFactory(this.clock);
    this.genesisNonce = existing?.genesisNonce ?? opts.genesisNonce;
    this.hosted = opts.hosted ?? existing?.hosted ?? PROTOCOL.hosted;
    this.hostedMonthly =
      this.hosted &&
      typeof opts.hostedMonthly === "number" &&
      Number.isSafeInteger(opts.hostedMonthly) &&
      opts.hostedMonthly > 0
        ? opts.hostedMonthly
        : null;
    this.dataDir = opts.dataDir;
    this.worldPath = worldPath;
    if (opts.dataDir) mkdirSync(opts.dataDir, { recursive: true });
    this.audit = new AuditLog(opts.dataDir ? join(opts.dataDir, "audit.jsonl") : opts.auditPath);
    this.ledger = new Ledger(opts.dataDir ? undefined : opts.ledgerPath);
    this.dailyLimit = existing?.dailyLimit ?? opts.dailyLimit ?? 10_000_000;
    if (
      typeof opts.bilateralLimit === "number" &&
      Number.isSafeInteger(opts.bilateralLimit) &&
      opts.bilateralLimit > 0
    ) {
      this.clearing.defaultBilateralLimit = opts.bilateralLimit;
    }
    if (existing) {
      if (existing.auditLength !== this.audit.length) {
        throw new Error(
          `durable world out of sync with audit (world ${existing.auditLength} vs audit ${this.audit.length})`,
        );
      }
      this.hydrateWorld(existing);
      return;
    }
    if (this.audit.length === 0) {
      const g = genesisRecord(this.clock, this.genesisNonce);
      this.audit.append({
        clock: this.clock,
        actorId: "system",
        action: "GENESIS",
        payload: g.payload,
      });
    }
    this.ledger.openAccount({
      id: this.ids.next("acct") as AccountId,
      ownerId: "system",
      name: "system:equity",
      type: "equity",
      currency: "USD_SIM",
    });
    this.ledger.openAccount({
      id: this.ids.next("acct") as AccountId,
      ownerId: "system",
      name: "system:equity_usdc",
      type: "equity",
      currency: "USDC_SIM",
    });
    this.persistWorld();
  }

  keypair(id: AgentId): Ed25519Keypair {
    const k = this.identity.keys.get(id);
    if (!k) throw new Error(`no key for ${id}`);
    return k;
  }

  /** Current signing key, then retired keys. Rotation is not a broken chain. */
  private keyByKid(id: AgentId, kid: string): Ed25519Keypair | undefined {
    const current = this.identity.keys.get(id);
    if (current?.kid === kid) return current;
    return (this.identity.retired.get(id) ?? []).find((k) => k.kid === kid);
  }

  alias(key: string): Agent {
    const id = this.aliases.get(key);
    if (!id) throw new Error(`unknown alias ${key}`);
    return this.identity.require(id);
  }

  /**
   * HTTP/MCP speaker. Omitted actor is system (bootstrap and reads).
   * A registered alias maps to its id. A provided name that is not an alias
   * is that string — `actor.known`, not a silent system.
   */
  speakerOf(input: { actorId?: unknown; actor?: unknown }): AgentId | "system" {
    const actorId = typeof input.actorId === "string" && input.actorId.length > 0 ? input.actorId : undefined;
    const actor = typeof input.actor === "string" && input.actor.length > 0 ? input.actor : undefined;
    if (actorId === "system" || actor === "system") return "system";
    if (actorId) return actorId as AgentId;
    if (actor) {
      const mapped = this.aliases.get(actor);
      if (mapped) return mapped;
      return actor as AgentId;
    }
    return "system";
  }

  merchant(agent: Agent): Merchant {
    return { id: agent.id, name: agent.displayName, website: `https://${agent.role}.aether.test` };
  }

  seedOpening(opening: Record<string, Money>): void {
    const usdLines = [];
    const usdcLines = [];
    for (const [name, money] of Object.entries(opening)) {
      const acct = this.ledger.account(name);
      if (money.currency === "USD_SIM") {
        usdLines.push({ accountId: acct.id, debit: money.amount, credit: 0 });
      } else {
        usdcLines.push({ accountId: acct.id, debit: money.amount, credit: 0 });
      }
    }
    const usdTotal = usdLines.reduce((s, l) => s + l.debit, 0);
    if (usdLines.length) {
      usdLines.push({ accountId: this.ledger.account("system:equity").id, debit: 0, credit: usdTotal });
      this.postJournal("Opening USD cash", usdLines);
    }
    const usdcTotal = usdcLines.reduce((s, l) => s + l.debit, 0);
    if (usdcLines.length) {
      usdcLines.push({ accountId: this.ledger.account("system:equity_usdc").id, debit: 0, credit: usdcTotal });
      this.postJournal("Opening USDC cash", usdcLines);
    }
  }

  dispatch(cmd: Command, opts?: { thresholdWaived?: boolean; skipStep?: boolean }): DispatchResult {
    const key = idempotencyKeyOf(cmd);
    if (key && !opts?.thresholdWaived) {
      // Sweep dead pauses before replay. hire.create is auto-idempotent; a leftover
      // escalate would otherwise return forever and never run expireApprovals.
      this.expireApprovals();
      const hit = this.idempotency.get(key);
      if (hit && this.idempotencyHitStillValid(hit)) {
        const cloned = cloneResult(hit);
        if (cloned.ok) cloned.value.replayed = true;
        return cloned;
      }
    }
    const shape = commandShapeError(cmd.type, cmd.body);
    if (shape) {
      return fail({
        error: err("command.malformed", "Malformed command", 400, shape),
      });
    }
    if (!opts?.skipStep) this.clock.step();
    this.expireApprovals();
    const found =
      cmd.actorId === "system" ? this.systemActor() : this.identity.get(cmd.actorId as AgentId);
    const actor = found ?? this.unknownSpeaker(cmd.actorId as AgentId);
    const ctx = found
      ? this.snapshot(cmd, actor, opts?.thresholdWaived === true)
      : this.unknownActorContext(cmd, actor);
    const decision = evaluate(ctx);
    const rem = remediationFor(decision);
    if (rem) decision.remediation = rem;
    this.decisions.push({ at: this.clock.now(), type: cmd.type, decision });
    this.audit.append({
      clock: this.clock,
      actorId: cmd.actorId,
      action: "POLICY_DECISION",
      subjects: this.decisionSubjects(cmd, ctx),
      payload: { type: cmd.type, verdict: decision.verdict, trace: decision.trace.map((t) => ({ ruleId: t.ruleId, verdict: t.verdict })) },
    });
    try {
      if (decision.verdict === "deny") {
        if (decision.trace.some((t) => t.ruleId === "circuit.daily" && t.verdict === "deny")) {
          this.circuitTripped = true;
        }
        this.pushStory(cmd, actor, decision, ctx);
        const rule = decision.trace.find((t) => t.verdict === "deny");
        const extra = {
          ...(rule?.ruleId ? { ruleId: rule.ruleId } : {}),
          ...(rem ? { remediation: rem } : {}),
        };
        return fail({
          error: err("policy.deny", "Policy deny", 422, rule?.message ?? "denied", extra),
          decision,
        });
      }
      if (decision.verdict === "escalate") {
        this.pushStory(cmd, actor, decision, ctx);
        const ticket = this.openTicket(cmd, decision);
        this.reserveQuote(cmd, ticket.id);
        const result = ok({ kind: "escalated" as const, decision, data: { ticket }, ticket });
        if (key) this.idempotency.set(key, cloneResult(result));
        return result;
      }
      try {
        const data = this.mutate(cmd, actor);
        this.pushStory(cmd, actor, decision, ctx);
        const result = ok({ kind: "allow" as const, decision, data });
        if (key) this.idempotency.set(key, cloneResult(result));
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return fail({
          error: err("mutate", "Mutation failed", message.startsWith("HIRE") ? 409 : 400, message),
          decision,
        });
      }
    } finally {
      this.persistWorld();
    }
  }

  snapshotState() {
    const verify = this.audit.verify();
    return {
      protocol: this.protocolCard(),
      clock: this.clock.now(),
      rail: SIM_RAIL_ID,
      agents: this.identity.all(),
      aliases: Object.fromEntries(this.aliases),
      accounts: [...this.ledger.accounts.values()].map((a) => ({
        ...a,
        balance: this.ledger.balance(a.id),
      })),
      intents: [...this.intents.values()].map((s) => this.intentView(s)),
      spentByIntent: Object.fromEntries(this.spentByIntent),
      carts: [...this.carts.values()].map((c) => this.cartView(c)),
      payments: [...this.payments.values()].map((p) => this.paymentView(p)),
      hires: [...this.hires.values()].map((h) => this.hireView(h)),
      rfqs: [...this.rfqs.values()].map((r) => this.rfqView(r)),
      quotes: [...this.quotes.values()].map((q) => this.quoteView(q)),
      receipts: [...this.receipts.values()],
      approvals: [...this.approvals.values()].map((t) => this.ticketView(t)),
      subscriptions: [...this.subscriptions.values()].map((s) => this.subscriptionView(s)),
      invoices: [...this.invoices.values()].map((i) => this.invoiceView(i)),
      story: this.story,
      analog: this.analogDoc,
      tldr: this.tldr,
      kya: this.kyaSnapshot(),
      circuit: { dailySpend: this.dailySpend, dailyLimit: this.dailyLimit, tripped: this.circuitTripped },
      clearing: this.clearing.snapshot(),
      agentCards: this.identity.all().map((a) => this.agentCard(a)),
      audit: { length: this.audit.length, verify, head: this.audit.head(), tail: this.audit.all().slice(-12) },
      decisions: this.decisions.slice(-40),
    };
  }

  /**
   * Graph view for other agents. Expired hops are `expired`, not `live`.
   * Revoked wins over expired. The pair still occupies until revoke.
   */
  kyaSnapshot() {
    return this.kya.snapshot(this.clock.now());
  }

  /**
   * Pause view for other agents. A ticket past expiresAt is `expired`, not `pending`.
   * A ticket still inside the clock window whose paused command would not allow
   * is `stale`, not `pending`. Approve of that pause is `approval.replay`.
   * Reject still releases the quote. The store may still say pending.
   */
  ticketView(ticket: ApprovalTicket): ApprovalTicket {
    if (ticket.status !== "pending") return ticket;
    if (Date.parse(ticket.expiresAt) <= Date.parse(this.clock.now())) {
      return { ...ticket, status: "expired" };
    }
    if (!this.ticketReplayable(ticket)) {
      return { ...ticket, status: "stale" };
    }
    return ticket;
  }

  /** Same check as approve: waived replay of the held command is still an allow. */
  private ticketReplayable(ticket: ApprovalTicket): boolean {
    const pending = this.pending.get(ticket.id);
    if (!pending) return false;
    const pendingActor =
      pending.actorId === "system" ? this.systemActor() : this.identity.get(pending.actorId as AgentId);
    if (!pendingActor) return false;
    return evaluate(this.snapshot(pending, pendingActor, true)).verdict === "allow";
  }

  /**
   * Hop view for other agents. Same derivation as the graph edges.
   * The store stays raw (expiresAt / revokedAt). Unique_live still occupies.
   */
  hopView(att: DelegationAttestation): DelegationAttestation & { status: KyaHopStatus } {
    return { ...att, status: hopStatus(att, this.clock.now()) };
  }

  /**
   * Quote view for other agents. Spent (consumed) and held (live reserved ticket)
   * win over withdrawn and expired. Withdrawn (folded by market.withdraw) wins over
   * expired. Expired includes the quote envelope, a lapsed FX validUntil,
   * and (for a hire quote) a dead or shut parent RFQ. An FX quote is a window on the quote,
   * not the room. Closing the room does not kill an already-minted FX window.
   * A reservation whose ticket is past expiresAt is not held.
   * The store stays raw (expiresAt / validUntil only).
   */
  quoteView(quote: Quote): Quote & { status: QuoteStatus } {
    if (this.consumedQuotes.has(quote.id)) return { ...quote, status: "spent" };
    const ticketId = this.reservedQuotes.get(quote.id);
    if (ticketId) {
      const ticket = this.approvals.get(ticketId);
      if (
        ticket &&
        ticket.status === "pending" &&
        Date.parse(ticket.expiresAt) > Date.parse(this.clock.now())
      ) {
        return { ...quote, status: "held" };
      }
    }
    if (this.withdrawnQuotes.has(quote.id)) return { ...quote, status: "withdrawn" };
    const now = Date.parse(this.clock.now());
    if (Date.parse(quote.expiresAt) <= now) {
      return { ...quote, status: "expired" };
    }
    if (quote.fx) {
      const until = Date.parse(quote.fx.validUntil);
      if (!Number.isFinite(until) || until <= now) {
        return { ...quote, status: "expired" };
      }
    } else {
      const rfq = this.rfqs.get(quote.rfqId);
      if (!rfq || Date.parse(rfq.expiresAt) <= now || this.closedRfqs.has(rfq.id)) {
        return { ...quote, status: "expired" };
      }
    }
    return { ...quote, status: "live" };
  }

  /**
   * RFQ view for other agents. A shut room is `closed`, not `live`. Closed wins
   * over expired. A room past expiresAt is `expired`, not `live`. The store stays
   * raw (expiresAt only). Quoting or hiring a shut room still names `market.not_expired`.
   */
  rfqView(rfq: Rfq): Rfq & { status: RfqStatus } {
    if (this.closedRfqs.has(rfq.id)) return { ...rfq, status: "closed" };
    if (Date.parse(rfq.expiresAt) <= Date.parse(this.clock.now())) {
      return { ...rfq, status: "expired" };
    }
    return { ...rfq, status: "live" };
  }

  /**
   * Cart view for other agents. A cart whose unique_payment occupies is `bound`,
   * not `live`. Bound wins over revoked and expired. Revoked (torn by
   * mandate.revoke_cart) wins over expired. A hire that points at this cart is not
   * bound — that occupancy lives on the hire (`hire.unique_cart`).
   * The store stays raw (`expiresAt` only).
   */
  cartView(cart: Signed<CartMandate>): Signed<CartMandate> & { status: CartStatus } {
    if (this.occupyingPayment(cart)) return { ...cart, status: "bound" };
    if (this.revokedCarts.has(cart.payload.id)) return { ...cart, status: "revoked" };
    if (Date.parse(cart.payload.expiresAt) <= Date.parse(this.clock.now())) {
      return { ...cart, status: "expired" };
    }
    return { ...cart, status: "live" };
  }

  /**
   * Payment view for other agents. A payment whose hire has moved escrow is
   * `funded`, not `live`. Funded wins over revoked and expired (refunded and
   * released still funded — the mandate was drawn). Revoked (torn by
   * mandate.revoke_payment) wins over expired. Expired includes the payment
   * `exp` and a dead parent cart, even when this check's own window still lives.
   * A cart this payment occupies is not funded — that occupancy lives on the
   * cart (`bound`). The store stays raw (`exp` only).
   */
  paymentView(payment: Signed<PaymentMandate>): Signed<PaymentMandate> & { status: PaymentStatus } {
    if (this.hireDrawnPayment(payment)) return { ...payment, status: "funded" };
    if (this.revokedPayments.has(payment.payload.id)) return { ...payment, status: "revoked" };
    if (payment.payload.exp <= unixSeconds(this.clock.now())) {
      return { ...payment, status: "expired" };
    }
    const cart = this.cartMatchingPayment(payment);
    if (!cart || Date.parse(cart.payload.expiresAt) <= Date.parse(this.clock.now())) {
      return { ...payment, status: "expired" };
    }
    return { ...payment, status: "live" };
  }

  /**
   * Intent view for other agents. A slip whose hire has moved escrow is
   * `funded`, not `live`. Funded wins over revoked and expired (refunded and
   * released still funded — the slip was drawn). Revoked (torn by mandate.revoke)
   * wins over expired. Expired includes the slip `exp` and a dead parent intent,
   * even when this child's own window still lives. A child hire does not occupy
   * the parent. Recurrence spend is not occupancy. The store stays raw (`exp` only).
   */
  intentView(intent: Signed<IntentMandate>): Signed<IntentMandate> & { status: IntentStatus } {
    if (this.hireDrawnIntent(intent)) return { ...intent, status: "funded" };
    if (this.revokedIntents.has(intent.payload.id)) return { ...intent, status: "revoked" };
    if (intent.payload.exp <= unixSeconds(this.clock.now())) {
      return { ...intent, status: "expired" };
    }
    if (intent.payload.parentId) {
      const parent = this.intents.get(intent.payload.parentId);
      if (!parent || parent.payload.exp <= unixSeconds(this.clock.now()) || this.revokedIntents.has(parent.payload.id)) {
        return { ...intent, status: "expired" };
      }
    }
    return { ...intent, status: "live" };
  }

  /**
   * Hire view for other agents. Funded (escrow moved, including later
   * refund/release/deliver) wins over expired. Expired includes a dead intent
   * and a dead parent intent even when this child's `exp` still lives. `void`
   * is not a live offer. The store stays raw (`state` only).
   */
  hireView(hire: HireContract): HireContract & { status: HireStatus } {
    if (
      hire.state === "funded" ||
      hire.state === "delivered" ||
      hire.state === "released" ||
      hire.state === "refunded"
    ) {
      return { ...hire, status: "funded" };
    }
    if (hire.state === "void") return { ...hire, status: "expired" };
    if (this.intentSlipLive(this.intents.get(hire.intentId))) return { ...hire, status: "live" };
    return { ...hire, status: "expired" };
  }

  /**
   * Subscription view for other agents. A row whose slip died is `expired`,
   * not live enrollment. Unique_subscriber still occupies. Spend is not gated
   * on the row. The store stays raw.
   */
  subscriptionView(row: HostSubscription): HostSubscription & { status: SubscriptionStatus } {
    if (this.intentSlipLive(this.intents.get(row.intentId))) return { ...row, status: "live" };
    return { ...row, status: "expired" };
  }

  /** Intent still in its own window, not torn, and parent (if any) still in its window. */
  private intentSlipLive(intent: Signed<IntentMandate> | undefined): boolean {
    if (!intent) return false;
    if (this.revokedIntents.has(intent.payload.id)) return false;
    if (intent.payload.exp <= unixSeconds(this.clock.now())) return false;
    if (intent.payload.parentId) {
      const parent = this.intents.get(intent.payload.parentId);
      if (!parent || parent.payload.exp <= unixSeconds(this.clock.now()) || this.revokedIntents.has(parent.payload.id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Invoice view for other agents. Current is inside the 31-day door window.
   * The store stays raw (`at` only). The door asks whether any invoice is current.
   */
  invoiceView(row: OperatorInvoice): OperatorInvoice & { status: InvoiceStatus } {
    const age = Date.parse(this.clock.now()) - Date.parse(row.at);
    if (!Number.isFinite(age) || age > HOST_INVOICE_WINDOW_MS) {
      return { ...row, status: "lapsed" };
    }
    return { ...row, status: "current" };
  }

  /**
   * How another agent finds this runtime. Not an A2A JSON-RPC server.
   * HTTP well-known and MCP `aether://agent-card` share this object.
   */
  discoveryCard(baseUrl?: string) {
    const pin = this.protocolCard();
    return {
      spec: PROTOCOL.spec,
      protocolVersion: PROTOCOL.version,
      name: "Aether Economic Runtime",
      description:
        "Policy, mandate, hire, escrow, settlement, and audit for software agents. Simulated rail sim:aether-1. Not a storefront.",
      ...(baseUrl && baseUrl.length > 0 ? { url: baseUrl } : {}),
      version: PROTOCOL.version,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        liveMoney: pin.liveMoney,
        evaluateLlm: pin.evaluateLlm,
        hosted: pin.hosted,
      },
      skills: [
        {
          id: "protocol",
          name: "Host card",
          description:
            "GET /v1/protocol and GET /.well-known/aether.json — pin aether.protocol.1. liveMoney false. evaluateLlm false. Public kernel hosted false.",
        },
        {
          id: "commands",
          name: "Command bus",
          description:
            "GET /v1/commands — JSON Schema for every CommandType. POST /v1/commands — every CommandType on the same bus as MCP. REST aliases are convenience.",
        },
        {
          id: "inspect",
          name: "Fetch one object",
          description:
            "aether_get / GET /v1/objects/:id. An offered hire whose slip died is expired, not live. An hsb_ row whose slip died is expired, not live enrollment.",
        },
        {
          id: "sprint-procurement",
          name: "Sprint Procurement TAP",
          description: "POST /v1/demo/sprint-procurement — conformance, not a storefront",
        },
        {
          id: "night-watch",
          name: "Night Watch TAP",
          description: "POST /v1/demo/night-watch — standing mandate, KYA, circuit breaker",
        },
        {
          id: "sub-hire",
          name: "Sub-hire TAP",
          description: "POST /v1/demo/sub-hire — L4 nested slips, parent budget, child handshake",
        },
        {
          id: "clearing-window",
          name: "Clearing window TAP",
          description: "POST /v1/demo/clearing — bilateral credit, settlement photo, not a second payment",
        },
        {
          id: "refund-unwind",
          name: "Refund TAP",
          description: "POST /v1/demo/refund — unwind funded escrow; quote stays spent; circuit stays sticky",
        },
        {
          id: "replay-once",
          name: "Replay TAP",
          description: "POST /v1/demo/replay — a retry of an allow is not a second spend",
        },
        {
          id: "envelope-nonce",
          name: "Envelope nonce TAP",
          description: "POST /v1/demo/nonce — a payment nonce is one-shot; a leftover nonce on a transfer is not",
        },
        {
          id: "deny-cache",
          name: "Deny-cache TAP",
          description: "POST /v1/demo/deny — a deny is never a cached success",
        },
        {
          id: "recurrence-cadence",
          name: "Recurrence TAP",
          description: "POST /v1/demo/recurrence — a one-slot cadence is not an open checkbook",
        },
        {
          id: "execution-window",
          name: "Calendar TAP",
          description: "POST /v1/demo/calendar — a closed calendar is not a freeze on funded work",
        },
        {
          id: "cadence-slot",
          name: "Slot TAP",
          description: "POST /v1/demo/slot — a refund does not restore a cadence slot",
        },
        {
          id: "daily-gap",
          name: "Daily TAP",
          description: "POST /v1/demo/daily — a cadence is a gap, not a burst",
        },
        {
          id: "cart-occupancy",
          name: "Cart occupancy TAP",
          description: "POST /v1/demo/cart — occupancy is a bind, not a field on fund",
        },
        {
          id: "hot-hour",
          name: "Velocity TAP",
          description: "POST /v1/demo/velocity — a hot hour is not a freeze on funded work",
        },
        {
          id: "operator-door",
          name: "Operator door TAP",
          description: "POST /v1/demo/door — the public kernel is not a hosted checkout",
        },
        {
          id: "cart-match",
          name: "Cart match TAP",
          description: "POST /v1/demo/match — a cheaper cart is not a discount",
        },
        {
          id: "closed-room",
          name: "Closed room TAP",
          description: "POST /v1/demo/room — a closed room is not a bulletin board",
        },
        {
          id: "fx-not-hire",
          name: "Conversion TAP",
          description: "POST /v1/demo/conversion — an FX window is not a hire",
        },
        {
          id: "unique-live",
          name: "Unique-live TAP",
          description: "POST /v1/demo/pair — a second live hop is not a tighter grant",
        },
        {
          id: "spread-bound",
          name: "Spread TAP",
          description: "POST /v1/demo/band — a 200bps band is not decoration",
        },
        {
          id: "parent-fresh",
          name: "Nest TAP",
          description: "POST /v1/demo/nest — a nested hop does not outlive its parent",
        },
        {
          id: "mandate-parent",
          name: "Heir TAP",
          description: "POST /v1/demo/heir — a dead parent is not a parent",
        },
        {
          id: "mm-inventory",
          name: "Stock TAP",
          description: "POST /v1/demo/stock — empty MM USDC is not a missing maker",
        },
        {
          id: "payment-budget",
          name: "Purse TAP",
          description: "POST /v1/demo/purse — a budget is not an item cap",
        },
        {
          id: "unique-subscriber",
          name: "Seat TAP",
          description: "POST /v1/demo/seat — one subscriber is one row",
        },
        {
          id: "parent-budget",
          name: "Cover TAP",
          description: "POST /v1/demo/cover — a parent envelope is not a child's leftover",
        },
        {
          id: "operating-book",
          name: "Mint TAP",
          description: "POST /v1/demo/mint — a transfer is not a mint",
        },
        {
          id: "allowed-payees",
          name: "Payee TAP",
          description: "POST /v1/demo/payee — a listed payee is not any registered vendor",
        },
        {
          id: "capability-subset",
          name: "Climb TAP",
          description: "POST /v1/demo/climb — a climb is not a wider handshake",
        },
        {
          id: "fx-fresh",
          name: "Born TAP",
          description: "POST /v1/demo/born — an FX window cannot be born dead",
        },
        {
          id: "window-reach",
          name: "Reach TAP",
          description: "POST /v1/demo/reach — a window that opens after the slip dies is not a window",
        },
        {
          id: "kya-window",
          name: "Year TAP",
          description: "POST /v1/demo/year — a handshake cannot outlive one year",
        },
        {
          id: "circuit-daily",
          name: "Fuse TAP",
          description: "POST /v1/demo/fuse — a daily fuse is not a freeze on funded work",
        },
        {
          id: "allowed-skus",
          name: "SKU TAP",
          description: "POST /v1/demo/sku — a listed SKU is not any catalog good",
        },
        {
          id: "sku-currency",
          name: "Priced TAP",
          description: "POST /v1/demo/priced — a listed SKU is only priced in a currency the catalog names",
        },
        {
          id: "hire-party",
          name: "Party TAP",
          description: "POST /v1/demo/party — the other side of the table is not a party",
        },
        {
          id: "ledger-sufficient",
          name: "Cash TAP",
          description: "POST /v1/demo/cash — empty cash is not a negative book",
        },
        {
          id: "not-expired",
          name: "Stale TAP",
          description: "POST /v1/demo/stale — a stale quote is not a hire",
        },
        {
          id: "chain-integrity",
          name: "Chain TAP",
          description: "POST /v1/demo/chain — a dead cart is not a check",
        },
        {
          id: "hire-state",
          name: "Arrow TAP",
          description: "POST /v1/demo/arrow — unfinished work is not a payout",
        },
        {
          id: "ledger-known",
          name: "Wallet TAP",
          description: "POST /v1/demo/wallet — a vendor's USD cash is not a USDC wallet",
        },
        {
          id: "kya-party",
          name: "Name TAP",
          description: "POST /v1/demo/name — someone else's name is not a handshake",
        },
        {
          id: "fx-window",
          name: "Pane TAP",
          description: "POST /v1/demo/pane — an FX SKU is a window, not a good",
        },
        {
          id: "intent-subject",
          name: "Subject TAP",
          description: "POST /v1/demo/subject — this slip is not yours to spend",
        },
        {
          id: "fx-quote",
          name: "Paper TAP",
          description: "POST /v1/demo/paper — a research quote is not a conversion window",
        },
        {
          id: "same-currency",
          name: "Mix TAP",
          description: "POST /v1/demo/mix — a mixed journal is not a conversion",
        },
        {
          id: "ladder-legal",
          name: "Rung TAP",
          description: "POST /v1/demo/rung — a skipped rung is not a promotion",
        },
        {
          id: "min-level",
          name: "Grade TAP",
          description: "POST /v1/demo/grade — a junior desk is not a nested-slip mint",
        },
        {
          id: "birth-rung",
          name: "Cradle TAP",
          description: "POST /v1/demo/cradle — L5 is not a birthright",
        },
        {
          id: "max-autonomy",
          name: "Ceiling TAP",
          description: "POST /v1/demo/ceiling — a climb is not a wider slip",
        },
        {
          id: "attestation-fresh",
          name: "Lapse TAP",
          description: "POST /v1/demo/lapse — an expired hop is not a freeze on funded work",
        },
        {
          id: "approval-pending",
          name: "Pause TAP",
          description: "POST /v1/demo/pause — a dead pause is not a late yes",
        },
        {
          id: "not-self",
          name: "Mirror TAP",
          description: "POST /v1/demo/mirror — a handshake is not a mirror",
        },
        {
          id: "human-authority",
          name: "Warrant TAP",
          description: "POST /v1/demo/warrant — an agent-issued slip is not host authority",
        },
        {
          id: "occurrence-fresh",
          name: "Vacant TAP",
          description: "POST /v1/demo/vacant — a cadence with no slots is not a cadence",
        },
        {
          id: "role-capability",
          name: "Badge TAP",
          description: "POST /v1/demo/badge — a badge is not a shopping pass",
        },
        {
          id: "amount-range",
          name: "Lid TAP",
          description: "POST /v1/demo/lid — an item cap is not an envelope",
        },
        {
          id: "escrow-required",
          name: "Bare TAP",
          description: "POST /v1/demo/bare — unfunded work is not a delivery",
        },
        {
          id: "known-sku",
          name: "Shelf TAP",
          description: "POST /v1/demo/shelf — a ghost SKU is not a catalog good",
        },
        {
          id: "known-rfq",
          name: "Hall TAP",
          description: "POST /v1/demo/hall — a missing room is not a missing SKU",
        },
        {
          id: "known-intent",
          name: "Writ TAP",
          description: "POST /v1/demo/writ — a missing slip is not a missing handshake",
        },
        {
          id: "known-cart",
          name: "Crate TAP",
          description: "POST /v1/demo/crate — a missing cart is not a broken payment chain",
        },
        {
          id: "known-hire",
          name: "Pact TAP",
          description: "POST /v1/demo/pact — a missing contract is not a broken mandate chain",
        },
        {
          id: "known-parent",
          name: "Root TAP",
          description: "POST /v1/demo/root — a missing parent is not a tighter child",
        },
        {
          id: "known-approval",
          name: "Docket TAP",
          description: "POST /v1/demo/docket — a missing ticket is not a late yes",
        },
        {
          id: "kya-known-parent",
          name: "Graft TAP",
          description: "POST /v1/demo/graft — a missing hop parent is not a nested handshake",
        },
        {
          id: "known-attestation",
          name: "Seal TAP",
          description: "POST /v1/demo/seal — a missing handshake is not a silent tombstone",
        },
        {
          id: "known-invitee",
          name: "Guest TAP",
          description: "POST /v1/demo/guest — a missing invitee is not a closed room",
        },
        {
          id: "cart-fresh",
          name: "Dust TAP",
          description: "POST /v1/demo/dust — a stale unpaid cart is not a late check",
        },
        {
          id: "freeze-state",
          name: "Thaw TAP",
          description: "POST /v1/demo/thaw — a no-op thaw is not a kill-switch test",
        },
        {
          id: "unique-key",
          name: "Twin TAP",
          description: "POST /v1/demo/twin — a taken alias is not a second agent",
        },
        {
          id: "system-scope",
          name: "Fence TAP",
          description: "POST /v1/demo/fence — system is not a treasurer",
        },
        {
          id: "actor-known",
          name: "Mute TAP",
          description: "POST /v1/demo/mute — a missing speaker is not a 500",
        },
        {
          id: "receipt-known",
          name: "Nil TAP",
          description: "POST /v1/demo/nil — a missing receipt is not an empty success",
        },
        {
          id: "kya-mint-fresh",
          name: "Spark TAP",
          description: "POST /v1/demo/spark — a handshake cannot be born dead",
        },
        {
          id: "window-fresh",
          name: "Wilt TAP",
          description: "POST /v1/demo/wilt — a permission slip cannot be born with a closed calendar",
        },
        {
          id: "mm-known",
          name: "Maker TAP",
          description: "POST /v1/demo/maker — a window is not a journal against nobody",
        },
        {
          id: "currency-match",
          name: "Ink TAP",
          description: "POST /v1/demo/ink — a cart label is not the hire's money",
        },
        {
          id: "safe-balance",
          name: "Brim TAP",
          description: "POST /v1/demo/brim — IEEE rounding is not a mint",
        },
        {
          id: "fx-pair",
          name: "Swap TAP",
          description: "POST /v1/demo/swap — a swapped pair is not a silent journal of the books this rail actually posts",
        },
        {
          id: "approval-replay",
          name: "Sour TAP",
          description: "POST /v1/demo/sour — a grown-up yes is not a late hire",
        },
        {
          id: "chain-intact",
          name: "Cut TAP",
          description: "POST /v1/demo/cut — a revoke is not an expiry",
        },
        {
          id: "principal-not-frozen",
          name: "Ice TAP",
          description: "POST /v1/demo/ice — a frozen principal is not a frozen desk",
        },
        {
          id: "allowed-instruments",
          name: "Rail TAP",
          description: "POST /v1/demo/rail — a listed rail is not decoration",
        },
        {
          id: "human-signature",
          name: "Pen TAP",
          description: "POST /v1/demo/pen — a junior signature is not a grown-up pause",
        },
        {
          id: "delegation-depth",
          name: "Well TAP",
          description: "POST /v1/demo/well — a fourth hop is not a nested parent",
        },
        {
          id: "payment-reference",
          name: "Cite TAP",
          description: "POST /v1/demo/cite — a listed reference is not decoration once a check exists",
        },
        {
          id: "identity-party",
          name: "Lock TAP",
          description: "POST /v1/demo/lock — someone else's key is not yours to turn",
        },
        {
          id: "hire-void",
          name: "Void TAP",
          description: "POST /v1/demo/void — a void is not a refund",
        },
        {
          id: "market-party",
          name: "Fold TAP",
          description: "POST /v1/demo/fold — someone else's bid is not yours to pull",
        },
        {
          id: "mandate-party",
          name: "Rip TAP",
          description: "POST /v1/demo/rip — someone else's unused slip is not yours to tear",
        },
        {
          id: "rfq-party",
          name: "Shut TAP",
          description: "POST /v1/demo/shut — someone else's room is not yours to close",
        },
        {
          id: "cart-party",
          name: "Dump TAP",
          description: "POST /v1/demo/dump — someone else's unused checkout is not yours to dump",
        },
        {
          id: "payment-party",
          name: "Spike TAP",
          description: "POST /v1/demo/spike — someone else's unused payment is not yours to spike",
        },
        {
          id: "cadence-reach",
          name: "Week TAP",
          description: "POST /v1/demo/week — a week is not a cadence on a seven-day slip",
        },
        {
          id: "range-fresh",
          name: "Gulf TAP",
          description: "POST /v1/demo/gulf — a floor above the lid is not a range",
        },
        {
          id: "budget-fresh",
          name: "Coffer TAP",
          description: "POST /v1/demo/coffer — a closed coffer is not a budget",
        },
        {
          id: "currency-fresh",
          name: "Clash TAP",
          description: "POST /v1/demo/clash — a USDC coffer on a USD lid is not a budget",
        },
        {
          id: "hatch-fresh",
          name: "Hatch TAP",
          description: "POST /v1/demo/hatch — a closed hatch is not a range",
        },
      ],
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
      pin,
    };
  }

  protocolCard() {
    return {
      ...PROTOCOL,
      hosted: this.hosted,
      durable: Boolean(this.worldPath),
      dataDir: this.dataDir ?? null,
      clock: this.clock.now(),
      auditHead: this.audit.head(),
      auditLength: this.audit.length,
      discovery: {
        wellKnown: "/.well-known/aether.json",
        protocol: "/v1/protocol",
        commands: "/v1/commands",
        mcp: "aether://protocol",
      },
      pricing: {
        currency: "USD_SIM" as const,
        selfHost: { amount: 0 },
        hostedMonthly: this.hostedMonthly !== null ? { amount: this.hostedMonthly } : null,
        ...(this.hosted ? { takeRate: null as const } : {}),
      },
      authority: {
        bootstrap: "human_operator" as const,
        subscribe: "host.subscribe" as const,
        subscribeAvailable: this.hosted,
        ...(this.hosted
          ? {
              speakerProof: "ed25519" as const,
              invoice: "host.invoice" as const,
              liveMoneyOnThisHost: false as const,
            }
          : {}),
      },
    };
  }

  /**
   * Fetch one object by id (or alias). Prefix selects the table:
   * aid_ agent, hid_ hire (derived live | expired | funded; funded is escrow-moved
   * occupancy and wins over expired; expired includes a dead intent and a dead parent
   * intent even when the child's exp still lives), mid_ mandate (intents include
   * derived live | expired | funded | revoked; funded is escrow-moved occupancy against this
   * slip and wins over revoked and expired; revoked wins over expired; expired includes a dead parent intent even when this
   * child's `exp` still lives; a child hire does not occupy the parent;
   * carts include derived live | expired | bound | revoked;
   * bound is unique_payment occupancy and wins over revoked and expired;
   * revoked wins over expired; payments include derived
   * live | expired | funded | revoked; funded is escrow-moved occupancy and wins
   * over revoked and expired; revoked wins over expired;
   * expired includes a dead parent cart even when the payment `exp` still lives),
   * rid_ receipt, apd_ approval (pending | expired | stale; stale is a pause whose
   * held command would not allow; the store stays pending; time-expired wins),
     * rfq_ / qte_ market (rfq_ includes derived live | expired;
     * qte_ includes derived live | expired | spent | held | withdrawn;
     * expired includes a lapsed FX validUntil and, for a hire quote, a dead parent RFQ;
     * spent and held win over withdrawn and expired; withdrawn wins over expired), acct_ / name account, dlg_ KYA hop (derived live | expired | revoked; pins an iss_ issuer object),
   * iss_ KYA issuer (shape-only catalog; adapter shape; live false; credentials never stored),
   * hsb_ host subscription (derived live | expired; expired includes a dead intent
   * and a dead parent intent; unique_subscriber still occupies; spend is not gated
   * on the row; the store stays raw),
   * inv_ operator invoice (derived current | lapsed; the store stays raw).
   */
  inspect(id: string): { type: string; id: string; value: unknown } | undefined {
    const alias = this.aliases.get(id);
    if (alias) return this.inspect(alias);
    if (id.startsWith("aid_")) {
      const agent = this.identity.get(id as AgentId);
      return agent ? { type: "agent", id: agent.id, value: agent } : undefined;
    }
    if (id.startsWith("hid_")) {
      const hire = this.hires.get(id as HireId);
      return hire ? { type: "hire", id: hire.id, value: this.hireView(hire) } : undefined;
    }
    if (id.startsWith("mid_")) {
      const intent = this.intents.get(id as MandateId);
      if (intent) return { type: "intent", id, value: this.intentView(intent) };
      const cart = this.carts.get(id as MandateId);
      if (cart) return { type: "cart", id, value: this.cartView(cart) };
      const payment = this.payments.get(id as MandateId);
      if (payment) return { type: "payment", id, value: this.paymentView(payment) };
      return undefined;
    }
    if (id.startsWith("rid_")) {
      const receipt = this.receipts.get(id);
      return receipt ? { type: "receipt", id: receipt.id, value: receipt } : undefined;
    }
    if (id.startsWith("apd_")) {
      const ticket = this.approvals.get(id as ApprovalId);
      return ticket ? { type: "approval", id: ticket.id, value: this.ticketView(ticket) } : undefined;
    }
    if (id.startsWith("rfq_")) {
      const rfq = this.rfqs.get(id);
      return rfq ? { type: "rfq", id: rfq.id, value: this.rfqView(rfq) } : undefined;
    }
    if (id.startsWith("qte_")) {
      const quote = this.quotes.get(id);
      return quote ? { type: "quote", id: quote.id, value: this.quoteView(quote) } : undefined;
    }
    if (id.startsWith("dlg_")) {
      const att = this.kya.attestations.get(id as DelegationId);
      return att ? { type: "delegation", id: att.id, value: this.hopView(att) } : undefined;
    }
    if (id.startsWith("iss_")) {
      const issuer = this.kya.issuers.get(id as IssuerId);
      return issuer ? { type: "issuer", id: issuer.id, value: issuer } : undefined;
    }
    if (id.startsWith("hsb_")) {
      const sub = this.subscriptions.get(id as SubscriptionId);
      return sub ? { type: "subscription", id: sub.id, value: this.subscriptionView(sub) } : undefined;
    }
    if (id.startsWith("inv_")) {
      const invoice = this.invoices.get(id);
      return invoice ? { type: "invoice", id: invoice.id, value: this.invoiceView(invoice) } : undefined;
    }
    if (id.startsWith("acct_")) {
      const account = [...this.ledger.accounts.values()].find((a) => a.id === id);
      return account
        ? { type: "account", id: account.id, value: { ...account, balance: this.ledger.balance(account.id) } }
        : undefined;
    }
    try {
      const account = this.ledger.account(id);
      return { type: "account", id: account.id, value: { ...account, balance: this.ledger.balance(account.id) } };
    } catch {
      return undefined;
    }
  }

  agentCard(agent: Agent) {
    return {
      protocolVersion: PROTOCOL.version,
      name: agent.displayName,
      description: `${agent.role} on Aether sim:aether-1`,
      url: `http://127.0.0.1:8787/v1/agents/${agent.id}`,
      did: agent.did,
      role: agent.role,
      autonomyLevel: agent.autonomyLevel,
      frozen: agent.frozen,
      skills: skillsFor(agent.role),
    };
  }

  tell(beat: Omit<StoryBeat, "seq" | "at">): StoryBeat {
    const full: StoryBeat = { ...beat, seq: this.story.length, at: this.clock.now() };
    this.story.push(full);
    return full;
  }

  captureWorld(): WorldState {
    const keys = [
      ...[...this.identity.keys.values()].map((kp) => exportKeypair(kp)),
      ...[...this.identity.retired.values()].flat().map((kp) => exportKeypair(kp)),
    ];
    return {
      v: WORLD_VERSION,
      spec: "aether.protocol.1",
      clock: this.clock.now(),
      genesisNonce: this.genesisNonce,
      idSeq: this.ids.seq,
      dailyLimit: this.dailyLimit,
      dailySpend: this.dailySpend,
      circuitTripped: this.circuitTripped,
      tldr: this.tldr,
      analog: this.analogDoc,
      auditLength: this.audit.length,
      auditHead: String(this.audit.head()),
      agents: this.identity.all(),
      keys,
      aliases: Object.fromEntries(this.aliases),
      accounts: [...this.ledger.accounts.values()],
      journals: [...this.ledger.entries],
      intents: [...this.intents.values()],
      carts: [...this.carts.values()],
      payments: [...this.payments.values()],
      hires: [...this.hires.values()],
      rfqs: [...this.rfqs.values()],
      quotes: [...this.quotes.values()],
      receipts: [...this.receipts.values()],
      approvals: [...this.approvals.values()],
      pending: [...this.pending.entries()],
      nonces: [...this.nonces],
      spentByIntent: [...this.spentByIntent.entries()],
      occurrences: [...this.occurrences.entries()],
      lastOccurrence: [...this.lastOccurrence.entries()],
      consumedQuotes: [...this.consumedQuotes],
      withdrawnQuotes: [...this.withdrawnQuotes],
      closedRfqs: [...this.closedRfqs],
      revokedIntents: [...this.revokedIntents],
      revokedCarts: [...this.revokedCarts],
      revokedPayments: [...this.revokedPayments],
      reservedQuotes: [...this.reservedQuotes.entries()],
      settledFxQuotes: [...this.consumedQuotes],
      settleEvents: [...this.settleEvents],
      decisions: [...this.decisions],
      story: [...this.story],
      kya: { attestations: [...this.kya.attestations.values()], blocked: [...this.kya.blocked], issuers: [...this.kya.issuers.values()] },
      clearing: { legs: this.clearing.snapshot().legs, windows: this.clearing.snapshot().windows },
      killSwitchTested: [...this.killSwitchTested],
      idempotency: [...this.idempotency.entries()],
      hosted: this.hosted,
      subscriptions: [...this.subscriptions.values()],
      operatorInvoices: [...this.invoices.values()],
    };
  }

  persistWorld(): void {
    if (!this.worldPath) return;
    const tmp = `${this.worldPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.captureWorld()));
    renameSync(tmp, this.worldPath);
  }

  /**
   * Record that a human paid this operator off-band. Not a Command. Not a spend gate.
   * Public kernel refuses. Spend against a hire still does not read invoices.
   */
  recordHostInvoice(
    actorId: AgentId,
    body: { method?: unknown; reference?: unknown },
  ): Result<OperatorInvoice, AetherError> {
    if (!this.hosted) {
      return fail(err("host.not_hosted", "Not a hosted operator", 422, "public kernel does not invoice"));
    }
    if (this.hostedMonthly === null) {
      return fail(err("host.unpaid", "Host invoice required", 400, "this host has no monthly price"));
    }
    const agent = this.identity.get(actorId);
    if (!agent || (agent.role !== "human_operator" && agent.role !== "treasury")) {
      return fail(
        err("host.human_authority", "Human authority required", 422, "only a human or treasury invoices this host"),
      );
    }
    const method = body.method === "stripe" ? "stripe" : body.method === "invoice" ? "invoice" : undefined;
    if (!method) {
      return fail(err("command.malformed", "Malformed command", 400, "method must be invoice or stripe"));
    }
    this.clock.step();
    const row: OperatorInvoice = {
      id: this.ids.next("inv"),
      at: this.clock.now(),
      amount: this.hostedMonthly,
      currency: "USD_SIM",
      method,
      actorId,
    };
    if (typeof body.reference === "string" && body.reference.length > 0) {
      row.reference = body.reference;
    }
    this.invoices.set(row.id, row);
    this.audit.append({
      clock: this.clock,
      actorId,
      action: "HOST_INVOICE",
      subjects: [
        { type: "invoice", id: row.id },
        { type: "agent", id: actorId },
      ],
      payload: { id: row.id, amount: row.amount, method: row.method },
    });
    this.persistWorld();
    return ok(row);
  }

  private hydrateWorld(world: WorldState): void {
    if (world.v !== WORLD_VERSION) throw new Error(`unsupported world version ${world.v}`);
    this.clock.set(world.clock);
    this.ids.setSeq(world.idSeq);
    this.dailyLimit = world.dailyLimit;
    this.dailySpend = world.dailySpend;
    this.circuitTripped = world.circuitTripped;
    this.tldr = world.tldr;
    this.analogDoc = world.analog;
    this.ledger.restore(world.accounts, world.journals);
    this.journals.splice(0, this.journals.length, ...world.journals);
    this.identity.agents.clear();
    this.identity.byDid.clear();
    this.identity.keys.clear();
    this.identity.retired.clear();
    const keyByKid = new Map(world.keys.map((k) => [k.kid, k]));
    for (const agent of world.agents) {
      const kid = agent.keys[0]?.kid;
      const exported = kid ? keyByKid.get(kid) : undefined;
      if (!exported) throw new Error(`missing key for ${agent.id}`);
      this.identity.register(agent, importKeypair(exported));
      const rest: Ed25519Keypair[] = [];
      for (const ref of agent.keys.slice(1)) {
        const raw = keyByKid.get(ref.kid);
        if (!raw) throw new Error(`missing retired key ${ref.kid}`);
        rest.push(importKeypair(raw));
      }
      if (rest.length > 0) this.identity.retired.set(agent.id, rest);
    }
    this.aliases.clear();
    for (const [k, v] of Object.entries(world.aliases)) this.aliases.set(k, v);
    this.intents.clear();
    for (const s of world.intents) this.intents.set(s.payload.id, s);
    this.carts.clear();
    for (const s of world.carts) this.carts.set(s.payload.id, s);
    this.payments.clear();
    for (const s of world.payments) this.payments.set(s.payload.id, s);
    this.hires.clear();
    for (const h of world.hires) this.hires.set(h.id, h);
    this.rfqs.clear();
    for (const r of world.rfqs) this.rfqs.set(r.id, r);
    this.quotes.clear();
    for (const q of world.quotes) this.quotes.set(q.id, q);
    this.receipts.clear();
    for (const r of world.receipts) this.receipts.set(r.id, r);
    this.approvals.clear();
    for (const a of world.approvals) this.approvals.set(a.id, a);
    this.pending.clear();
    for (const [id, cmd] of world.pending) this.pending.set(id, cmd);
    this.nonces.clear();
    for (const n of world.nonces) this.nonces.add(n);
    this.spentByIntent.clear();
    for (const [id, n] of world.spentByIntent) this.spentByIntent.set(id, n);
    this.occurrences.clear();
    for (const [id, n] of world.occurrences) this.occurrences.set(id, n);
    this.lastOccurrence.clear();
    for (const [id, at] of world.lastOccurrence ?? []) this.lastOccurrence.set(id, at);
    this.consumedQuotes.clear();
    for (const id of world.consumedQuotes ?? []) this.consumedQuotes.add(id);
    for (const id of world.settledFxQuotes ?? []) this.consumedQuotes.add(id);
    this.withdrawnQuotes.clear();
    for (const id of world.withdrawnQuotes ?? []) this.withdrawnQuotes.add(id);
    this.closedRfqs.clear();
    for (const id of world.closedRfqs ?? []) this.closedRfqs.add(id);
    this.revokedIntents.clear();
    for (const id of world.revokedIntents ?? []) this.revokedIntents.add(id);
    this.revokedCarts.clear();
    for (const id of world.revokedCarts ?? []) this.revokedCarts.add(id);
    this.revokedPayments.clear();
    for (const id of world.revokedPayments ?? []) this.revokedPayments.add(id);
    this.reservedQuotes.clear();
    for (const [quoteId, ticketId] of world.reservedQuotes ?? []) {
      this.reservedQuotes.set(quoteId, ticketId as ApprovalId);
    }
    this.settleEvents.splice(0, this.settleEvents.length, ...world.settleEvents);
    this.decisions.splice(0, this.decisions.length, ...world.decisions);
    this.story.splice(0, this.story.length, ...world.story);
    this.kya.restore(world.kya);
    this.clearing.restore(world.clearing);
    this.killSwitchTested.clear();
    for (const id of world.killSwitchTested) this.killSwitchTested.add(id);
    this.idempotency.clear();
    for (const [k, v] of world.idempotency ?? []) this.idempotency.set(k, v as DispatchResult);
    this.subscriptions.clear();
    for (const s of world.subscriptions ?? []) this.subscriptions.set(s.id, s);
    this.invoices.clear();
    for (const inv of world.operatorInvoices ?? []) this.invoices.set(inv.id, inv);
  }

  private systemActor(): Agent {
    return {
      id: "aid_00000000000000000000000000" as AgentId,
      did: "did:aether:system",
      displayName: "system",
      role: "treasury",
      autonomyLevel: 5,
      keys: [],
      accountId: this.ledger.account("system:equity").id,
      supervisors: [],
      createdAt: this.clock.now(),
      frozen: false,
    };
  }

  /** Speaker stub for evaluate() when actorId is not in this world. Does not enter mutate. */
  private unknownSpeaker(id: AgentId): Agent {
    return {
      id,
      did: "did:aether:unknown",
      displayName: "unknown",
      role: "treasury",
      autonomyLevel: 0,
      keys: [],
      accountId: this.ledger.account("system:equity").id,
      supervisors: [],
      createdAt: this.clock.now(),
      frozen: false,
    };
  }

  private unknownActorContext(cmd: Command, actor: Agent): PolicyContext {
    const audit = this.audit.verify();
    const velocity = this.velocity();
    const ctx: PolicyContext = {
      clock: this.clock.now(),
      actor,
      counterparties: this.identity.all(),
      commandType: cmd.type,
      spentAgainstIntent: 0,
      occurrenceCount: 0,
      velocity,
      circuit: {
        dailySpend: this.dailySpend,
        dailyLimit: this.dailyLimit,
        tripped: this.circuitTripped,
      },
      auditHealthy: audit.ok,
      actorKnown: false,
    };
    return ctx;
  }

  private postJournal(
    description: string,
    lines: { accountId: AccountId; debit: number; credit: number }[],
    extra?: { hireId?: HireId; paymentMandateId?: MandateId },
  ): JournalEntry {
    const res = this.ledger.post({
      id: this.ids.next("jnl") as JournalEntry["id"],
      clock: this.clock,
      description,
      lines,
      ...(extra?.hireId ? { hireId: extra.hireId } : {}),
      ...(extra?.paymentMandateId ? { paymentMandateId: extra.paymentMandateId } : {}),
    });
    if (!res.ok) throw new Error(res.error.detail);
    this.journals.push(res.value);
    this.audit.append({
      clock: this.clock,
      actorId: "system",
      action: "JOURNAL_POST",
      subjects: extra?.hireId ? [{ type: "hire", id: extra.hireId }] : [],
      payload: { id: res.value.id, description },
    });
    return res.value;
  }

  /** Rejected/expired escalation tickets must not trap a later retry of the same body. */
  private idempotencyHitStillValid(hit: DispatchResult): boolean {
    if (!hit.ok || hit.value.kind !== "escalated") return true;
    const ticketId = hit.value.ticket?.id;
    if (!ticketId) return true;
    const live = this.approvals.get(ticketId);
    if (!live || live.status !== "pending") return false;
    return Date.parse(live.expiresAt) > Date.parse(this.clock.now());
  }

  private expireApprovals(): void {
    const now = Date.parse(this.clock.now());
    for (const [id, ticket] of this.approvals) {
      if (ticket.status !== "pending") continue;
      if (Date.parse(ticket.expiresAt) > now) continue;
      this.approvals.set(id, { ...ticket, status: "expired" });
      this.unreserveQuoteForTicket(id);
      const pending = this.pending.get(id);
      if (pending) {
        const k = idempotencyKeyOf(pending);
        if (k) this.idempotency.delete(k);
      }
    }
  }

  private openTicket(cmd: Command, decision: PolicyDecision): ApprovalTicket {
    const id = this.ids.next("apd") as ApprovalId;
    const ticket: ApprovalTicket = {
      id,
      createdAt: this.clock.now(),
      expiresAt: new Date(Date.parse(this.clock.now()) + DAY_MS).toISOString(),
      commandType: cmd.type,
      commandHash: payloadHash({ type: cmd.type, actorId: cmd.actorId, body: cmd.body }),
      reason: decision.trace.filter((t) => t.verdict === "escalate").map((t) => t.message).join("; "),
      ruleIds: decision.trace.filter((t) => t.verdict === "escalate").map((t) => t.ruleId),
      requiredApproverRoles: ["treasury", "human_operator"],
      status: "pending",
    };
    this.approvals.set(id, ticket);
    this.pending.set(id, cmd);
    return ticket;
  }

  private reserveQuote(cmd: Command, ticketId: ApprovalId): void {
    if (cmd.type !== "hire.create") return;
    const quote = this.quotes.get(String((cmd.body as Record<string, unknown>).quoteId));
    if (quote) this.reservedQuotes.set(quote.id, ticketId);
  }

  private unreserveQuoteForTicket(ticketId: ApprovalId): void {
    for (const [quoteId, heldBy] of this.reservedQuotes) {
      if (heldBy === ticketId) this.reservedQuotes.delete(quoteId);
    }
  }

  private snapshot(cmd: Command, actor: Agent, thresholdWaived: boolean): PolicyContext {
    const body = cmd.body as Record<string, unknown>;
    const hire = this.lookupHire(cmd, body);
    const intent = this.lookupIntent(cmd, body, hire);
    const cart = this.lookupCart(body, hire);
    const payment = this.lookupPayment(body, hire);
    const amount = this.lookupAmount(cmd, body, hire, payment);
    const payeeId = this.lookupPayee(cmd, body, hire, payment);
    const counterparties = this.identity.all();
    let chainOk: boolean | undefined;
    const mustChain = cmd.type === "envelope.submit" || cmd.type === "hire.fund";
    if (mustChain && intent && cart && payment) {
      const checkExp = cmd.type === "hire.fund";
      // Chain integrity is the mandate signatures, not who is speaking.
      // A stranger fund still verifies a buyer-signed payment; subject_is_actor names the speaker.
      const paymentSignerIds: AgentId[] = [actor.id];
      if (hire?.buyerId) paymentSignerIds.push(hire.buyerId);
      paymentSignerIds.push(intent.payload.subjectId);
      const human = counterparties.find((a) => a.role === "human_operator");
      if (human) paymentSignerIds.push(human.id);
      chainOk = this.paymentChainOk(intent, cart, payment, paymentSignerIds, checkExp);
    }
    const velocityWindow = this.velocity();
    const audit = this.audit.verify();
    const nestedFx =
      body.fx && typeof body.fx === "object" && !Array.isArray(body.fx)
        ? (body.fx as Record<string, unknown>).rateE6
        : undefined;
    const fxRateE6 =
      typeof nestedFx === "number"
        ? nestedFx
        : typeof body.rateE6 === "number"
          ? body.rateE6
          : this.quoteOf(body)?.fx?.rateE6;
    const mm = [...this.identity.all()].find((a) => a.role === "market_maker");
    let mmInventoryOk: boolean | undefined;
    if (cmd.type === "market.fx_settle" && mm && typeof fxRateE6 === "number" && amount) {
      const payout = fxPayout(amount.amount, fxRateE6);
      const usdc = this.ledger.accountsByName.get("market_maker:cash_usdc");
      mmInventoryOk = usdc !== undefined && this.ledger.balance(usdc.id) >= payout;
    }
    const nonce = typeof body.nonce === "string" ? body.nonce : undefined;
    const ctx: PolicyContext = {
      clock: this.clock.now(),
      actor,
      counterparties,
      commandType: cmd.type,
      spentAgainstIntent: intent ? (this.spentByIntent.get(intent.payload.id) ?? 0) : 0,
      occurrenceCount: intent ? (this.occurrences.get(intent.payload.id) ?? 0) : 0,
      velocity: velocityWindow,
      circuit: {
        dailySpend: this.dailySpend,
        dailyLimit: this.dailyLimit,
        tripped: this.circuitTripped,
      },
      auditHealthy: audit.ok,
    };
    if (cmd.actorId === "system") {
      if (cmd.type === "identity.register") {
        ctx.systemOk =
          body.role === "human_operator" &&
          ![...this.identity.all()].some((a) => a.role === "human_operator");
      } else {
        ctx.systemOk = (SYSTEM_READ_COMMANDS as readonly string[]).includes(cmd.type);
      }
    }
    if (intent) ctx.intent = intent;
    if (intent) {
      const last = this.lastOccurrence.get(intent.payload.id);
      if (last) ctx.lastOccurrenceAt = last;
    }
    if ((cmd.type === "hire.create" || cmd.type === "hire.fund") && intent) {
      const ref = intent.payload.constraints.find(
        (c): c is Extract<MandateConstraint, { type: "payment.reference" }> => c.type === "payment.reference",
      );
      if (ref) {
        const funded = [...this.payments.values()].filter((p) => this.hireDrawnPayment(p));
        if (funded.length > 0) {
          ctx.referenceOk = funded.some((p) => p.payload.transaction_id === ref.conditional_transaction_id);
        }
      }
    }
    if (cart) ctx.cart = cart;
    if (payment) ctx.payment = payment;
    if (hire) ctx.hire = hire;
    if (
      HIRE_LIVE_COMMANDS.has(cmd.type) ||
      (cmd.type === "mandate.issue_cart" && typeof body.hireId === "string")
    ) {
      ctx.hireKnown = Boolean(hire && hire.id !== "hid_draft");
    }
    if (cmd.type === "hire.create" || cmd.type === "mandate.issue_cart" || cmd.type === "mandate.revoke") {
      ctx.intentKnown = Boolean(intent);
    }
    if (cmd.type === "host.subscribe") {
      ctx.hostedOk = this.hosted;
      if (this.hosted && cmd.actorId !== "system") {
        ctx.intentKnown = Boolean(intent);
        if (intent) {
          const issuer = this.identity.get(intent.payload.issuerId);
          ctx.hostIssuerOk = Boolean(
            issuer && (issuer.role === "human_operator" || issuer.role === "treasury"),
          );
          ctx.subscribeUnique = ![...this.subscriptions.values()].some((s) => s.subscriberId === actor.id);
        }
      }
    }
    if (cmd.type === "mandate.issue_payment" || cmd.type === "mandate.revoke_cart") {
      ctx.cartKnown = Boolean(cart);
      if (cmd.type === "mandate.issue_payment" && cart) ctx.paymentUnbound = this.occupyingPayment(cart) === undefined;
    }
    if (cmd.type === "mandate.revoke_payment") {
      ctx.paymentKnown = Boolean(payment);
    }
    if (cmd.type === "approval.resolve") {
      const ticket =
        typeof body.approvalId === "string" ? this.approvals.get(body.approvalId as ApprovalId) : undefined;
      ctx.approvalKnown = Boolean(ticket);
      if (ticket) {
        ctx.approvalPending =
          ticket.status === "pending" && Date.parse(ticket.expiresAt) > Date.parse(this.clock.now());
      }
      if (ctx.approvalPending === true && body.decision === "approved") {
        const pending = this.pending.get(ticket!.id);
        if (!pending) {
          ctx.replayOk = false;
        } else {
          const pendingActor =
            pending.actorId === "system" ? this.systemActor() : this.identity.get(pending.actorId as AgentId);
          if (!pendingActor) {
            ctx.replayOk = false;
          } else {
            ctx.replayOk = evaluate(this.snapshot(pending, pendingActor, true)).verdict === "allow";
          }
        }
      }
    }
    if (hire && hire.id !== "hid_draft") {
      if (cmd.type === "hire.accept" || cmd.type === "hire.deliver" || cmd.type === "envelope.require") {
        ctx.hirePartyOk = hire.sellerId === actor.id;
      } else if (cmd.type === "hire.refund" || cmd.type === "hire.release") {
        ctx.hirePartyOk = hire.buyerId === actor.id || actor.role === "treasury";
      } else if (cmd.type === "hire.void") {
        ctx.hirePartyOk =
          hire.buyerId === actor.id || hire.sellerId === actor.id || actor.role === "treasury";
      }
    }
    if (amount) ctx.amount = amount;
    if (payeeId) ctx.payeeId = payeeId;
    if (fxRateE6 !== undefined) ctx.fxRateE6 = fxRateE6;
    if (cmd.type === "envelope.submit" && nonce !== undefined) ctx.nonceSeen = this.nonces.has(nonce);
    if (mmInventoryOk !== undefined) ctx.mmInventoryOk = mmInventoryOk;
    if (chainOk !== undefined) ctx.chainOk = chainOk;
    if (thresholdWaived) ctx.thresholdWaived = true;
    if (payeeId && amount && CLEARING_SPEND.has(cmd.type)) {
      ctx.projectedExposure = this.clearing.projected(actor.id, payeeId, amount.currency, amount.amount);
      ctx.exposureLimit = this.clearing.defaultBilateralLimit;
    }
    const parentId =
      (typeof body.parentId === "string" ? (body.parentId as MandateId) : undefined) ?? intent?.payload.parentId;
    const parentIntent = parentId ? this.intents.get(parentId) : undefined;
    if (cmd.type === "mandate.issue_intent" && typeof body.parentId === "string") {
      ctx.parentKnown = Boolean(parentIntent);
    }
    if (parentIntent) {
      ctx.parentIntent = parentIntent;
      ctx.parentSpent = this.spentByIntent.get(parentIntent.payload.id) ?? 0;
      ctx.parentOccurrenceCount = this.occurrences.get(parentIntent.payload.id) ?? 0;
      const parentLast = this.lastOccurrence.get(parentIntent.payload.id);
      if (parentLast) ctx.parentLastOccurrenceAt = parentLast;
      if (
        cmd.type === "mandate.issue_intent" ||
        cmd.type === "hire.create" ||
        cmd.type === "hire.accept" ||
        cmd.type === "hire.fund"
      ) {
        ctx.parentFresh =
          parentIntent.payload.exp > unixSeconds(this.clock.now()) &&
          !this.revokedIntents.has(parentIntent.payload.id);
      }
    }
    if (cmd.type === "mandate.issue_intent" && Array.isArray(body.constraints)) {
      ctx.proposedConstraints = body.constraints as MandateConstraint[];
      const win = ctx.proposedConstraints.find((c) => c.type === "payment.execution_date");
      if (win) {
        ctx.windowMintFresh = executionWindowMintable(win, this.clock.now());
        ctx.windowReachOk = executionWindowReachable(win, this.clock.now());
      }
      const rec = ctx.proposedConstraints.find((c) => c.type === "payment.agent_recurrence");
      if (rec) {
        ctx.occurrenceMintOk = recurrenceMintable(rec);
        ctx.cadenceReachOk = cadenceReachable(rec);
      }
      const range = ctx.proposedConstraints.find((c) => c.type === "payment.amount_range");
      if (range) {
        ctx.rangeMintOk = rangeMintable(range);
        ctx.lidMintOk = lidMintable(range);
      }
      const budget = ctx.proposedConstraints.find((c) => c.type === "payment.budget");
      if (budget) {
        ctx.budgetMintOk = budgetMintable(budget, range);
      }
      if (range && budget) {
        ctx.currencyMintOk = moneyCurrenciesAligned(range, budget);
      }
    }
    const namedIds = this.namedAgentIds(cmd, body);
    if (namedIds.length > 0) {
      ctx.targetKnown = namedIds.every((id) => Boolean(this.identity.get(id)));
    }
    if (
      (cmd.type === "identity.freeze" || cmd.type === "identity.unfreeze" || cmd.type === "identity.rotate") &&
      ctx.targetKnown === true
    ) {
      const target = this.identity.get(body.agentId as AgentId) ?? (cmd.type === "identity.rotate" ? actor : undefined);
      if (target && (cmd.type === "identity.freeze" || cmd.type === "identity.unfreeze")) {
        ctx.freezeStateOk = cmd.type === "identity.freeze" ? !target.frozen : target.frozen;
      }
      if (cmd.type === "identity.rotate" && target) {
        ctx.identityPartyOk =
          actor.role === "human_operator" || actor.role === "treasury" || actor.id === target.id;
      }
    }
    if (cmd.type === "kya.attest" && typeof body.delegateId === "string") {
      const delegate = this.identity.get(body.delegateId as AgentId);
      if (delegate) ctx.kyaNotSelf = actor.id !== delegate.id;
    }
    if (cmd.type === "kya.attest" && ctx.kyaNotSelf === true) {
      const principalId = this.kyaPrincipalId(body, actor);
      const delegateId = body.delegateId as AgentId;
      ctx.kyaLiveFree = ![...this.kya.attestations.values()].some(
        (a) => a.principalId === principalId && a.delegateId === delegateId && !a.revokedAt,
      );
    }
    if (cmd.type === "kya.attest") {
      const exp = Date.parse(this.kyaExpiresAt(body));
      const now = Date.parse(this.clock.now());
      ctx.kyaMintFresh = exp > now;
      ctx.kyaMintWindowOk = Number.isFinite(exp) && exp <= now + KYA_TTL_MS;
    }
    if (cmd.type === "kya.attest" && typeof body.parentId === "string") {
      const parentHop = this.kya.attestations.get(body.parentId as DelegationId);
      ctx.kyaParentKnown = Boolean(parentHop);
      if (parentHop) ctx.kyaParentFresh = hopStatus(parentHop, this.clock.now()) === "live";
    }
    if (cmd.type === "kya.attest" || cmd.type === "kya.revoke") {
      const principalId = this.kyaPrincipalId(body, actor);
      ctx.kyaPartyOk =
        actor.role === "human_operator" || actor.role === "treasury" || actor.id === principalId;
    }
    if (cmd.type === "identity.register") {
      const key = String(body.key ?? body.displayName);
      const role = body.role as AgentRole;
      const books = this.registerBookNames(role, key);
      ctx.aliasFree =
        !this.aliases.has(key) &&
        !this.ledger.accountsByName.has(books.cashName) &&
        (books.usdcName === undefined || !this.ledger.accountsByName.has(books.usdcName));
      const level = typeof body.autonomyLevel === "number" ? body.autonomyLevel : 0;
      ctx.birthRungOk = level < 5;
    }
    if (cmd.type === "receipt.get") {
      ctx.receiptKnown = this.receipts.has(String(body.receiptId));
    }
    if (cmd.type === "kya.revoke" && typeof body.attestationId === "string") {
      const named = this.kya.attestations.get(body.attestationId as DelegationId);
      const principalId = this.kyaPrincipalId(body, actor);
      ctx.kyaAttestationKnown = Boolean(named && named.principalId === principalId);
    }
    if (cmd.type === "ledger.transfer") {
      const fromAcct = this.ledger.accountsByName.get(String(body.fromAccount));
      const toAcct = this.ledger.accountsByName.get(String(body.toAccount));
      ctx.accountsKnown = Boolean(fromAcct && toAcct);
      if (fromAcct && toAcct) {
        const stated =
          body.amount && typeof body.amount === "object"
            ? (body.amount as Money)
            : undefined;
        ctx.accountsSameCurrency =
          fromAcct.currency === toAcct.currency && stated?.currency === fromAcct.currency;
        if (ctx.accountsSameCurrency && stated && typeof stated.amount === "number") {
          ctx.fundsOk = this.ledger.balance(fromAcct.id) >= stated.amount;
          if (ctx.fundsOk) {
            ctx.operatingBooksOk = isOperatingBook(fromAcct) && isOperatingBook(toAcct);
            ctx.balancesSafe = this.ledger.balancesStaySafe([
              { accountId: toAcct.id, debit: stated.amount, credit: 0 },
              { accountId: fromAcct.id, debit: 0, credit: stated.amount },
            ]);
          }
        }
      }
    }
    if (cmd.type === "hire.fund" && hire && hire.id !== "hid_draft") {
      const buyer = this.identity.get(hire.buyerId);
      const cash = buyer ? this.ledger.accounts.get(buyer.accountId) : undefined;
      const escrow = this.ledger.accounts.get(hire.escrowAccountId);
      if (cash && escrow) {
        ctx.accountsSameCurrency =
          cash.currency === escrow.currency && hire.price.currency === cash.currency;
        if (ctx.accountsSameCurrency && buyer) {
          ctx.fundsOk = this.ledger.balance(buyer.accountId) >= hire.price.amount;
          if (ctx.fundsOk) {
            ctx.balancesSafe = this.ledger.balancesStaySafe([
              { accountId: hire.escrowAccountId, debit: hire.price.amount, credit: 0 },
              { accountId: buyer.accountId, debit: 0, credit: hire.price.amount },
            ]);
          }
        }
      }
    }
    if (cmd.type === "market.fx_settle") {
      const key = this.aliasOf(actor.id);
      const usdcName =
        actor.role === "market_maker" ? "market_maker:cash_usdc" : key ? `${key}:usdc` : undefined;
      ctx.accountsKnown = Boolean(usdcName && this.ledger.accountsByName.has(usdcName));
      const quote = this.quoteOf(body);
      if (
        ctx.accountsKnown &&
        quote?.fx &&
        !this.consumedQuotes.has(quote.id) &&
        !this.reservedQuotes.has(quote.id)
      ) {
        ctx.fundsOk = this.ledger.balance(actor.accountId) >= quote.price.amount;
      }
    }
    if (cmd.type === "ledger.balances") {
      if (typeof body.name === "string") {
        ctx.accountsKnown = this.ledger.accountsByName.has(body.name);
      } else if (typeof body.accountId === "string") {
        ctx.accountsKnown = this.ledger.accounts.has(body.accountId as AccountId);
      }
    }
    if (cmd.type === "ladder.set" && ctx.targetKnown === true && namedIds[0]) {
      const target = this.identity.get(namedIds[0]);
      if (target && typeof body.to === "number") {
        ctx.ladderLegal = this.ladderClimbOk(target, body.to as AutonomyLevel, actor, body);
      }
    }
    const market = this.marketFlags(cmd, body, hire, actor, thresholdWaived);
    if (market.skuListed !== undefined) ctx.skuListed = market.skuListed;
    if (market.marketFresh !== undefined) ctx.marketFresh = market.marketFresh;
    if (market.sellerInvited !== undefined) ctx.sellerInvited = market.sellerInvited;
    if (market.rfqKnown !== undefined) ctx.rfqKnown = market.rfqKnown;
    if (market.fxQuoteLive !== undefined) ctx.fxQuoteLive = market.fxQuoteLive;
    if (market.quoteUnspent !== undefined) ctx.quoteUnspent = market.quoteUnspent;
    if (market.skuCurrencyOk !== undefined) ctx.skuCurrencyOk = market.skuCurrencyOk;
    if (market.fxPairOk !== undefined) ctx.fxPairOk = market.fxPairOk;
    if (market.hireNotFx !== undefined) ctx.hireNotFx = market.hireNotFx;
    if (market.fxWindowOk !== undefined) ctx.fxWindowOk = market.fxWindowOk;
    if (market.fxMintFresh !== undefined) ctx.fxMintFresh = market.fxMintFresh;
    if (cmd.type === "market.withdraw") {
      const quoted = this.quoteOf(body);
      if (quoted) {
        ctx.marketPartyOk =
          actor.role === "human_operator" || actor.role === "treasury" || actor.id === quoted.sellerId;
      }
    }
    if (cmd.type === "market.close") {
      const room =
        typeof body.rfqId === "string" ? this.rfqs.get(String(body.rfqId)) : undefined;
      if (room) {
        ctx.rfqPartyOk =
          actor.role === "human_operator" || actor.role === "treasury" || actor.id === room.buyerId;
      }
    }
    if (cmd.type === "mandate.revoke" && intent) {
      ctx.mandatePartyOk =
        actor.role === "human_operator" || actor.role === "treasury" || actor.id === intent.payload.issuerId;
    }
    if (cmd.type === "mandate.revoke_cart" && cart) {
      const occupying = this.hireOccupyingCart(cart.payload.id);
      const slip = this.intents.get(cart.payload.intentId);
      ctx.cartPartyOk =
        actor.role === "human_operator" ||
        actor.role === "treasury" ||
        actor.id === cart.payload.merchant.id ||
        (occupying !== undefined && actor.id === occupying.buyerId) ||
        (slip !== undefined && actor.id === slip.payload.subjectId);
    }
    if (cmd.type === "mandate.revoke_payment" && payment) {
      const signer = this.agentByDid(payment.issuer);
      const parentCart = this.cartMatchingPayment(payment);
      const occupying = parentCart ? this.hireOccupyingCart(parentCart.payload.id) : undefined;
      const slip = parentCart ? this.intents.get(parentCart.payload.intentId) : undefined;
      ctx.paymentPartyOk =
        actor.role === "human_operator" ||
        actor.role === "treasury" ||
        (signer !== undefined && actor.id === signer.id) ||
        actor.id === payment.payload.payee.id ||
        (occupying !== undefined && actor.id === occupying.buyerId) ||
        (slip !== undefined && actor.id === slip.payload.subjectId);
    }
    if (cart && (cmd.type === "mandate.revoke_cart" || cmd.type === "mandate.issue_payment" || cmd.type === "hire.fund")) {
      const revoked = this.revokedCarts.has(cart.payload.id);
      if (cmd.type === "mandate.revoke_cart") {
        ctx.cartWindowLive = !revoked && this.occupyingPayment(cart) === undefined;
      } else {
        ctx.cartWindowLive = !revoked;
      }
    }
    if (payment && (cmd.type === "mandate.revoke_payment" || cmd.type === "hire.fund")) {
      const revoked = this.revokedPayments.has(payment.payload.id);
      if (cmd.type === "mandate.revoke_payment") {
        ctx.paymentWindowLive = !revoked && !this.hireDrawnPayment(payment);
      } else {
        ctx.paymentWindowLive = !revoked;
      }
    }
    if (
      intent &&
      (cmd.type === "hire.create" ||
        cmd.type === "hire.fund" ||
        cmd.type === "mandate.issue_cart" ||
        cmd.type === "mandate.revoke" ||
        cmd.type === "host.subscribe")
    ) {
      ctx.intentWindowLive = !this.revokedIntents.has(intent.payload.id);
    }
    const cartMatch = this.cartFlags(cmd, body, hire, cart);
    if (cartMatch.cartMatchesHire !== undefined) ctx.cartMatchesHire = cartMatch.cartMatchesHire;
    if (cmd.type === "mandate.issue_cart" && hire && hire.id !== "hid_draft") {
      ctx.cartUnbound = hire.cartId === undefined;
    }
    if (
      (cmd.type === "hire.fund" || cmd.type === "hire.release" || cmd.type === "envelope.submit") &&
      hire &&
      hire.id !== "hid_draft"
    ) {
      ctx.cartBound = this.hireMandateBound(hire);
    }
    if (
      (cmd.type === "hire.refund" || cmd.type === "hire.release" || cmd.type === "envelope.submit") &&
      hire &&
      hire.id !== "hid_draft"
    ) {
      const destAgent =
        cmd.type === "hire.refund" ? this.identity.get(hire.buyerId) : this.identity.get(hire.sellerId);
      if (
        destAgent &&
        this.ledger.accounts.has(destAgent.accountId) &&
        this.ledger.accounts.has(hire.escrowAccountId)
      ) {
        ctx.balancesSafe = this.ledger.balancesStaySafe([
          { accountId: destAgent.accountId, debit: hire.price.amount, credit: 0 },
          { accountId: hire.escrowAccountId, debit: 0, credit: hire.price.amount },
        ]);
      }
    }
    if (cmd.type === "market.fx_settle" && ctx.fxQuoteLive === true) {
      const mmAgent = [...this.identity.all()].find((a) => a.role === "market_maker");
      ctx.mmKnown = Boolean(
        mmAgent &&
          this.ledger.accountsByName.has("market_maker:cash_usd") &&
          this.ledger.accountsByName.has("market_maker:cash_usdc"),
      );
    }
    if (
      cmd.type === "market.fx_settle" &&
      ctx.fxQuoteLive === true &&
      ctx.accountsKnown === true &&
      ctx.mmKnown === true &&
      ctx.fundsOk === true
    ) {
      const fxQuote = this.quoteOf(body);
      const rate = fxQuote?.fx?.rateE6;
      const key = this.aliasOf(actor.id);
      const usdName = actor.role === "market_maker" ? "market_maker:cash_usd" : key ? `${key}:cash` : undefined;
      const usdcName = actor.role === "market_maker" ? "market_maker:cash_usdc" : key ? `${key}:usdc` : undefined;
      const vendorUsd = usdName ? this.ledger.accountsByName.get(usdName) : undefined;
      const vendorUsdc = usdcName ? this.ledger.accountsByName.get(usdcName) : undefined;
      const mmUsd = this.ledger.accountsByName.get("market_maker:cash_usd");
      const mmUsdc = this.ledger.accountsByName.get("market_maker:cash_usdc");
      if (fxQuote && typeof rate === "number" && vendorUsd && vendorUsdc && mmUsd && mmUsdc) {
        const payout = fxPayout(fxQuote.price.amount, rate);
        ctx.balancesSafe =
          this.ledger.balancesStaySafe([
            { accountId: mmUsd.id, debit: fxQuote.price.amount, credit: 0 },
            { accountId: vendorUsd.id, debit: 0, credit: fxQuote.price.amount },
          ]) &&
          this.ledger.balancesStaySafe([
            { accountId: vendorUsdc.id, debit: payout, credit: 0 },
            { accountId: mmUsdc.id, debit: 0, credit: payout },
          ]);
      }
    }
    ctx.kya = this.resolveKya(cmd, actor, intent, body, parentIntent, hire, ctx);
    if (KYA_NESTED_SPEND.has(cmd.type)) {
      const nested = nestedKyaParentsLive(
        ctx.kya.hops,
        (id) => this.kya.attestations.get(id),
        this.clock.now(),
      );
      if (nested !== undefined) ctx.kyaParentFresh = nested;
    }
    ctx.kya = this.resolveKya(cmd, actor, intent, body, parentIntent, hire, ctx);
    if (KYA_NESTED_SPEND.has(cmd.type)) {
      const nested = nestedKyaParentsLive(
        ctx.kya.hops,
        (id) => this.kya.attestations.get(id),
        this.clock.now(),
      );
      if (nested !== undefined) ctx.kyaParentFresh = nested;
    }
    return ctx;
  }

  private decisionSubjects(cmd: Command, ctx: PolicyContext): Array<{ type: string; id: string }> {
    const subjects: Array<{ type: string; id: string }> = [{ type: "command", id: cmd.type }];
    if (ctx.hire && ctx.hire.id !== "hid_draft") subjects.push({ type: "hire", id: ctx.hire.id });
    if (ctx.intent) subjects.push({ type: "intent", id: ctx.intent.payload.id });
    const body = cmd.body as Record<string, unknown>;
    if (cmd.type === "approval.resolve" && typeof body.approvalId === "string") {
      subjects.push({ type: "approval", id: body.approvalId });
    }
    if (cmd.type === "receipt.get" && typeof body.receiptId === "string") {
      subjects.push({ type: "receipt", id: body.receiptId });
    }
    const targetId = this.targetAgentId(cmd, body);
    if (targetId) subjects.push({ type: "agent", id: targetId });
    const quote = this.quoteOf(body) ?? (ctx.hire?.quoteId ? this.quotes.get(ctx.hire.quoteId) : undefined);
    if (quote) subjects.push({ type: "quote", id: quote.id });
    const rfq = quote ? this.rfqs.get(quote.rfqId) : typeof body.rfqId === "string" ? this.rfqs.get(String(body.rfqId)) : undefined;
    if (rfq) subjects.push({ type: "rfq", id: rfq.id });
    return subjects;
  }

  private marketFlags(
    cmd: Command,
    body: Record<string, unknown>,
    hire: HireContract | undefined,
    actor: Agent,
    thresholdWaived: boolean,
  ): {
    skuListed?: boolean;
    marketFresh?: boolean;
    sellerInvited?: boolean;
    rfqKnown?: boolean;
    fxQuoteLive?: boolean;
    quoteUnspent?: boolean;
    skuCurrencyOk?: boolean;
    fxPairOk?: boolean;
    hireNotFx?: boolean;
    fxWindowOk?: boolean;
    fxMintFresh?: boolean;
  } {
    const now = Date.parse(this.clock.now());
    const quote =
      this.quoteOf(body) ?? (hire?.quoteId && hire.id !== "hid_draft" ? this.quotes.get(hire.quoteId) : undefined);
    const rfq =
      quote
        ? this.rfqs.get(quote.rfqId)
        : typeof body.rfqId === "string"
          ? this.rfqs.get(String(body.rfqId))
          : undefined;
    const sku = typeof body.sku === "string" ? body.sku : (rfq?.sku ?? hire?.sku);
    const out: {
      skuListed?: boolean;
      marketFresh?: boolean;
      sellerInvited?: boolean;
      rfqKnown?: boolean;
      fxQuoteLive?: boolean;
      quoteUnspent?: boolean;
      skuCurrencyOk?: boolean;
      fxPairOk?: boolean;
      hireNotFx?: boolean;
      fxWindowOk?: boolean;
      fxMintFresh?: boolean;
    } = {};
    if (cmd.type === "market.rfq") {
      out.skuListed = typeof sku === "string" && isCatalogSku(sku);
      return out;
    }
    if (cmd.type === "market.quote") {
      out.rfqKnown = Boolean(rfq);
      if (body.fx && typeof body.fx === "object" && !Array.isArray(body.fx)) {
        out.fxMintFresh = fxWindowMintable(body.fx as { validUntil?: unknown }, this.clock.now());
      }
      if (rfq) {
        out.skuListed = typeof sku === "string" && isCatalogSku(sku);
        out.marketFresh = !this.closedRfqs.has(rfq.id) && Date.parse(rfq.expiresAt) > now;
        const invited = Array.isArray(rfq.invitedSellerIds) ? rfq.invitedSellerIds : [];
        out.sellerInvited = invited.length === 0 || invited.includes(actor.id);
        if (out.skuListed) {
          const priced = body.price && typeof body.price === "object" ? (body.price as Money) : undefined;
          if (priced?.currency) out.skuCurrencyOk = skuAllowsCurrency(rfq.sku, priced.currency);
          if (isFxSku(rfq.sku)) {
            out.fxWindowOk = Boolean(body.fx && typeof body.fx === "object" && !Array.isArray(body.fx));
          }
          if (body.fx && typeof body.fx === "object" && !Array.isArray(body.fx) && priced) {
            const fx = body.fx as { from?: CurrencyCode; to?: CurrencyCode };
            if (fx.from && fx.to) out.fxPairOk = fxPairSettles(rfq.sku, priced, { from: fx.from, to: fx.to });
          }
        }
      }
      return out;
    }
    if (cmd.type === "hire.create") {
      out.rfqKnown = Boolean(quote && rfq);
      if (quote && rfq) {
        out.skuListed = typeof sku === "string" && isCatalogSku(sku);
        out.marketFresh =
          !this.withdrawnQuotes.has(quote.id) &&
          !this.closedRfqs.has(rfq.id) &&
          Date.parse(quote.expiresAt) > now &&
          Date.parse(rfq.expiresAt) > now;
        const invited = Array.isArray(rfq.invitedSellerIds) ? rfq.invitedSellerIds : [];
        out.sellerInvited = invited.length === 0 || invited.includes(quote.sellerId);
        const consumed = this.consumedQuotes.has(quote.id);
        const reserved = this.reservedQuotes.has(quote.id);
        out.quoteUnspent = thresholdWaived && reserved && !consumed ? true : !consumed && !reserved;
        if (out.skuListed) out.skuCurrencyOk = skuAllowsCurrency(rfq.sku, quote.price.currency);
        out.hireNotFx = !quote.fx && !isFxSku(rfq.sku);
      }
      return out;
    }
    if (cmd.type === "market.withdraw") {
      out.rfqKnown = Boolean(quote);
      if (quote) {
        const rfqOfQuote = this.rfqs.get(quote.rfqId);
        out.rfqKnown = Boolean(rfqOfQuote);
        const consumed = this.consumedQuotes.has(quote.id);
        const reserved = this.reservedQuotes.has(quote.id);
        out.quoteUnspent = !consumed && !reserved;
        const envelopeLive = Date.parse(quote.expiresAt) > now;
        if (quote.fx) {
          const until = Date.parse(quote.fx.validUntil);
          out.marketFresh =
            !this.withdrawnQuotes.has(quote.id) &&
            envelopeLive &&
            Number.isFinite(until) &&
            until > now;
        } else if (rfqOfQuote) {
          out.marketFresh =
            !this.withdrawnQuotes.has(quote.id) &&
            !this.closedRfqs.has(rfqOfQuote.id) &&
            envelopeLive &&
            Date.parse(rfqOfQuote.expiresAt) > now;
        }
      }
      return out;
    }
    if (cmd.type === "market.close") {
      out.rfqKnown = Boolean(rfq);
      if (rfq) {
        out.marketFresh = !this.closedRfqs.has(rfq.id) && Date.parse(rfq.expiresAt) > now;
      }
      return out;
    }
    if (cmd.type === "market.fx_settle") {
      const live =
        Boolean(quote?.fx) &&
        quote !== undefined &&
        !this.consumedQuotes.has(quote.id) &&
        !this.reservedQuotes.has(quote.id) &&
        !this.withdrawnQuotes.has(quote.id);
      out.fxQuoteLive = live;
      if (quote?.fx && live) {
        const fxOk = Date.parse(quote.fx.validUntil) > now;
        out.marketFresh = Date.parse(quote.expiresAt) > now && fxOk;
        out.fxPairOk = Boolean(rfq && fxPairSettles(rfq.sku, quote.price, quote.fx));
      }
    }
    return out;
  }

  private cartFlags(
    cmd: Command,
    body: Record<string, unknown>,
    hire: HireContract | undefined,
    cart: Signed<CartMandate> | undefined,
  ): { cartMatchesHire?: boolean } {
    if (cmd.type !== "mandate.issue_cart" && cmd.type !== "hire.fund" && cmd.type !== "envelope.submit") {
      return {};
    }
    if (!hire || hire.id === "hid_draft") return {};
    if (cmd.type === "mandate.issue_cart") {
      const lines = Array.isArray(body.line_items) ? (body.line_items as LineItem[]) : [];
      const merchantId = typeof body.merchantId === "string" ? (body.merchantId as AgentId) : undefined;
      return { cartMatchesHire: this.cartAgreesWithHire(hire, lines, merchantId) };
    }
    if (!cart) return {};
    return { cartMatchesHire: this.cartAgreesWithHire(hire, cart.payload.line_items, cart.payload.merchant.id) };
  }

  private cartAgreesWithHire(hire: HireContract, lines: LineItem[], merchantId: AgentId | undefined): boolean {
    if (!merchantId || merchantId !== hire.sellerId) return false;
    if (!Array.isArray(lines) || lines.length === 0) return false;
    let amount = 0;
    let currency: CurrencyCode | undefined;
    for (const line of lines) {
      if (line.sku !== hire.sku) return false;
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) return false;
      const unit = line.unitAmount?.amount;
      if (!Number.isInteger(unit) || unit < 0) return false;
      if (currency && line.unitAmount.currency !== currency) return false;
      currency = line.unitAmount.currency;
      amount += unit * line.quantity;
    }
    return currency === hire.price.currency && amount === hire.price.amount;
  }

  private pushStory(cmd: Command, actor: Agent, decision: PolicyDecision, ctx: PolicyContext): void {
    const counterpart = ctx.payeeId ? this.identity.get(ctx.payeeId) : undefined;
    const body = cmd.body as Record<string, unknown>;
    const beat = autoBeat({
      seq: this.story.length,
      at: this.clock.now(),
      cmd,
      actor,
      decision,
      ...(counterpart?.displayName ? { counterpartName: counterpart.displayName } : {}),
      ...(ctx.amount
        ? { amountMinor: ctx.amount.amount }
        : ctx.hire
          ? { amountMinor: ctx.hire.price.amount }
          : {}),
      ...(ctx.hire?.sku || typeof body.sku === "string" ? { sku: ctx.hire?.sku ?? String(body.sku) } : {}),
      ...(typeof body.task === "string" ? { task: String(body.task) } : {}),
    });
    if (beat) this.story.push(beat);
  }

  private quoteOf(body: Record<string, unknown>): Quote | undefined {
    const id = (body.quoteId ?? body.id) as string | undefined;
    return id ? this.quotes.get(id) : undefined;
  }

  private targetAgentId(cmd: Command, body: Record<string, unknown>): AgentId | undefined {
    return this.namedAgentIds(cmd, body)[0];
  }

  private namedAgentIds(cmd: Command, body: Record<string, unknown>): AgentId[] {
    const ids: AgentId[] = [];
    const add = (value: unknown) => {
      if (typeof value === "string") ids.push(value as AgentId);
    };
    if (cmd.type === "identity.freeze" || cmd.type === "identity.unfreeze" || cmd.type === "ladder.set") {
      add(body.agentId);
    }
    if (cmd.type === "identity.rotate") {
      add(typeof body.agentId === "string" ? body.agentId : cmd.actorId === "system" ? undefined : cmd.actorId);
    }
    if (cmd.type === "kya.attest") {
      add(body.delegateId);
      add(body.principalId);
    }
    if (cmd.type === "kya.revoke") {
      add(body.principalId);
      add(body.delegateId);
    }
    if (cmd.type === "mandate.issue_cart") add(body.merchantId);
    if (cmd.type === "mandate.issue_intent") add(body.subjectId);
    if (cmd.type === "market.rfq" && Array.isArray(body.invitedSellerIds)) {
      for (const id of body.invitedSellerIds) add(id);
    }
    return ids;
  }

  private lookupHire(cmd: Command, body: Record<string, unknown>): HireContract | undefined {
    if (typeof body.hireId === "string") return this.hires.get(body.hireId as HireId);
    if (cmd.type === "hire.create") {
      const quote = this.quotes.get(String(body.quoteId));
      const rfq = quote ? this.rfqs.get(quote.rfqId) : undefined;
      if (!quote || !rfq) return undefined;
      return {
        id: "hid_draft" as HireId,
        buyerId: cmd.actorId as AgentId,
        sellerId: quote.sellerId,
        sku: rfq.sku,
        spec: rfq.spec,
        price: quote.price,
        state: "offered",
        rfqId: rfq.id,
        quoteId: quote.id,
        intentId: body.intentId as MandateId,
        escrowAccountId: "acct_draft" as AccountId,
        createdAt: this.clock.now(),
      };
    }
    return undefined;
  }

  private lookupIntent(
    cmd: Command,
    body: Record<string, unknown>,
    hire?: HireContract,
  ): Signed<IntentMandate> | undefined {
    if (cmd.type === "host.subscribe" && (!this.hosted || cmd.actorId === "system")) return undefined;
    const id = (body.intentId as MandateId | undefined) ?? hire?.intentId;
    return id ? this.intents.get(id) : undefined;
  }

  private lookupCart(body: Record<string, unknown>, hire?: HireContract): Signed<CartMandate> | undefined {
    const id = (body.cartId as MandateId | undefined) ?? hire?.cartId;
    return id ? this.carts.get(id) : undefined;
  }

  private lookupPayment(body: Record<string, unknown>, hire?: HireContract): Signed<PaymentMandate> | undefined {
    if (typeof body.paymentId === "string") return this.payments.get(body.paymentId as MandateId);
    const id = body.paymentMandateId as MandateId | undefined;
    if (id) return this.payments.get(id);
    if (hire?.cartId) {
      const bound = this.carts.get(hire.cartId);
      if (bound) return this.anyPaymentMatchingCart(bound);
    }
    return undefined;
  }

  private lookupAmount(
    cmd: Command,
    body: Record<string, unknown>,
    hire?: HireContract,
    payment?: Signed<PaymentMandate>,
  ): Money | undefined {
    if (cmd.type === "hire.deliver" || cmd.type === "hire.accept" || cmd.type === "hire.refund" || cmd.type === "hire.void" || cmd.type === "envelope.require" || cmd.type === "audit.verify" || cmd.type === "audit.query" || cmd.type === "market.catalog" || cmd.type === "market.withdraw" || cmd.type === "market.close" || cmd.type === "mandate.revoke" || cmd.type === "mandate.revoke_cart" || cmd.type === "mandate.revoke_payment" || cmd.type === "ledger.balances" || cmd.type === "receipt.get" || cmd.type === "host.card" || cmd.type === "host.subscribe" || cmd.type === "approval.resolve" || cmd.type === "kya.attest" || cmd.type === "kya.revoke" || cmd.type === "identity.freeze" || cmd.type === "identity.unfreeze" || cmd.type === "identity.rotate" || cmd.type === "circuit.reset" || cmd.type === "ladder.set") {
      return undefined;
    }
    if (hire) return hire.price;
    if (payment) {
      return { amount: payment.payload.payment_amount.amount, currency: payment.payload.payment_amount.currency };
    }
    if (body.amount && typeof body.amount === "object") return body.amount as Money;
    if (cmd.type === "market.quote" && body.price) return body.price as Money;
    if (cmd.type === "market.fx_settle") {
      const q = this.quoteOf(body);
      return q?.price;
    }
    if (cmd.type === "ledger.transfer" && body.amount) return body.amount as Money;
    return undefined;
  }

  private lookupPayee(
    cmd: Command,
    body: Record<string, unknown>,
    hire?: HireContract,
    payment?: Signed<PaymentMandate>,
  ): AgentId | undefined {
    if (hire) return hire.sellerId;
    if (payment) return payment.payload.payee.id;
    if (typeof body.sellerId === "string") return body.sellerId as AgentId;
    if (cmd.type === "market.fx_settle") {
      const mm = [...this.identity.all()].find((a) => a.role === "market_maker");
      return mm?.id;
    }
    return undefined;
  }

  private velocity() {
    const now = Date.parse(this.clock.now());
    const windowMs = VELOCITY_CAPS.windowSeconds * 1000;
    const recent = this.settleEvents.filter((e) => now - Date.parse(e.at) <= windowMs);
    return {
      windowSeconds: VELOCITY_CAPS.windowSeconds,
      count: recent.length,
      volume: recent.reduce((s, e) => s + e.volume, 0),
    };
  }

  private mutate(cmd: Command, actor: Agent): unknown {
    const body = cmd.body as Record<string, unknown>;
    switch (cmd.type) {
      case "identity.register":
        return this.mutRegister(body, actor);
      case "identity.freeze":
        return this.mutFreeze(body, actor);
      case "identity.unfreeze":
        return this.mutUnfreeze(body, actor);
      case "identity.rotate":
        return this.mutRotate(body, actor);
      case "kya.attest":
        return this.mutKyaAttest(body, actor);
      case "kya.revoke":
        return this.mutKyaRevoke(body, actor);
      case "circuit.reset":
        return this.mutCircuitReset(actor);
      case "ladder.set":
        return this.mutLadder(body, actor);
      case "mandate.issue_intent":
        return this.mutIntent(body, actor);
      case "mandate.revoke":
        return this.mutIntentRevoke(body, actor);
      case "mandate.revoke_cart":
        return this.mutCartRevoke(body, actor);
      case "mandate.revoke_payment":
        return this.mutPaymentRevoke(body, actor);
      case "mandate.issue_cart":
        return this.mutCart(body, actor);
      case "mandate.issue_payment":
        return this.mutPayment(body, actor);
      case "market.rfq":
        return this.mutRfq(body, actor);
      case "market.close":
        return this.mutRfqClose(body, actor);
      case "market.quote":
        return this.mutQuote(body, actor);
      case "market.withdraw":
        return this.mutQuoteWithdraw(body, actor);
      case "market.fx_settle":
        return this.mutFx(body, actor);
      case "hire.create":
        return this.mutHireCreate(body, actor);
      case "hire.accept":
        return this.mutHireAccept(body, actor);
      case "hire.fund":
        return this.mutHireFund(body, actor);
      case "hire.refund":
        return this.mutHireRefund(body, actor);
      case "hire.void":
        return this.mutHireVoid(body, actor);
      case "hire.deliver":
        return this.mutHireDeliver(body, actor);
      case "hire.release":
      case "envelope.submit":
        return this.mutRelease(body, actor, cmd.type);
      case "envelope.require":
        return this.mutRequire(body, actor);
      case "approval.resolve":
        return this.mutApprove(body, actor);
      case "ledger.transfer":
        return this.mutTransfer(body);
      case "ledger.balances":
        return this.mutBalances(body);
      case "clearing.settle_window":
        return this.mutClearingWindow(body, actor);
      case "audit.verify":
        return this.mutAudit(actor);
      case "audit.query":
        return this.mutAuditQuery(body);
      case "market.catalog":
        return { skus: CATALOG };
      case "host.card":
        return this.protocolCard();
      case "host.subscribe":
        return this.mutHostSubscribe(body, actor);
      case "receipt.get": {
        const receipt = this.receipts.get(String(body.receiptId));
        if (!receipt) throw new Error("unknown receipt");
        return receipt;
      }
      default:
        throw new Error(`unhandled ${cmd.type}`);
    }
  }

  private mutHostSubscribe(body: Record<string, unknown>, actor: Agent): HostSubscription {
    if (!this.hosted) throw new Error("not hosted");
    if (typeof body.intentId !== "string" || body.intentId.length === 0) {
      throw new Error("missing intent");
    }
    const row: HostSubscription = {
      id: this.ids.next("hsb") as SubscriptionId,
      subscriberId: actor.id,
      intentId: body.intentId as MandateId,
      createdAt: this.clock.now(),
    };
    this.subscriptions.set(row.id, row);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "HOST_SUBSCRIBE",
      subjects: [
        { type: "subscription", id: row.id },
        { type: "intent", id: row.intentId },
        { type: "agent", id: actor.id },
      ],
      payload: { id: row.id, subscriberId: actor.id, intentId: row.intentId },
    });
    return row;
  }

  private mutRegister(body: Record<string, unknown>, actor: Agent) {
    const role = body.role as AgentRole;
    if (!(role in ROLE_CAPABILITY)) throw new Error("unknown role");
    const birth = (body.autonomyLevel as AutonomyLevel | undefined) ?? 0;
    if (birth >= 5) throw new Error("birth rung");
    const key = String(body.key ?? body.displayName);
    const kp = this.identity.mintKey(`kid_${key}`);
    const books = this.registerBookNames(role, key);
    const cash = this.ledger.openAccount({
      id: this.ids.next("acct") as AccountId,
      ownerId: "system",
      name: books.cashName,
      type: "asset",
      currency: "USD_SIM",
    });
    let usdc: Account | undefined;
    if (books.usdcName) {
      usdc = this.ledger.openAccount({
        id: this.ids.next("acct") as AccountId,
        ownerId: "system",
        name: books.usdcName,
        type: "asset",
        currency: "USDC_SIM",
      });
    }
    const agent = makeAgent({
      id: this.ids.next("aid") as AgentId,
      displayName: String(body.displayName),
      role,
      autonomyLevel: birth,
      accountId: cash.id,
      supervisors: actor.role === "human_operator" ? [actor.id] : [],
      createdAt: this.clock.now(),
      keypair: kp,
    });
    // Fix owner after we have the id. USDC is the agent's wallet, not system's.
    (cash as { ownerId: AgentId }).ownerId = agent.id;
    if (usdc) (usdc as { ownerId: AgentId }).ownerId = agent.id;
    this.identity.register(agent, kp);
    this.aliases.set(key, agent.id);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "IDENTITY_REGISTER",
      subjects: [{ type: "agent", id: agent.id }],
      payload: { id: agent.id, role: agent.role, key },
    });
    return agent;
  }

  private mutFreeze(body: Record<string, unknown>, actor: Agent) {
    const before = this.identity.require(body.agentId as AgentId);
    if (before.frozen) throw new Error("already frozen");
    const agent = this.identity.freeze(body.agentId as AgentId);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "FREEZE",
      subjects: [{ type: "agent", id: agent.id }],
      payload: { id: agent.id },
    });
    return agent;
  }

  private mutUnfreeze(body: Record<string, unknown>, actor: Agent) {
    const before = this.identity.require(body.agentId as AgentId);
    if (!before.frozen) throw new Error("not frozen");
    const agent = this.identity.unfreeze(body.agentId as AgentId);
    this.killSwitchTested.add(agent.id);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "UNFREEZE",
      subjects: [{ type: "agent", id: agent.id }],
      payload: { id: agent.id, restored: agent.autonomyLevel, killSwitchTested: true },
    });
    return agent;
  }

  private mutRotate(body: Record<string, unknown>, actor: Agent) {
    const targetId = (typeof body.agentId === "string" ? body.agentId : actor.id) as AgentId;
    const next = this.identity.mintKey(this.ids.next("kid"));
    const agent = this.identity.rotate(targetId, next);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "IDENTITY_ROTATE",
      subjects: [{ type: "agent", id: agent.id }],
      payload: { id: agent.id, kid: next.kid },
    });
    return agent;
  }

  private mutKyaAttest(body: Record<string, unknown>, actor: Agent) {
    const delegateId = body.delegateId as AgentId;
    this.identity.require(delegateId);
    if (typeof body.principalId === "string") this.identity.require(body.principalId as AgentId);
    const principalId = this.kyaPrincipalId(body, actor);
    if (actor.role !== "human_operator" && actor.role !== "treasury" && principalId !== actor.id) {
      throw new Error("kya party");
    }
    const kind = (body.issuerKind as KyaIssuerKind | undefined) ?? "aether.self";
    const issuer = this.kya.issuerOfKind(kind);
    const att: DelegationAttestation = {
      id: this.ids.next("dlg") as DelegationId,
      vct: "aether.kya.delegation.1",
      issuerKind: kind,
      issuerId: issuer.id,
      principalId,
      grantorId: actor.id,
      delegateId,
      maxAutonomy: this.kyaGrantCeiling(body, actor),
      maxDepth: KYA_MAX_DEPTH,
      createdAt: this.clock.now(),
      expiresAt: this.kyaExpiresAt(body),
    };
    if (!(Date.parse(att.expiresAt) > Date.parse(att.createdAt))) {
      throw new Error("kya hop already expired");
    }
    if (Date.parse(att.expiresAt) > Date.parse(att.createdAt) + KYA_TTL_MS) {
      throw new Error("kya hop outlives one year");
    }
    if (typeof body.parentId === "string") {
      const parentHop = this.kya.attestations.get(body.parentId as DelegationId);
      if (!parentHop) throw new Error("unknown parent hop");
      if (hopStatus(parentHop, this.clock.now()) !== "live") throw new Error("kya parent hop not live");
      att.parentId = body.parentId as DelegationId;
    }
    this.kya.attest(att);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "KYA_ATTEST",
      subjects: [
        { type: "delegation", id: att.id },
        { type: "delegate", id: delegateId },
      ],
      payload: { id: att.id, principalId, delegateId, maxAutonomy: att.maxAutonomy, issuerKind: att.issuerKind, issuerId: att.issuerId },
    });
    return att;
  }

  private mutKyaRevoke(body: Record<string, unknown>, actor: Agent) {
    if (typeof body.principalId === "string") this.identity.require(body.principalId as AgentId);
    if (typeof body.delegateId === "string") this.identity.require(body.delegateId as AgentId);
    const principalId = this.kyaPrincipalId(body, actor);
    if (actor.role !== "human_operator" && actor.role !== "treasury" && principalId !== actor.id) {
      throw new Error("kya party");
    }
    if (typeof body.attestationId === "string") {
      const named = this.kya.attestations.get(body.attestationId as DelegationId);
      if (!named || named.principalId !== principalId) throw new Error("unknown attestation");
    }
    const opts: { principalId: AgentId; at: string; id?: DelegationId; delegateId?: AgentId } = {
      principalId,
      at: this.clock.now(),
    };
    if (typeof body.attestationId === "string") opts.id = body.attestationId as DelegationId;
    if (typeof body.delegateId === "string") opts.delegateId = body.delegateId as AgentId;
    const revoked = this.kya.revoke(opts);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "KYA_REVOKE",
      subjects: revoked.map((a) => ({ type: "delegation", id: a.id })),
      payload: { principalId, delegateId: body.delegateId ?? null, count: revoked.length },
    });
    return { revoked, blocked: [...this.kya.blocked] };
  }

  private mutCircuitReset(actor: Agent) {
    const before = { dailySpend: this.dailySpend, tripped: this.circuitTripped };
    this.dailySpend = 0;
    this.circuitTripped = false;
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "CIRCUIT_RESET",
      payload: before,
    });
    return { dailySpend: 0, tripped: false, previous: before };
  }

  private mutLadder(body: Record<string, unknown>, actor: Agent) {
    const target = this.identity.require(body.agentId as AgentId);
    const to = body.to as AutonomyLevel;
    if (!this.ladderClimbOk(target, to, actor, body)) {
      throw new Error(`illegal ladder ${target.autonomyLevel} -> ${to}`);
    }
    const next = this.identity.setLevel(target.id, to);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "LADDER_SET",
      subjects: [{ type: "agent", id: target.id }],
      payload: { from: target.autonomyLevel, to },
    });
    return next;
  }

  private mutIntent(body: Record<string, unknown>, actor: Agent) {
    const constraints = (body.constraints as MandateConstraint[]) ?? [];
    const win = constraints.find((c) => c.type === "payment.execution_date");
    if (win && !executionWindowMintable(win, this.clock.now())) {
      throw new Error("intent window already closed");
    }
    if (win && !executionWindowReachable(win, this.clock.now())) {
      throw new Error("intent window unreachable");
    }
    const rec = constraints.find((c) => c.type === "payment.agent_recurrence");
    if (rec && !recurrenceMintable(rec)) {
      throw new Error("intent recurrence already exhausted");
    }
    if (rec && !cadenceReachable(rec)) {
      throw new Error("intent cadence unreachable");
    }
    const range = constraints.find((c) => c.type === "payment.amount_range");
    if (range && !rangeMintable(range)) {
      throw new Error("intent range empty");
    }
    const budget = constraints.find((c) => c.type === "payment.budget");
    if (budget && !budgetMintable(budget, range)) {
      throw new Error("intent budget empty");
    }
    if (range && budget && !moneyCurrenciesAligned(range, budget)) {
      throw new Error("intent currencies mixed");
    }
    if (range && !lidMintable(range)) {
      throw new Error("intent lid empty");
    }
    const payload: IntentMandate = {
      vct: "aether.mandate.intent.open.1",
      id: this.ids.next("mid") as MandateId,
      issuerId: actor.id,
      subjectId: body.subjectId as AgentId,
      task: String(body.task),
      constraints: body.constraints as MandateConstraint[],
      iat: unixSeconds(this.clock.now()),
      exp: unixSeconds(this.clock.now()) + INTENT_TTL_SEC,
    };
    if (typeof body.parentId === "string") {
      const parent = this.intents.get(body.parentId as MandateId);
      if (!parent) throw new Error("unknown parent intent");
      if (parent.payload.exp <= unixSeconds(this.clock.now())) throw new Error("parent intent expired");
      if (this.revokedIntents.has(parent.payload.id)) throw new Error("parent intent revoked");
      this.assertKyaNestedParentsLive(actor, parent);
      payload.parentId = body.parentId as MandateId;
    }
    const signed = signMandate(payload, actor.did, this.keypair(actor.id));
    this.intents.set(payload.id, signed);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "MANDATE_ISSUE",
      subjects: [{ type: "intent", id: payload.id }],
      payload: { id: payload.id, vct: payload.vct },
    });
    return signed;
  }

  private mutIntentRevoke(body: Record<string, unknown>, actor: Agent) {
    const intent = this.intents.get(body.intentId as MandateId);
    if (!intent) throw new Error("unknown intent");
    if (this.revokedIntents.has(intent.payload.id)) throw new Error("intent already revoked");
    this.revokedIntents.add(intent.payload.id);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "MANDATE_REVOKE",
      subjects: [{ type: "intent", id: intent.payload.id }],
      payload: { id: intent.payload.id, issuerId: intent.payload.issuerId },
    });
    return intent;
  }

  private hireOccupyingCart(cartId: MandateId): HireContract | undefined {
    for (const hire of this.hires.values()) {
      if (hire.cartId === cartId) return hire;
    }
    return undefined;
  }

  private mutCartRevoke(body: Record<string, unknown>, actor: Agent) {
    const cart = this.carts.get(body.cartId as MandateId);
    if (!cart) throw new Error("unknown cart");
    if (this.occupyingPayment(cart)) throw new Error("cart bound");
    if (this.revokedCarts.has(cart.payload.id)) throw new Error("cart already revoked");
    this.revokedCarts.add(cart.payload.id);
    const occupying = this.hireOccupyingCart(cart.payload.id);
    if (occupying) {
      const next: HireContract = { ...occupying };
      delete next.cartId;
      this.hires.set(occupying.id, next);
    }
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "CART_REVOKE",
      subjects: [{ type: "cart", id: cart.payload.id }],
      payload: { id: cart.payload.id, merchantId: cart.payload.merchant.id },
    });
    return cart;
  }

  private mutPaymentRevoke(body: Record<string, unknown>, actor: Agent) {
    const payment = this.payments.get(body.paymentId as MandateId);
    if (!payment) throw new Error("unknown payment");
    if (this.hireDrawnPayment(payment)) throw new Error("payment funded");
    if (this.revokedPayments.has(payment.payload.id)) throw new Error("payment already revoked");
    this.revokedPayments.add(payment.payload.id);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "PAYMENT_REVOKE",
      subjects: [{ type: "payment", id: payment.payload.id }],
      payload: { id: payment.payload.id, payeeId: payment.payload.payee.id },
    });
    return payment;
  }

  private mutCart(body: Record<string, unknown>, actor: Agent) {
    const boundHire =
      typeof body.hireId === "string" ? this.hires.get(body.hireId as HireId) : undefined;
    if (boundHire?.cartId) throw new Error("hire already has a cart");
    const intent = this.intents.get(body.intentId as MandateId);
    if (!intent) throw new Error("unknown intent");
    if (this.revokedIntents.has(intent.payload.id)) throw new Error("intent revoked");
    const merchantAgent = this.identity.require(body.merchantId as AgentId);
    const lineItems = body.line_items as CartMandate["line_items"];
    if (!lineItems[0]?.unitAmount || typeof lineItems[0].quantity !== "number") {
      throw new Error("cart line missing unitAmount");
    }
    let amount = 0;
    const currency = lineItems[0].unitAmount.currency;
    for (const line of lineItems) {
      if (line.unitAmount.currency !== currency) throw new Error("mixed currency cart");
      const lineTotal = line.unitAmount.amount * line.quantity;
      if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(amount + lineTotal)) {
        throw new Error("unsafe integer");
      }
      amount += lineTotal;
    }
    const total = { amount, currency };
    const payload: CartMandate = {
      vct: "aether.mandate.cart.1",
      id: this.ids.next("mid") as MandateId,
      intentId: intent.payload.id,
      intentHash: intentHash(intent.payload),
      merchant: this.merchant(merchantAgent),
      line_items: lineItems,
      total,
      expiresAt: new Date(Date.parse(this.clock.now()) + DAY_MS).toISOString(),
      userConfirmationRequired: actor.autonomyLevel < 2,
    };
    const signed = signMandate(payload, merchantAgent.did, this.keypair(merchantAgent.id));
    this.carts.set(payload.id, signed);
    if (boundHire) {
      this.hires.set(boundHire.id, { ...boundHire, cartId: payload.id });
    }
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "MANDATE_ISSUE",
      subjects: [{ type: "cart", id: payload.id }],
      payload: { id: payload.id, total },
    });
    return signed;
  }

  private mutPayment(body: Record<string, unknown>, actor: Agent) {
    const cart = this.carts.get(body.cartId as MandateId);
    if (!cart) throw new Error("unknown cart");
    if (this.revokedCarts.has(cart.payload.id)) throw new Error("cart revoked");
    if (this.occupyingPayment(cart)) throw new Error("cart already has a payment");
    const payload: PaymentMandate = {
      vct: "aether.mandate.payment.1",
      id: this.ids.next("mid") as MandateId,
      transaction_id: cartHash(cart.payload),
      payee: cart.payload.merchant,
      payment_amount: cart.payload.total,
      payment_instrument: SIM_INSTRUMENT,
      iat: unixSeconds(this.clock.now()),
      exp: unixSeconds(this.clock.now()) + DAY_SEC,
    };
    const signed = signMandate(payload, actor.did, this.keypair(actor.id));
    this.payments.set(payload.id, signed);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "MANDATE_ISSUE",
      subjects: [{ type: "payment", id: payload.id }],
      payload: { id: payload.id, transaction_id: payload.transaction_id },
    });
    return signed;
  }

  private mutRfq(body: Record<string, unknown>, actor: Agent) {
    const rfq: Rfq = {
      id: this.ids.next("rfq") as Rfq["id"],
      buyerId: actor.id,
      sku: String(body.sku),
      spec: String(body.spec ?? body.sku),
      invitedSellerIds: Array.isArray(body.invitedSellerIds)
        ? (body.invitedSellerIds.filter((id): id is AgentId => typeof id === "string") as AgentId[])
        : [],
      expiresAt: new Date(Date.parse(this.clock.now()) + DAY_MS).toISOString(),
    };
    for (const id of rfq.invitedSellerIds) {
      if (!this.identity.get(id)) throw new Error("unknown invited seller");
    }
    this.rfqs.set(rfq.id, rfq);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "RFQ_CREATE",
      subjects: [{ type: "rfq", id: rfq.id }],
      payload: { id: rfq.id, sku: rfq.sku, invited: rfq.invitedSellerIds.length },
    });
    return rfq;
  }

  private mutRfqClose(body: Record<string, unknown>, actor: Agent) {
    const rfq = this.rfqs.get(String(body.rfqId));
    if (!rfq) throw new Error("unknown rfq");
    if (this.closedRfqs.has(rfq.id)) throw new Error("rfq already closed");
    this.closedRfqs.add(rfq.id);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "RFQ_CLOSE",
      subjects: [{ type: "rfq", id: rfq.id }],
      payload: { id: rfq.id, buyerId: rfq.buyerId },
    });
    return rfq;
  }

  private mutQuote(body: Record<string, unknown>, actor: Agent) {
    const rfq = this.rfqs.get(String(body.rfqId));
    if (!rfq) throw new Error("unknown rfq");
    if (this.closedRfqs.has(rfq.id)) throw new Error("rfq closed");
    const price = body.price as Money;
    if (isCatalogSku(rfq.sku) && !skuAllowsCurrency(rfq.sku, price.currency)) {
      throw new Error("sku currency");
    }
    if (isFxSku(rfq.sku) && (!body.fx || typeof body.fx !== "object" || Array.isArray(body.fx))) {
      throw new Error("fx window");
    }
    if (body.fx && typeof body.fx === "object" && !Array.isArray(body.fx)) {
      const fx = body.fx as { from?: CurrencyCode; to?: CurrencyCode };
      if (!fx.from || !fx.to || !fxPairSettles(rfq.sku, price, { from: fx.from, to: fx.to })) {
        throw new Error("fx pair");
      }
    }
    const quote: Quote = {
      id: this.ids.next("qte") as Quote["id"],
      rfqId: rfq.id,
      sellerId: actor.id,
      price,
      expiresAt: new Date(Date.parse(this.clock.now()) + HOUR_MS).toISOString(),
    };
    if (body.fx) quote.fx = body.fx as Quote["fx"];
    if (quote.fx && !fxWindowMintable(quote.fx, this.clock.now())) {
      throw new Error("fx window already closed");
    }
    this.quotes.set(quote.id, quote);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "QUOTE_SUBMIT",
      subjects: [{ type: "quote", id: quote.id }],
      payload: { id: quote.id, price: quote.price, rateE6: quote.fx?.rateE6 ?? null },
    });
    return quote;
  }

  private mutQuoteWithdraw(body: Record<string, unknown>, actor: Agent) {
    const quote = this.quotes.get(String(body.quoteId));
    if (!quote) throw new Error("unknown quote");
    if (this.consumedQuotes.has(quote.id) || this.reservedQuotes.has(quote.id)) {
      throw new Error("quote already used");
    }
    if (this.withdrawnQuotes.has(quote.id)) throw new Error("quote already withdrawn");
    this.withdrawnQuotes.add(quote.id);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "QUOTE_WITHDRAW",
      subjects: [{ type: "quote", id: quote.id }],
      payload: { id: quote.id, sellerId: quote.sellerId },
    });
    return quote;
  }

  private mutHireCreate(body: Record<string, unknown>, actor: Agent) {
    const quote = this.quotes.get(String(body.quoteId));
    const rfq = quote ? this.rfqs.get(quote.rfqId) : undefined;
    if (!quote || !rfq) throw new Error("unknown quote");
    const intent = this.intents.get(body.intentId as MandateId);
    if (!intent) throw new Error("unknown intent");
    if (this.revokedIntents.has(intent.payload.id)) throw new Error("intent revoked");
    if (intent.payload.parentId) {
      const parent = this.intents.get(intent.payload.parentId);
      if (!parent || parent.payload.exp <= unixSeconds(this.clock.now()) || this.revokedIntents.has(parent.payload.id)) {
        throw new Error("parent intent expired");
      }
    }
    this.assertKyaNestedParentsLive(actor, intent);
    if (this.consumedQuotes.has(quote.id)) throw new Error("quote already used");
    if (this.withdrawnQuotes.has(quote.id)) throw new Error("quote withdrawn");
    if (this.closedRfqs.has(rfq.id)) throw new Error("rfq closed");
    if (isCatalogSku(rfq.sku) && !skuAllowsCurrency(rfq.sku, quote.price.currency)) {
      throw new Error("sku currency");
    }
    if (quote.fx || isFxSku(rfq.sku)) throw new Error("fx hire");
    const hireId = this.ids.next("hid") as HireId;
    const escrow = this.ledger.openAccount({
      id: this.ids.next("acct") as AccountId,
      ownerId: actor.id,
      name: `escrow:${hireId}`,
      type: "asset",
      currency: quote.price.currency,
    });
    const hire: HireContract = {
      id: hireId,
      buyerId: actor.id,
      sellerId: quote.sellerId,
      sku: rfq.sku,
      spec: rfq.spec,
      price: quote.price,
      state: "offered",
      rfqId: rfq.id,
      quoteId: quote.id,
      intentId: body.intentId as MandateId,
      escrowAccountId: escrow.id,
      createdAt: this.clock.now(),
    };
    this.hires.set(hire.id, hire);
    this.reservedQuotes.delete(quote.id);
    this.consumedQuotes.add(quote.id);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "HIRE_TRANSITION",
      subjects: [{ type: "hire", id: hire.id }],
      payload: { id: hire.id, state: hire.state, sku: hire.sku },
    });
    return hire;
  }

  private mutHireAccept(body: Record<string, unknown>, actor: Agent) {
    const hire = this.requireHire(body.hireId as HireId);
    if (hire.sellerId !== actor.id) throw new Error("only seller may accept");
    const next = transitionHire(hire, "accepted");
    this.hires.set(next.id, next);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "HIRE_TRANSITION",
      subjects: [{ type: "hire", id: hire.id }],
      payload: { id: hire.id, state: next.state },
    });
    return next;
  }

  private mutHireVoid(body: Record<string, unknown>, actor: Agent) {
    const hire = this.requireHire(body.hireId as HireId);
    const next = transitionHire(hire, "void");
    this.hires.set(next.id, next);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "HIRE_TRANSITION",
      subjects: [{ type: "hire", id: hire.id }],
      payload: { id: hire.id, state: next.state },
    });
    return next;
  }

  private mutHireFund(body: Record<string, unknown>, actor: Agent) {
    const hire = this.requireHire(body.hireId as HireId);
    if (!this.hireMandateBound(hire)) throw new Error("hire has no bound cart");
    const fundedIntent = this.intents.get(hire.intentId);
    if (fundedIntent?.payload.parentId) {
      const parent = this.intents.get(fundedIntent.payload.parentId);
      if (!parent || parent.payload.exp <= unixSeconds(this.clock.now())) {
        throw new Error("parent intent expired");
      }
    }
    this.assertKyaNestedParentsLive(actor, fundedIntent);
    const buyer = this.identity.require(hire.buyerId);
    if (this.ledger.balance(buyer.accountId) < hire.price.amount) {
      throw new Error("insufficient funds");
    }
    const cash = this.ledger.accounts.get(buyer.accountId);
    const escrow = this.ledger.accounts.get(hire.escrowAccountId);
    if (
      !cash ||
      !escrow ||
      cash.currency !== escrow.currency ||
      hire.price.currency !== cash.currency
    ) {
      throw new Error("mixed currency; split FX into two entries");
    }
    if (
      !this.ledger.balancesStaySafe([
        { accountId: hire.escrowAccountId, debit: hire.price.amount, credit: 0 },
        { accountId: buyer.accountId, debit: 0, credit: hire.price.amount },
      ])
    ) {
      throw new Error("unsafe balance");
    }
    const next = transitionHire(hire, "funded");
    this.postJournal(
      `Fund escrow ${hire.sku}`,
      [
        { accountId: hire.escrowAccountId, debit: hire.price.amount, credit: 0 },
        { accountId: buyer.accountId, debit: 0, credit: hire.price.amount },
      ],
      { hireId: hire.id },
    );
    this.hires.set(next.id, next);
    this.noteSpend(hire);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "HIRE_TRANSITION",
      subjects: [{ type: "hire", id: hire.id }],
      payload: { id: hire.id, state: next.state },
    });
    return next;
  }

  private mutHireRefund(body: Record<string, unknown>, actor: Agent) {
    const hire = this.requireHire(body.hireId as HireId);
    if (hire.buyerId !== actor.id && actor.role !== "treasury") {
      throw new Error("only buyer or treasury may refund");
    }
    const next = transitionHire(hire, "refunded");
    const buyer = this.identity.require(hire.buyerId);
    if (
      !this.ledger.balancesStaySafe([
        { accountId: buyer.accountId, debit: hire.price.amount, credit: 0 },
        { accountId: hire.escrowAccountId, debit: 0, credit: hire.price.amount },
      ])
    ) {
      throw new Error("unsafe balance");
    }
    this.postJournal(
      `Refund escrow ${hire.sku}`,
      [
        { accountId: buyer.accountId, debit: hire.price.amount, credit: 0 },
        { accountId: hire.escrowAccountId, debit: 0, credit: hire.price.amount },
      ],
      { hireId: hire.id },
    );
    this.hires.set(next.id, next);
    this.noteRefund(hire);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "HIRE_TRANSITION",
      subjects: [{ type: "hire", id: hire.id }],
      payload: { id: hire.id, state: next.state },
    });
    return next;
  }

  private mutHireDeliver(body: Record<string, unknown>, actor: Agent) {
    const hire = this.requireHire(body.hireId as HireId);
    if (hire.sellerId !== actor.id) throw new Error("only seller may deliver");
    const next = transitionHire(hire, "delivered");
    next.deliverableHash = payloadHash(body.deliverable ?? { ok: true });
    this.hires.set(next.id, next);
    this.audit.append({
      clock: this.clock,
      actorId: hire.sellerId,
      action: "HIRE_TRANSITION",
      subjects: [{ type: "hire", id: hire.id }],
      payload: { id: hire.id, state: next.state, deliverableHash: next.deliverableHash },
    });
    return next;
  }

  private mutRequire(body: Record<string, unknown>, actor: Agent) {
    const hire = this.requireHire(body.hireId as HireId);
    if (hire.sellerId !== actor.id) throw new Error("only seller may require payment");
    const seller = this.identity.require(hire.sellerId);
    const required = SIM_RAIL.require({
      url: `aether://hire/${hire.id}/release`,
      description: `Release escrow for ${hire.sku}`,
      amount: hire.price.amount,
      asset: hire.price.currency,
      payTo: seller.accountId,
      hireId: hire.id,
      ...(hire.cartId ? { cartId: hire.cartId } : {}),
    });
    this.audit.append({
      clock: this.clock,
      actorId: hire.sellerId,
      action: "PAYMENT_REQUIRED",
      subjects: [{ type: "hire", id: hire.id }],
      payload: { hireId: hire.id, amount: hire.price.amount },
    });
    return required;
  }

  private mutRelease(body: Record<string, unknown>, actor: Agent, type: CommandType) {
    const hire = this.requireHire(body.hireId as HireId);
    if (type === "hire.release" && hire.buyerId !== actor.id && actor.role !== "treasury") {
      throw new Error("only buyer or treasury may release");
    }
    if (type === "envelope.submit") {
      const nonce = String(body.nonce ?? this.ids.next("nonce"));
      if (this.nonces.has(nonce)) throw new Error("nonce reuse");
      this.nonces.add(nonce);
      const inner = signInner(
        {
          payerAccountId: actor.accountId,
          paymentMandateId: (body.paymentMandateId as MandateId) ?? this.paymentForHire(hire).payload.id,
          nonce,
          authorizedAmount: String(hire.price.amount),
          asset: hire.price.currency,
          validBefore: new Date(Date.parse(this.clock.now()) + 60_000).toISOString(),
        },
        this.keypair(actor.id),
      );
      if (!verifyInner(inner, this.keypair(actor.id))) throw new Error("bad payment payload signature");
    }
    const next = transitionHire(hire, "released");
    const seller = this.identity.require(hire.sellerId);
    const payment = this.paymentForHire(hire);
    if (
      !this.ledger.balancesStaySafe([
        { accountId: seller.accountId, debit: hire.price.amount, credit: 0 },
        { accountId: hire.escrowAccountId, debit: 0, credit: hire.price.amount },
      ])
    ) {
      throw new Error("unsafe balance");
    }
    const journal = this.postJournal(
      `Release escrow ${hire.sku}`,
      [
        { accountId: seller.accountId, debit: hire.price.amount, credit: 0 },
        { accountId: hire.escrowAccountId, debit: 0, credit: hire.price.amount },
      ],
      { hireId: hire.id, paymentMandateId: payment.payload.id },
    );
    this.hires.set(next.id, next);
    const receipt = SIM_RAIL.receipt({
      id: this.ids.next("rid") as Receipt["id"],
      payment: payment.payload,
      paymentId: this.ids.next("tid") as Receipt["payment_id"],
      journalId: journal.id,
      hireId: hire.id,
      iat: unixSeconds(this.clock.now()),
    });
    this.receipts.set(receipt.id, receipt);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: type === "envelope.submit" ? "PAYMENT_SUBMIT" : "HIRE_TRANSITION",
      subjects: [{ type: "hire", id: hire.id }],
      payload: { id: hire.id, state: next.state, receiptId: receipt.id },
    });
    this.audit.append({
      clock: this.clock,
      actorId: "system",
      action: "RECEIPT_ISSUE",
      subjects: [{ type: "receipt", id: receipt.id }],
      payload: { id: receipt.id, reference: receipt.reference },
    });
    return { hire: next, receipt, settlement: SIM_RAIL.ok({ transaction: receipt.payment_id, payer: actor.accountId, receiptId: receipt.id }) };
  }

  private mutFx(body: Record<string, unknown>, actor: Agent) {
    const quote = this.quoteOf(body);
    if (!quote?.fx) throw new Error("quote is not FX");
    if (typeof quote.fx.rateE6 !== "number" || !Number.isFinite(quote.fx.rateE6)) {
      throw new Error("fx quote missing rateE6");
    }
    const rfq = this.rfqs.get(quote.rfqId);
    if (!rfq || !fxPairSettles(rfq.sku, quote.price, quote.fx)) {
      throw new Error("fx pair");
    }
    if (this.consumedQuotes.has(quote.id) || this.reservedQuotes.has(quote.id) || this.withdrawnQuotes.has(quote.id)) {
      throw new Error("fx quote already settled");
    }
    const mm = [...this.identity.all()].find((a) => a.role === "market_maker");
    if (
      !mm ||
      !this.ledger.accountsByName.has("market_maker:cash_usd") ||
      !this.ledger.accountsByName.has("market_maker:cash_usdc")
    ) {
      throw new Error("no market maker");
    }
    const payout = fxPayout(quote.price.amount, quote.fx.rateE6);
    const key = this.aliasOf(actor.id);
    const usdName = actor.role === "market_maker" ? "market_maker:cash_usd" : key ? `${key}:cash` : undefined;
    const usdcName = actor.role === "market_maker" ? "market_maker:cash_usdc" : key ? `${key}:usdc` : undefined;
    const vendorUsd = usdName ? this.ledger.accountsByName.get(usdName) : undefined;
    const vendorUsdc = usdcName ? this.ledger.accountsByName.get(usdcName) : undefined;
    if (!vendorUsd || !vendorUsdc) throw new Error("unknown account");
    const mmUsd = this.ledger.account("market_maker:cash_usd");
    const mmUsdc = this.ledger.account("market_maker:cash_usdc");
    if (this.ledger.balance(vendorUsd.id) < quote.price.amount) {
      throw new Error("insufficient funds");
    }
    if (
      !this.ledger.balancesStaySafe([
        { accountId: mmUsd.id, debit: quote.price.amount, credit: 0 },
        { accountId: vendorUsd.id, debit: 0, credit: quote.price.amount },
      ]) ||
      !this.ledger.balancesStaySafe([
        { accountId: vendorUsdc.id, debit: payout, credit: 0 },
        { accountId: mmUsdc.id, debit: 0, credit: payout },
      ])
    ) {
      throw new Error("unsafe balance");
    }
    this.postJournal("FX USD leg", [
      { accountId: mmUsd.id, debit: quote.price.amount, credit: 0 },
      { accountId: vendorUsd.id, debit: 0, credit: quote.price.amount },
    ]);
    this.postJournal("FX USDC leg", [
      { accountId: vendorUsdc.id, debit: payout, credit: 0 },
      { accountId: mmUsdc.id, debit: 0, credit: payout },
    ]);
    this.clearing.record(actor.id, mm.id, quote.price.amount, quote.fx.from);
    this.clearing.record(mm.id, actor.id, payout, quote.fx.to);
    this.noteVolume(quote.price.amount);
    this.consumedQuotes.add(quote.id);
    return { payout, rateE6: quote.fx.rateE6 };
  }

  private mutApprove(body: Record<string, unknown>, actor: Agent) {
    const ticket = this.approvals.get(body.approvalId as ApprovalId);
    if (!ticket) throw new Error("unknown approval");
    if (ticket.status === "expired" || Date.parse(ticket.expiresAt) <= Date.parse(this.clock.now())) {
      if (ticket.status === "pending") {
        this.approvals.set(ticket.id, { ...ticket, status: "expired" });
        const pendingCmd = this.pending.get(ticket.id);
        if (pendingCmd) {
          const k = idempotencyKeyOf(pendingCmd);
          if (k) this.idempotency.delete(k);
        }
      }
      this.unreserveQuoteForTicket(ticket.id);
      throw new Error("approval expired");
    }
    if (ticket.status !== "pending") throw new Error(`approval already ${ticket.status}`);
    const decision = String(body.decision);
    if (decision !== "approved" && decision !== "rejected") throw new Error("decision");
    const next: ApprovalTicket = {
      ...ticket,
      status: decision,
      resolvedBy: actor.id,
      resolvedAt: this.clock.now(),
    };
    if (decision === "rejected") {
      this.approvals.set(ticket.id, next);
      this.audit.append({
        clock: this.clock,
        actorId: actor.id,
        action: "APPROVAL_RESOLVE",
        subjects: [{ type: "approval", id: ticket.id }],
        payload: { id: ticket.id, decision },
      });
      const pending = this.pending.get(ticket.id);
      if (pending) {
        const k = idempotencyKeyOf(pending);
        if (k) this.idempotency.delete(k);
      }
      this.unreserveQuoteForTicket(ticket.id);
      return next;
    }
    const pending = this.pending.get(ticket.id);
    if (!pending) throw new Error("missing pending command");
    const replay = this.dispatch(pending, { thresholdWaived: true, skipStep: true });
    if (!replay.ok) {
      throw new Error(`approved command still blocked: ${replay.error.error.detail}`);
    }
    if (replay.value.kind !== "allow") {
      throw new Error(`approved command did not allow: ${replay.value.kind}`);
    }
    this.approvals.set(ticket.id, next);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "APPROVAL_RESOLVE",
      subjects: [{ type: "approval", id: ticket.id }],
      payload: { id: ticket.id, decision },
    });
    return { ticket: next, hire: replay.value.data, replay: replay.value };
  }

  private mutTransfer(body: Record<string, unknown>) {
    const amount = body.amount as Money;
    const from = this.ledger.account(String(body.fromAccount));
    const to = this.ledger.account(String(body.toAccount));
    if (from.currency !== to.currency || amount.currency !== from.currency) {
      throw new Error("mixed currency; split FX into two entries");
    }
    if (!isOperatingBook(from) || !isOperatingBook(to)) {
      throw new Error("operating book");
    }
    if (this.ledger.balance(from.id) < amount.amount) {
      throw new Error("insufficient funds");
    }
    if (
      !this.ledger.balancesStaySafe([
        { accountId: to.id, debit: amount.amount, credit: 0 },
        { accountId: from.id, debit: 0, credit: amount.amount },
      ])
    ) {
      throw new Error("unsafe balance");
    }
    return this.postJournal(`Transfer ${body.fromAccount} -> ${body.toAccount}`, [
      { accountId: to.id, debit: amount.amount, credit: 0 },
      { accountId: from.id, debit: 0, credit: amount.amount },
    ]);
  }

  private mutBalances(body: Record<string, unknown>) {
    if (typeof body.name === "string") return this.ledger.balanceByName(body.name);
    if (typeof body.accountId === "string") {
      if (!this.ledger.accounts.has(body.accountId as AccountId)) {
        throw new Error(`unknown account ${body.accountId}`);
      }
      return { amount: this.ledger.balance(body.accountId as AccountId) };
    }
    return [...this.ledger.accounts.values()].map((a) => ({
      name: a.name,
      id: a.id,
      currency: a.currency,
      balance: this.ledger.balance(a.id),
    }));
  }

  private mutClearingWindow(body: Record<string, unknown>, actor: Agent) {
    const currency = (body.currency as "USD_SIM" | "USDC_SIM" | undefined) ?? "USD_SIM";
    const window = this.clearing.settleWindow({
      id: this.ids.next("win") as WindowId,
      at: this.clock.now(),
      currency,
    });
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "CLEARING_WINDOW",
      subjects: [{ type: "window", id: window.id }],
      payload: {
        id: window.id,
        currency: window.currency,
        legsConsumed: window.legsConsumed,
        grossVolume: window.grossVolume,
        netVolume: window.netVolume,
      },
    });
    return window;
  }

  private mutAudit(actor: Agent) {
    const result = this.audit.verify();
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "AUDIT_VERIFY",
      payload: result,
    });
    return result;
  }

  private mutAuditQuery(body: Record<string, unknown>) {
    const subjectId = typeof body.subjectId === "string" ? body.subjectId : typeof body.id === "string" ? body.id : undefined;
    const action = typeof body.action === "string" ? body.action : undefined;
    const raw = typeof body.limit === "number" ? body.limit : 50;
    const limit = Math.min(200, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 50));
    return this.audit.query({ ...(subjectId ? { subjectId } : {}), ...(action ? { action } : {}), limit });
  }

  private requireHire(id: HireId): HireContract {
    const h = this.hires.get(id);
    if (!h) throw new Error(`unknown hire ${id}`);
    return h;
  }

  private ladderClimbOk(
    target: Agent,
    to: AutonomyLevel,
    actor: Agent,
    body: Record<string, unknown>,
  ): boolean {
    const providedGates = Array.isArray(body.gates) ? (body.gates as LadderExtraGate[]) : [];
    return ladderClimbLegal({
      from: target.autonomyLevel,
      to,
      actorRole: actor.role,
      providedGates,
      killSwitchTested: this.killSwitchTested.has(target.id),
      circuitConfigured: this.dailyLimit > 0 && this.dailyLimit < 100_000_000,
    });
  }

  private occupyingPayment(cart: Signed<CartMandate>): Signed<PaymentMandate> | undefined {
    return this.paymentMatchingCart(cart, false);
  }

  private anyPaymentMatchingCart(cart: Signed<CartMandate>): Signed<PaymentMandate> | undefined {
    return this.paymentMatchingCart(cart, true);
  }

  private paymentMatchingCart(cart: Signed<CartMandate>, includeRevoked = false): Signed<PaymentMandate> | undefined {
    const hash = cartHash(cart.payload);
    let revoked: Signed<PaymentMandate> | undefined;
    for (const p of this.payments.values()) {
      if (p.payload.transaction_id !== hash) continue;
      if (this.revokedPayments.has(p.payload.id)) {
        revoked = p;
        continue;
      }
      return p;
    }
    return includeRevoked ? revoked : undefined;
  }

  private agentByDid(did: string): Agent | undefined {
    for (const a of this.identity.all()) {
      if (a.did === did) return a;
    }
    return undefined;
  }

  private cartMatchingPayment(payment: Signed<PaymentMandate>): Signed<CartMandate> | undefined {
    for (const c of this.carts.values()) {
      if (cartHash(c.payload) === payment.payload.transaction_id) return c;
    }
    return undefined;
  }

  /** Escrow moved against this slip. Refunded and released still count — the slip was drawn. */
  private hireDrawnIntent(intent: Signed<IntentMandate>): boolean {
    for (const hire of this.hires.values()) {
      if (
        hire.state !== "funded" &&
        hire.state !== "delivered" &&
        hire.state !== "released" &&
        hire.state !== "refunded"
      ) {
        continue;
      }
      if (hire.intentId === intent.payload.id) return true;
    }
    return false;
  }

  /** Escrow moved using this payment. Refunded and released still count — the mandate was drawn. */
  private hireDrawnPayment(payment: Signed<PaymentMandate>): boolean {
    for (const hire of this.hires.values()) {
      if (
        hire.state !== "funded" &&
        hire.state !== "delivered" &&
        hire.state !== "released" &&
        hire.state !== "refunded"
      ) {
        continue;
      }
      if (!hire.cartId) continue;
      const cart = this.carts.get(hire.cartId);
      if (!cart) continue;
      const bound = this.occupyingPayment(cart);
      if (bound?.payload.id === payment.payload.id) return true;
    }
    return false;
  }

  /**
   * verifyChain against the first payment key that actually signed the check.
   * Speaker, buyer, intent subject, and a human supervisor are candidates.
   * Who may spend is mandate.subject_is_actor, not a broken chain.
   */
  private paymentChainOk(
    intent: Signed<IntentMandate>,
    cart: Signed<CartMandate>,
    payment: Signed<PaymentMandate>,
    paymentSignerIds: AgentId[],
    checkExp: boolean,
  ): boolean {
    const seen = new Set<string>();
    for (const signerId of paymentSignerIds) {
      if (seen.has(signerId)) continue;
      seen.add(signerId);
      const intentKey = this.keyByKid(intent.payload.issuerId, intent.kid);
      const cartKey = this.keyByKid(cart.payload.merchant.id, cart.kid);
      const paymentKey = this.keyByKid(signerId, payment.kid) ?? this.identity.keys.get(signerId);
      if (!intentKey || !cartKey || !paymentKey) continue;
      const chain = verifyChain({
        intent,
        cart,
        payment,
        intentKey,
        cartKey,
        paymentKey,
        nowIso: this.clock.now(),
        checkExp,
      });
      if (chain.ok) return true;
    }
    return false;
  }

  /** Live hire holds a cart, and that cart has a payment. A body cartId is not a bind. */
  private hireMandateBound(hire: HireContract): boolean {
    if (!hire.cartId) return false;
    const cart = this.carts.get(hire.cartId);
    if (!cart) return false;
    return this.anyPaymentMatchingCart(cart) !== undefined;
  }

  private paymentForHire(hire: HireContract): Signed<PaymentMandate> {
    if (!hire.cartId) throw new Error("hire has no cart");
    const cart = this.carts.get(hire.cartId);
    if (!cart) throw new Error("missing cart");
    const payment = this.occupyingPayment(cart);
    if (!payment) throw new Error("missing payment mandate for hire");
    return payment;
  }

  private noteSpend(hire: HireContract) {
    const now = this.clock.now();
    let cursor: MandateId | undefined = hire.intentId;
    const seen = new Set<MandateId>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      this.spentByIntent.set(cursor, (this.spentByIntent.get(cursor) ?? 0) + hire.price.amount);
      this.occurrences.set(cursor, (this.occurrences.get(cursor) ?? 0) + 1);
      this.lastOccurrence.set(cursor, now);
      cursor = this.intents.get(cursor)?.payload.parentId;
    }
    this.clearing.record(hire.buyerId, hire.sellerId, hire.price.amount, hire.price.currency);
    this.noteVolume(hire.price.amount);
  }

  private noteRefund(hire: HireContract) {
    let cursor: MandateId | undefined = hire.intentId;
    const seen = new Set<MandateId>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const next = (this.spentByIntent.get(cursor) ?? 0) - hire.price.amount;
      this.spentByIntent.set(cursor, next < 0 ? 0 : next);
      cursor = this.intents.get(cursor)?.payload.parentId;
    }
    this.clearing.record(hire.sellerId, hire.buyerId, hire.price.amount, hire.price.currency);
    this.dailySpend = Math.max(0, this.dailySpend - hire.price.amount);
  }

  private noteVolume(volume: number) {
    this.dailySpend += volume;
    if (this.dailySpend > this.dailyLimit) this.circuitTripped = true;
    this.settleEvents.push({ at: this.clock.now(), volume });
  }

  private kyaRequired(cmd: Command, actor: Agent, hire?: HireContract, intent?: Signed<IntentMandate>): boolean {
    if (!KYA_GATED_COMMANDS.includes(cmd.type)) return false;
    if (HIRE_LIVE_COMMANDS.has(cmd.type) && (!hire || hire.id === "hid_draft")) return false;
    if (cmd.type === "hire.create" && !intent) return false;
    if (cmd.type === "mandate.issue_intent" || cmd.type === "kya.attest") {
      if (actor.role === "human_operator" || actor.role === "treasury") return false;
    }
    if (cmd.type === "kya.attest") {
      const id = (cmd.body as Record<string, unknown>).delegateId;
      if (typeof id !== "string" || !this.identity.get(id as AgentId)) return false;
      const principal = (cmd.body as Record<string, unknown>).principalId;
      if (typeof principal === "string" && !this.identity.get(principal as AgentId)) return false;
    }
    return true;
  }

  private assertKyaNestedParentsLive(actor: Agent, intent?: Signed<IntentMandate>) {
    const principalId = intent?.payload.issuerId;
    if (!principalId || actor.id === principalId) return;
    const hops = this.kya.path(principalId, actor.id, this.clock.now()) ?? [];
    const nested = nestedKyaParentsLive(
      hops,
      (id) => this.kya.attestations.get(id),
      this.clock.now(),
    );
    if (nested === false) throw new Error("kya parent hop not live");
  }

  private resolveKya(
    cmd: Command,
    actor: Agent,
    intent: Signed<IntentMandate> | undefined,
    body: Record<string, unknown>,
    parentIntent: Signed<IntentMandate> | undefined,
    hire: HireContract | undefined,
    ctx: PolicyContext,
  ) {
    const required = this.kyaRequired(cmd, actor, hire, intent);
    let principalId = intent?.payload.issuerId;
    if (cmd.type === "kya.attest") {
      principalId = this.kyaPrincipalId(body, actor);
    }
    if (cmd.type === "mandate.issue_intent" && !principalId) {
      principalId = parentIntent?.payload.issuerId ?? actor.supervisors[0];
    }
    const principal = principalId ? this.identity.get(principalId) : undefined;
    const proposed = this.proposedKyaGrant(cmd, body, ctx);
    const input: Parameters<typeof resolveKya>[0] = {
      required,
      actor,
      graph: this.kya,
      nowIso: this.clock.now(),
    };
    if (principalId) input.principalId = principalId;
    if (principal) input.principal = principal;
    if (proposed !== undefined) input.proposedMaxAutonomy = proposed;
    return resolveKya(input);
  }

  /**
   * Omitted principalId is the speaker. Snapshot (party / unique_live / KYA path)
   * and mutate share this so an L4 omit is not evaluated as the supervisor's hop.
   */
  private kyaPrincipalId(body: Record<string, unknown>, actor: Agent): AgentId {
    return typeof body.principalId === "string" ? (body.principalId as AgentId) : actor.id;
  }

  /** Omitted expiresAt is one year from now. Snapshot and mutate share this. */
  private kyaExpiresAt(body: Record<string, unknown>): string {
    return typeof body.expiresAt === "string"
      ? body.expiresAt
      : new Date(Date.parse(this.clock.now()) + KYA_TTL_MS).toISOString();
  }

  /** Omitted maxAutonomy is L5. An agent may not grant a ceiling above its own rung. */
  private kyaGrantCeiling(body: Record<string, unknown>, actor: Agent): AutonomyLevel {
    const ceiling = (typeof body.maxAutonomy === "number" ? body.maxAutonomy : 5) as AutonomyLevel;
    if (actor.role !== "human_operator" && actor.role !== "treasury" && ceiling > actor.autonomyLevel) {
      throw new Error("kya capability");
    }
    return ceiling;
  }

  /**
   * Snapshot the mutate default (omit → 5) only on a clean attest, so unique_live /
   * party / not_self / known_parent keep first deny. Explicit maxAutonomy always binds.
   */
  private proposedKyaGrant(
    cmd: Command,
    body: Record<string, unknown>,
    ctx: PolicyContext,
  ): AutonomyLevel | undefined {
    if (typeof body.maxAutonomy === "number") return body.maxAutonomy as AutonomyLevel;
    if (cmd.type !== "kya.attest") return undefined;
    if (
      ctx.kyaNotSelf === true &&
      ctx.kyaPartyOk === true &&
      ctx.kyaLiveFree === true &&
      ctx.targetKnown === true &&
      ctx.kyaParentKnown !== false
    ) {
      return 5;
    }
    return undefined;
  }

  private registerBookNames(role: AgentRole, key: string): { cashName: string; usdcName?: string } {
    if (role === "market_maker") {
      return { cashName: "market_maker:cash_usd", usdcName: "market_maker:cash_usdc" };
    }
    if (role === "data_vendor") return { cashName: `${key}:cash`, usdcName: `${key}:usdc` };
    return { cashName: `${key}:cash` };
  }

  private aliasOf(id: AgentId): string | undefined {
    for (const [k, v] of this.aliases) if (v === id) return k;
    return undefined;
  }

  private keyOf(id: AgentId): string {
    const k = this.aliasOf(id);
    if (!k) throw new Error(`no alias for ${id}`);
    return k;
  }
}

export function cmd(type: CommandType, actorId: AgentId | "system", body: unknown, idempotencyKey?: string): Command {
  return idempotencyKey ? { type, actorId, body, idempotencyKey } : { type, actorId, body };
}

function skillsFor(role: AgentRole): Array<{ id: string; name: string; description: string }> {
  const skills: Record<AgentRole, Array<{ id: string; name: string; description: string }>> = {
    human_operator: [
      { id: "mandate", name: "Issue mandates", description: "Write permission slips agents must obey." },
      { id: "kya", name: "Know Your Agent", description: "Handshake and revoke who may spend in your name." },
    ],
    treasury: [
      { id: "fund", name: "Allocate cash", description: "Move cash to operating agents." },
      { id: "approve", name: "Approve exceptions", description: "Sign escalation tickets above threshold." },
      { id: "clearing", name: "Close a settlement window", description: "Archive net exposure. Not a second payment." },
    ],
    procurement: [{ id: "hire", name: "Hire vendors", description: "RFQ, hire, escrow, and settle against a mandate." }],
    data_vendor: [{ id: "sell-data", name: "Sell data", description: "Quote and deliver datasets once escrow is funded." }],
    compute_vendor: [{ id: "sell-compute", name: "Sell compute", description: "Quote and deliver GPU hours once escrow is funded." }],
    market_maker: [{ id: "fx-window", name: "FX window", description: "Convert USD_SIM to USDC_SIM inside a 200 bps band." }],
    auditor: [{ id: "verify", name: "Verify audit chain", description: "Replay the notary book. Cannot spend." }],
  };
  return skills[role];
}

export { analog, IDLE_TLDR, NIGHT_WATCH_TLDR, SPRINT_TLDR, SUBHIRE_TLDR, CLEARING_TLDR, REFUND_TLDR, REPLAY_TLDR, NONCE_TLDR, DENY_CACHE_TLDR, RECURRENCE_TLDR, CALENDAR_TLDR, SLOT_TLDR, DAILY_TLDR, CART_TLDR, VELOCITY_TLDR, DOOR_TLDR, MATCH_TLDR, ROOM_TLDR, CONVERSION_TLDR, PAIR_TLDR, BAND_TLDR, NEST_TLDR, HEIR_TLDR, STOCK_TLDR, PURSE_TLDR, SEAT_TLDR, COVER_TLDR, MINT_TLDR, PAYEE_TLDR, CLIMB_TLDR, BORN_TLDR, REACH_TLDR, YEAR_TLDR, FUSE_TLDR, SKU_TLDR, PRICED_TLDR, PARTY_TLDR, CASH_TLDR, STALE_TLDR, CHAIN_TLDR, ARROW_TLDR, WALLET_TLDR, NAME_TLDR, PANE_TLDR, SUBJECT_TLDR, PAPER_TLDR, MIX_TLDR, RUNG_TLDR, GRADE_TLDR, CRADLE_TLDR, CEILING_TLDR, LAPSE_TLDR, PAUSE_TLDR, MIRROR_TLDR, WARRANT_TLDR, VACANT_TLDR, BADGE_TLDR, LID_TLDR, BARE_TLDR, SHELF_TLDR, HALL_TLDR, WRIT_TLDR, CRATE_TLDR, PACT_TLDR, ROOT_TLDR, DOCKET_TLDR, GRAFT_TLDR, SEAL_TLDR, GUEST_TLDR, DUST_TLDR, THAW_TLDR, TWIN_TLDR, FENCE_TLDR, MUTE_TLDR, NIL_TLDR, SPARK_TLDR, WILT_TLDR, MAKER_TLDR, INK_TLDR, BRIM_TLDR, SWAP_TLDR, SOUR_TLDR, CUT_TLDR, ICE_TLDR, RAIL_TLDR, PEN_TLDR, WELL_TLDR, CITE_TLDR, LOCK_TLDR, VOID_TLDR, FOLD_TLDR, RIP_TLDR, SHUT_TLDR, DUMP_TLDR, SPIKE_TLDR, WEEK_TLDR, GULF_TLDR, COFFER_TLDR, CLASH_TLDR, HATCH_TLDR, nightWatchAnalog };
export type { Analog, StoryBeat };
export { WORLD_VERSION };
export type { WorldState };
export { err, fail, ok, settlementFail };
export type { Clock };
export {
  admitSpeaker,
  admitInvoice,
  hostedSystemOpen,
  invoiceCurrent,
  parseHostedMonthly,
  signSpeaker,
  speakerKeyOf,
  speakerMessage,
  HOST_INVOICE_WINDOW_MS,
} from "./host-door.js";
export type { AdmitResult, HostDoorRuntime } from "./host-door.js";
export {
  missingCommandFields,
  commandBodySchema,
  commandShapeError,
  malformedMoneyFields,
  malformedEnumFields,
  malformedIntegerFields,
  malformedTypeFields,
  malformedNestedFields,
} from "./command-schema.js";
