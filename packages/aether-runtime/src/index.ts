import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuditLog, genesisRecord } from "@aether/audit";
import { signInner, verifyInner } from "@aether/envelope";
import { transitionHire } from "@aether/escrow";
import { IdentityRegistry, legalLadderTransition, makeAgent, missingGates } from "@aether/identity";
import {
  exportKeypair,
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
import { Ledger } from "@aether/ledger";
import { cartHash, intentHash, signMandate, verifyChain } from "@aether/mandate";
import { CATALOG, isCatalogSku, fxPayout } from "@aether/market";
import { ExposureBook } from "@aether/clearing";
import { DelegationGraph, resolveKya } from "@aether/kya";
import { evaluate, remediationFor } from "@aether/policy";
import { SIM_RAIL, settlementFail } from "@aether/settlement";
import { commandShapeError } from "./command-schema.js";
import { analog, autoBeat, IDLE_TLDR, SPRINT_TLDR, type Analog, type StoryBeat } from "./story.js";
import { WORLD_VERSION, type WorldState } from "./world.js";
import type {
  AccountId,
  Agent,
  AgentId,
  AgentRole,
  AetherError,
  ApprovalId,
  ApprovalTicket,
  AutonomyLevel,
  CartMandate,
  Command,
  CommandType,
  CurrencyCode,
  DelegationAttestation,
  DelegationId,
  HireContract,
  HireId,
  Instant,
  IntentMandate,
  JournalEntry,
  KyaIssuerKind,
  LadderExtraGate,
  LineItem,
  MandateConstraint,
  MandateId,
  Merchant,
  Money,
  PaymentMandate,
  PolicyContext,
  PolicyDecision,
  Quote,
  Receipt,
  Result,
  Rfq,
  Signed,
  WindowId,
} from "@aether/types";
import { err } from "@aether/kernel";
import { KYA_GATED_COMMANDS, KYA_MAX_DEPTH, PROTOCOL, SIM_RAIL_ID, VELOCITY_CAPS } from "@aether/types";

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

const SIM_INSTRUMENT = {
  id: "sim-ledger",
  type: "sim_ledger" as const,
  description: "Aether simulated double-entry ledger",
};

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
  circuitTripped = false;
  tldr = IDLE_TLDR;
  analogDoc: Analog = analog();
  readonly genesisNonce: string;
  readonly dataDir?: string;
  private readonly worldPath?: string;

  constructor(opts: {
    startIso: string;
    genesisNonce: string;
    dailyLimit?: number;
    auditPath?: string;
    ledgerPath?: string;
    dataDir?: string;
  }) {
    const worldPath = opts.dataDir ? join(opts.dataDir, "world.json") : undefined;
    const existing =
      worldPath && existsSync(worldPath) ? (JSON.parse(readFileSync(worldPath, "utf8")) as WorldState) : undefined;
    this.clock = new ManualClock(existing?.clock ?? opts.startIso);
    this.ids = new IdFactory(this.clock);
    this.genesisNonce = existing?.genesisNonce ?? opts.genesisNonce;
    this.dataDir = opts.dataDir;
    this.worldPath = worldPath;
    if (opts.dataDir) mkdirSync(opts.dataDir, { recursive: true });
    this.audit = new AuditLog(opts.dataDir ? join(opts.dataDir, "audit.jsonl") : opts.auditPath);
    this.ledger = new Ledger(opts.dataDir ? undefined : opts.ledgerPath);
    this.dailyLimit = existing?.dailyLimit ?? opts.dailyLimit ?? 10_000_000;
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

  alias(key: string): Agent {
    const id = this.aliases.get(key);
    if (!id) throw new Error(`unknown alias ${key}`);
    return this.identity.require(id);
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
    const actor = cmd.actorId === "system" ? this.systemActor() : this.identity.require(cmd.actorId);
    const ctx = this.snapshot(cmd, actor, opts?.thresholdWaived === true);
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
      intents: [...this.intents.values()].map((s) => s.payload),
      spentByIntent: Object.fromEntries(this.spentByIntent),
      hires: [...this.hires.values()],
      rfqs: [...this.rfqs.values()],
      quotes: [...this.quotes.values()],
      receipts: [...this.receipts.values()],
      approvals: [...this.approvals.values()],
      story: this.story,
      analog: this.analogDoc,
      tldr: this.tldr,
      kya: this.kya.snapshot(),
      circuit: { dailySpend: this.dailySpend, dailyLimit: this.dailyLimit, tripped: this.circuitTripped },
      clearing: this.clearing.snapshot(),
      agentCards: this.identity.all().map((a) => this.agentCard(a)),
      audit: { length: this.audit.length, verify, head: this.audit.head(), tail: this.audit.all().slice(-12) },
      decisions: this.decisions.slice(-40),
    };
  }

  protocolCard() {
    return {
      ...PROTOCOL,
      durable: Boolean(this.worldPath),
      dataDir: this.dataDir ?? null,
      clock: this.clock.now(),
      auditHead: this.audit.head(),
      auditLength: this.audit.length,
    };
  }

  /**
   * Fetch one object by id (or alias). Prefix selects the table:
   * aid_ agent, hid_ hire, mid_ mandate, rid_ receipt, apd_ approval,
   * rfq_ / qte_ market, acct_ / name account, dlg_ KYA hop.
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
      return hire ? { type: "hire", id: hire.id, value: hire } : undefined;
    }
    if (id.startsWith("mid_")) {
      const intent = this.intents.get(id as MandateId);
      if (intent) return { type: "intent", id, value: intent };
      const cart = this.carts.get(id as MandateId);
      if (cart) return { type: "cart", id, value: cart };
      const payment = this.payments.get(id as MandateId);
      if (payment) return { type: "payment", id, value: payment };
      return undefined;
    }
    if (id.startsWith("rid_")) {
      const receipt = this.receipts.get(id);
      return receipt ? { type: "receipt", id: receipt.id, value: receipt } : undefined;
    }
    if (id.startsWith("apd_")) {
      const ticket = this.approvals.get(id as ApprovalId);
      return ticket ? { type: "approval", id: ticket.id, value: ticket } : undefined;
    }
    if (id.startsWith("rfq_")) {
      const rfq = this.rfqs.get(id);
      return rfq ? { type: "rfq", id: rfq.id, value: rfq } : undefined;
    }
    if (id.startsWith("qte_")) {
      const quote = this.quotes.get(id);
      return quote ? { type: "quote", id: quote.id, value: quote } : undefined;
    }
    if (id.startsWith("dlg_")) {
      const att = this.kya.attestations.get(id as DelegationId);
      return att ? { type: "delegation", id: att.id, value: att } : undefined;
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
    const keys = [...this.identity.keys.entries()].map(([, kp]) => exportKeypair(kp));
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
      reservedQuotes: [...this.reservedQuotes.entries()],
      settledFxQuotes: [...this.consumedQuotes],
      settleEvents: [...this.settleEvents],
      decisions: [...this.decisions],
      story: [...this.story],
      kya: { attestations: [...this.kya.attestations.values()], blocked: [...this.kya.blocked] },
      clearing: { legs: this.clearing.snapshot().legs, windows: this.clearing.windows },
      killSwitchTested: [...this.killSwitchTested],
      idempotency: [...this.idempotency.entries()],
    };
  }

  persistWorld(): void {
    if (!this.worldPath) return;
    const tmp = `${this.worldPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.captureWorld()));
    renameSync(tmp, this.worldPath);
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
    const keyByKid = new Map(world.keys.map((k) => [k.kid, k]));
    for (const agent of world.agents) {
      const kid = agent.keys[0]?.kid;
      const exported = kid ? keyByKid.get(kid) : undefined;
      if (!exported) throw new Error(`missing key for ${agent.id}`);
      this.identity.register(agent, importKeypair(exported));
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
    return !live || live.status === "pending";
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
      expiresAt: new Date(Date.parse(this.clock.now()) + 86_400_000).toISOString(),
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
      const chain = verifyChain({
        intent,
        cart,
        payment,
        intentKey: this.keypair(intent.payload.issuerId),
        cartKey: this.keypair(cart.payload.merchant.id),
        paymentKey: this.keypair(actor.id),
        nowIso: this.clock.now(),
      });
      // Payment may be signed by actor or a human supervisor — try both.
      chainOk = chain.ok;
      if (!chain.ok) {
        const human = counterparties.find((a) => a.role === "human_operator");
        if (human) {
          const retry = verifyChain({
            intent,
            cart,
            payment,
            intentKey: this.keypair(intent.payload.issuerId),
            cartKey: this.keypair(cart.payload.merchant.id),
            paymentKey: this.keypair(human.id),
            nowIso: this.clock.now(),
          });
          chainOk = retry.ok;
        }
      }
    }
    const velocityWindow = this.velocity();
    const audit = this.audit.verify();
    const fxRateE6 = typeof body.rateE6 === "number" ? body.rateE6 : this.quoteOf(body)?.fx?.rateE6;
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
    if (intent) ctx.intent = intent;
    if (intent) {
      const last = this.lastOccurrence.get(intent.payload.id);
      if (last) ctx.lastOccurrenceAt = last;
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
    if (cmd.type === "hire.create" || cmd.type === "mandate.issue_cart") {
      ctx.intentKnown = Boolean(intent);
    }
    if (cmd.type === "mandate.issue_payment") {
      ctx.cartKnown = Boolean(cart);
    }
    if (cmd.type === "approval.resolve") {
      const ticket =
        typeof body.approvalId === "string" ? this.approvals.get(body.approvalId as ApprovalId) : undefined;
      ctx.approvalKnown = Boolean(ticket);
      if (ticket) {
        ctx.approvalPending =
          ticket.status === "pending" && Date.parse(ticket.expiresAt) > Date.parse(this.clock.now());
      }
    }
    if (hire && hire.id !== "hid_draft") {
      if (cmd.type === "hire.accept" || cmd.type === "hire.deliver" || cmd.type === "envelope.require") {
        ctx.hirePartyOk = hire.sellerId === actor.id;
      } else if (cmd.type === "hire.refund" || cmd.type === "hire.release") {
        ctx.hirePartyOk = hire.buyerId === actor.id || actor.role === "treasury";
      }
    }
    if (amount) ctx.amount = amount;
    if (payeeId) ctx.payeeId = payeeId;
    if (fxRateE6 !== undefined) ctx.fxRateE6 = fxRateE6;
    if (nonce !== undefined) ctx.nonceSeen = this.nonces.has(nonce);
    if (mmInventoryOk !== undefined) ctx.mmInventoryOk = mmInventoryOk;
    if (chainOk !== undefined) ctx.chainOk = chainOk;
    if (thresholdWaived) ctx.thresholdWaived = true;
    if (payeeId && amount) {
      ctx.projectedExposure = this.clearing.projected(actor.id, payeeId, amount.currency, amount.amount);
      ctx.exposureLimit = this.clearing.defaultBilateralLimit;
    }
    const parentId =
      (typeof body.parentId === "string" ? (body.parentId as MandateId) : undefined) ?? intent?.payload.parentId;
    const parentIntent = parentId ? this.intents.get(parentId) : undefined;
    if (parentIntent) {
      ctx.parentIntent = parentIntent;
      ctx.parentSpent = this.spentByIntent.get(parentIntent.payload.id) ?? 0;
      ctx.parentOccurrenceCount = this.occurrences.get(parentIntent.payload.id) ?? 0;
      const parentLast = this.lastOccurrence.get(parentIntent.payload.id);
      if (parentLast) ctx.parentLastOccurrenceAt = parentLast;
    }
    if (cmd.type === "mandate.issue_intent" && Array.isArray(body.constraints)) {
      ctx.proposedConstraints = body.constraints as MandateConstraint[];
    }
    const market = this.marketFlags(cmd, body, hire, actor, thresholdWaived);
    if (market.skuListed !== undefined) ctx.skuListed = market.skuListed;
    if (market.marketFresh !== undefined) ctx.marketFresh = market.marketFresh;
    if (market.sellerInvited !== undefined) ctx.sellerInvited = market.sellerInvited;
    if (market.rfqKnown !== undefined) ctx.rfqKnown = market.rfqKnown;
    if (market.fxQuoteLive !== undefined) ctx.fxQuoteLive = market.fxQuoteLive;
    if (market.quoteUnspent !== undefined) ctx.quoteUnspent = market.quoteUnspent;
    const cartMatch = this.cartFlags(cmd, body, hire, cart);
    if (cartMatch.cartMatchesHire !== undefined) ctx.cartMatchesHire = cartMatch.cartMatchesHire;
    ctx.kya = this.resolveKya(cmd, actor, intent, body, parentIntent, hire);
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
    } = {};
    if (cmd.type === "market.rfq") {
      out.skuListed = typeof sku === "string" && isCatalogSku(sku);
      return out;
    }
    if (cmd.type === "market.quote") {
      out.rfqKnown = Boolean(rfq);
      if (rfq) {
        out.skuListed = typeof sku === "string" && isCatalogSku(sku);
        out.marketFresh = Date.parse(rfq.expiresAt) > now;
        const invited = Array.isArray(rfq.invitedSellerIds) ? rfq.invitedSellerIds : [];
        out.sellerInvited = invited.length === 0 || invited.includes(actor.id);
      }
      return out;
    }
    if (cmd.type === "hire.create") {
      out.rfqKnown = Boolean(quote && rfq);
      if (quote && rfq) {
        out.skuListed = typeof sku === "string" && isCatalogSku(sku);
        out.marketFresh = Date.parse(quote.expiresAt) > now && Date.parse(rfq.expiresAt) > now;
        const invited = Array.isArray(rfq.invitedSellerIds) ? rfq.invitedSellerIds : [];
        out.sellerInvited = invited.length === 0 || invited.includes(quote.sellerId);
        const consumed = this.consumedQuotes.has(quote.id);
        const reserved = this.reservedQuotes.has(quote.id);
        out.quoteUnspent = thresholdWaived && reserved && !consumed ? true : !consumed && !reserved;
      }
      return out;
    }
    if (cmd.type === "market.fx_settle") {
      const live =
        Boolean(quote?.fx) &&
        quote !== undefined &&
        !this.consumedQuotes.has(quote.id) &&
        !this.reservedQuotes.has(quote.id);
      out.fxQuoteLive = live;
      if (quote?.fx && live) {
        const fxOk = Date.parse(quote.fx.validUntil) > now;
        out.marketFresh = Date.parse(quote.expiresAt) > now && fxOk;
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
    _cmd: Command,
    body: Record<string, unknown>,
    hire?: HireContract,
  ): Signed<IntentMandate> | undefined {
    const id = (body.intentId as MandateId | undefined) ?? hire?.intentId;
    return id ? this.intents.get(id) : undefined;
  }

  private lookupCart(body: Record<string, unknown>, hire?: HireContract): Signed<CartMandate> | undefined {
    const id = (body.cartId as MandateId | undefined) ?? hire?.cartId;
    return id ? this.carts.get(id) : undefined;
  }

  private lookupPayment(body: Record<string, unknown>, hire?: HireContract): Signed<PaymentMandate> | undefined {
    const id = body.paymentMandateId as MandateId | undefined;
    if (id) return this.payments.get(id);
    if (hire?.cartId) {
      for (const p of this.payments.values()) {
        const cart = this.carts.get(hire.cartId);
        if (cart && p.payload.transaction_id === cartHash(cart.payload)) return p;
      }
    }
    return undefined;
  }

  private lookupAmount(
    cmd: Command,
    body: Record<string, unknown>,
    hire?: HireContract,
    payment?: Signed<PaymentMandate>,
  ): Money | undefined {
    if (cmd.type === "hire.deliver" || cmd.type === "hire.accept" || cmd.type === "hire.refund" || cmd.type === "envelope.require" || cmd.type === "audit.verify" || cmd.type === "audit.query" || cmd.type === "market.catalog" || cmd.type === "ledger.balances" || cmd.type === "receipt.get" || cmd.type === "approval.resolve" || cmd.type === "kya.attest" || cmd.type === "kya.revoke" || cmd.type === "identity.freeze" || cmd.type === "identity.unfreeze" || cmd.type === "circuit.reset" || cmd.type === "ladder.set") {
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
      case "mandate.issue_cart":
        return this.mutCart(body, actor);
      case "mandate.issue_payment":
        return this.mutPayment(body, actor);
      case "market.rfq":
        return this.mutRfq(body, actor);
      case "market.quote":
        return this.mutQuote(body, actor);
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
      case "receipt.get":
        return this.receipts.get(String(body.receiptId));
      default:
        throw new Error(`unhandled ${cmd.type}`);
    }
  }

  private mutRegister(body: Record<string, unknown>, actor: Agent) {
    const role = body.role as AgentRole;
    const key = String(body.key ?? body.displayName);
    const kp = this.identity.mintKey(`kid_${key}`);
    const cashName =
      role === "market_maker" ? "market_maker:cash_usd" : `${key}:cash`;
    const cash = this.ledger.openAccount({
      id: this.ids.next("acct") as AccountId,
      ownerId: "system",
      name: cashName,
      type: "asset",
      currency: "USD_SIM",
    });
    if (role === "market_maker" || role === "data_vendor") {
      const usdcName = role === "market_maker" ? "market_maker:cash_usdc" : `${key}:usdc`;
      this.ledger.openAccount({
        id: this.ids.next("acct") as AccountId,
        ownerId: "system",
        name: usdcName,
        type: "asset",
        currency: "USDC_SIM",
      });
    }
    const agent = makeAgent({
      id: this.ids.next("aid") as AgentId,
      displayName: String(body.displayName),
      role,
      autonomyLevel: (body.autonomyLevel as AutonomyLevel) ?? 0,
      accountId: cash.id,
      supervisors: actor.role === "human_operator" ? [actor.id] : [],
      createdAt: this.clock.now(),
      keypair: kp,
    });
    // Fix owner after we have the id.
    (cash as { ownerId: AgentId }).ownerId = agent.id;
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
    const wasFrozen = before.frozen;
    const agent = this.identity.unfreeze(body.agentId as AgentId);
    if (wasFrozen) this.killSwitchTested.add(agent.id);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "UNFREEZE",
      subjects: [{ type: "agent", id: agent.id }],
      payload: { id: agent.id, restored: agent.autonomyLevel, killSwitchTested: wasFrozen },
    });
    return agent;
  }

  private mutKyaAttest(body: Record<string, unknown>, actor: Agent) {
    const delegateId = body.delegateId as AgentId;
    this.identity.require(delegateId);
    const principalId = (body.principalId as AgentId | undefined) ?? actor.id;
    const att: DelegationAttestation = {
      id: this.ids.next("dlg") as DelegationId,
      vct: "aether.kya.delegation.1",
      issuerKind: (body.issuerKind as KyaIssuerKind | undefined) ?? "aether.self",
      principalId,
      grantorId: actor.id,
      delegateId,
      maxAutonomy: (body.maxAutonomy as AutonomyLevel | undefined) ?? 5,
      maxDepth: KYA_MAX_DEPTH,
      createdAt: this.clock.now(),
      expiresAt:
        typeof body.expiresAt === "string"
          ? body.expiresAt
          : new Date(Date.parse(this.clock.now()) + 365 * 24 * 3600 * 1000).toISOString(),
    };
    if (typeof body.parentId === "string") att.parentId = body.parentId as DelegationId;
    this.kya.attest(att);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "KYA_ATTEST",
      subjects: [
        { type: "delegation", id: att.id },
        { type: "delegate", id: delegateId },
      ],
      payload: { id: att.id, principalId, delegateId, maxAutonomy: att.maxAutonomy, issuerKind: att.issuerKind },
    });
    return att;
  }

  private mutKyaRevoke(body: Record<string, unknown>, actor: Agent) {
    const principalId = (body.principalId as AgentId | undefined) ?? actor.id;
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
    const legal = legalLadderTransition(target.autonomyLevel, to);
    if (!legal) throw new Error(`illegal ladder ${target.autonomyLevel} -> ${to}`);
    const gates = (body.gates as LadderExtraGate[] | undefined) ?? [];
    if (legal.extraGates.includes("kill_switch_tested") && !this.killSwitchTested.has(target.id)) {
      throw new Error("missing gates kill_switch_tested");
    }
    if (legal.extraGates.includes("circuit_breaker_configured") && !(this.dailyLimit > 0 && this.dailyLimit < 100_000_000)) {
      throw new Error("missing gates circuit_breaker_configured");
    }
    const missing = missingGates(legal.extraGates, gates);
    if (missing.length) throw new Error(`missing gates ${missing.join(",")}`);
    if (legal.requiredApproverRoles.length && !legal.requiredApproverRoles.includes(actor.role) && to !== 0) {
      throw new Error(`approver role ${actor.role} cannot set ladder`);
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
    const payload: IntentMandate = {
      vct: "aether.mandate.intent.open.1",
      id: this.ids.next("mid") as MandateId,
      issuerId: actor.id,
      subjectId: body.subjectId as AgentId,
      task: String(body.task),
      constraints: body.constraints as MandateConstraint[],
      iat: unixSeconds(this.clock.now()),
      exp: unixSeconds(this.clock.now()) + 7 * 24 * 3600,
    };
    if (typeof body.parentId === "string") payload.parentId = body.parentId as MandateId;
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

  private mutCart(body: Record<string, unknown>, actor: Agent) {
    const intent = this.intents.get(body.intentId as MandateId);
    if (!intent) throw new Error("unknown intent");
    const merchantAgent = this.identity.require(body.merchantId as AgentId);
    const lineItems = body.line_items as CartMandate["line_items"];
    const total = lineItems.reduce(
      (s, l) => ({ amount: s.amount + l.unitAmount.amount * l.quantity, currency: l.unitAmount.currency }),
      { amount: 0, currency: lineItems[0]!.unitAmount.currency },
    );
    const payload: CartMandate = {
      vct: "aether.mandate.cart.1",
      id: this.ids.next("mid") as MandateId,
      intentId: intent.payload.id,
      intentHash: intentHash(intent.payload),
      merchant: this.merchant(merchantAgent),
      line_items: lineItems,
      total,
      expiresAt: new Date(Date.parse(this.clock.now()) + 86_400_000).toISOString(),
      userConfirmationRequired: actor.autonomyLevel < 2,
    };
    const signed = signMandate(payload, merchantAgent.did, this.keypair(merchantAgent.id));
    this.carts.set(payload.id, signed);
    if (typeof body.hireId === "string") {
      const hire = this.hires.get(body.hireId as HireId);
      if (hire) this.hires.set(hire.id, { ...hire, cartId: payload.id });
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
    const payload: PaymentMandate = {
      vct: "aether.mandate.payment.1",
      id: this.ids.next("mid") as MandateId,
      transaction_id: cartHash(cart.payload),
      payee: cart.payload.merchant,
      payment_amount: cart.payload.total,
      payment_instrument: SIM_INSTRUMENT,
      iat: unixSeconds(this.clock.now()),
      exp: unixSeconds(this.clock.now()) + 86_400_000,
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
      expiresAt: new Date(Date.parse(this.clock.now()) + 86_400_000).toISOString(),
    };
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

  private mutQuote(body: Record<string, unknown>, actor: Agent) {
    const quote: Quote = {
      id: this.ids.next("qte") as Quote["id"],
      rfqId: body.rfqId as Quote["rfqId"],
      sellerId: actor.id,
      price: body.price as Money,
      expiresAt: new Date(Date.parse(this.clock.now()) + 3_600_000).toISOString(),
    };
    if (body.fx) quote.fx = body.fx as Quote["fx"];
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

  private mutHireCreate(body: Record<string, unknown>, actor: Agent) {
    const quote = this.quotes.get(String(body.quoteId));
    const rfq = quote ? this.rfqs.get(quote.rfqId) : undefined;
    if (!quote || !rfq) throw new Error("unknown quote");
    const intent = this.intents.get(body.intentId as MandateId);
    if (!intent) throw new Error("unknown intent");
    if (this.consumedQuotes.has(quote.id)) throw new Error("quote already used");
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

  private mutHireFund(body: Record<string, unknown>, actor: Agent) {
    const hire = this.requireHire(body.hireId as HireId);
    const next = transitionHire(hire, "funded");
    const buyer = this.identity.require(hire.buyerId);
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
    if (this.consumedQuotes.has(quote.id) || this.reservedQuotes.has(quote.id)) {
      throw new Error("fx quote already settled");
    }
    const payout = fxPayout(quote.price.amount, quote.fx.rateE6);
    const vendorUsd = this.ledger.account(`${this.keyOf(actor.id)}:cash`);
    const vendorUsdc = this.ledger.account(`${this.keyOf(actor.id)}:usdc`);
    const mmUsd = this.ledger.account("market_maker:cash_usd");
    const mmUsdc = this.ledger.account("market_maker:cash_usdc");
    this.postJournal("FX USD leg", [
      { accountId: mmUsd.id, debit: quote.price.amount, credit: 0 },
      { accountId: vendorUsd.id, debit: 0, credit: quote.price.amount },
    ]);
    this.postJournal("FX USDC leg", [
      { accountId: vendorUsdc.id, debit: payout, credit: 0 },
      { accountId: mmUsdc.id, debit: 0, credit: payout },
    ]);
    const mm = [...this.identity.all()].find((a) => a.role === "market_maker");
    if (mm) {
      this.clearing.record(actor.id, mm.id, quote.price.amount, quote.fx.from);
      this.clearing.record(mm.id, actor.id, payout, quote.fx.to);
    }
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
    this.approvals.set(ticket.id, next);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "APPROVAL_RESOLVE",
      subjects: [{ type: "approval", id: ticket.id }],
      payload: { id: ticket.id, decision },
    });
    if (decision === "rejected") {
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
    return { ticket: next, hire: replay.value.data, replay: replay.value };
  }

  private mutTransfer(body: Record<string, unknown>) {
    const amount = body.amount as Money;
    const from = this.ledger.account(String(body.fromAccount));
    const to = this.ledger.account(String(body.toAccount));
    return this.postJournal(`Transfer ${body.fromAccount} -> ${body.toAccount}`, [
      { accountId: to.id, debit: amount.amount, credit: 0 },
      { accountId: from.id, debit: 0, credit: amount.amount },
    ]);
  }

  private mutBalances(body: Record<string, unknown>) {
    if (typeof body.name === "string") return this.ledger.balanceByName(body.name);
    if (typeof body.accountId === "string") {
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

  private paymentForHire(hire: HireContract): Signed<PaymentMandate> {
    if (!hire.cartId) throw new Error("hire has no cart");
    const cart = this.carts.get(hire.cartId);
    if (!cart) throw new Error("missing cart");
    for (const p of this.payments.values()) {
      if (p.payload.transaction_id === cartHash(cart.payload)) return p;
    }
    throw new Error("missing payment mandate for hire");
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
    return true;
  }

  private resolveKya(
    cmd: Command,
    actor: Agent,
    intent: Signed<IntentMandate> | undefined,
    body: Record<string, unknown>,
    parentIntent: Signed<IntentMandate> | undefined,
    hire: HireContract | undefined,
  ) {
    const required = this.kyaRequired(cmd, actor, hire, intent);
    let principalId = intent?.payload.issuerId;
    if (cmd.type === "kya.attest") {
      principalId = (body.principalId as AgentId | undefined) ?? actor.supervisors[0] ?? actor.id;
    }
    if (cmd.type === "mandate.issue_intent" && !principalId) {
      principalId = parentIntent?.payload.issuerId ?? actor.supervisors[0];
    }
    const principal = principalId ? this.identity.get(principalId) : undefined;
    const proposed = typeof body.maxAutonomy === "number" ? (body.maxAutonomy as AutonomyLevel) : undefined;
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

  private keyOf(id: AgentId): string {
    for (const [k, v] of this.aliases) if (v === id) return k;
    throw new Error(`no alias for ${id}`);
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

export { analog, IDLE_TLDR, NIGHT_WATCH_TLDR, SPRINT_TLDR, SUBHIRE_TLDR, nightWatchAnalog };
export type { Analog, StoryBeat };
export { WORLD_VERSION };
export type { WorldState };
export { err, fail, ok, settlementFail };
export type { Clock };
export { missingCommandFields, commandBodySchema, commandShapeError, malformedMoneyFields } from "./command-schema.js";
