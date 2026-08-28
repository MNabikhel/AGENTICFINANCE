import { AuditLog, genesisRecord } from "@aether/audit";
import { signInner, verifyInner } from "@aether/envelope";
import { transitionHire } from "@aether/escrow";
import { IdentityRegistry, legalLadderTransition, makeAgent, missingGates } from "@aether/identity";
import {
  fail,
  IdFactory,
  ManualClock,
  ok,
  payloadHash,
  unixSeconds,
  type Clock,
  type Ed25519Keypair,
} from "@aether/kernel";
import { Ledger } from "@aether/ledger";
import { cartHash, intentHash, signMandate, verifyChain } from "@aether/mandate";
import { fxPayout } from "@aether/market";
import { ExposureBook } from "@aether/clearing";
import { evaluate } from "@aether/policy";
import { issueReceipt, paymentRequired, settlementFail, settlementOk } from "@aether/settlement";
import { autoBeat, analog, SPRINT_TLDR, type StoryBeat } from "./story.js";
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
  HireContract,
  HireId,
  IntentMandate,
  JournalEntry,
  LadderExtraGate,
  MandateConstraint,
  MandateId,
  Merchant,
  Money,
  PaymentMandate,
  PaymentPayload,
  PolicyContext,
  PolicyDecision,
  Quote,
  Receipt,
  Result,
  Rfq,
  Signed,
} from "@aether/types";
import { err } from "@aether/kernel";
import { SIM_RAIL_ID, VELOCITY_CAPS } from "@aether/types";

export type DispatchOk = {
  kind: "allow" | "escalated";
  decision: PolicyDecision;
  data: unknown;
  ticket?: ApprovalTicket;
};

export type DispatchFail = {
  error: AetherError;
  decision: PolicyDecision;
};

export type DispatchResult = Result<DispatchOk, DispatchFail>;

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
  readonly settleEvents: { at: string; volume: number }[] = [];
  dailySpend = 0;
  dailyLimit: number;
  readonly decisions: { at: string; type: CommandType; decision: PolicyDecision }[] = [];
  readonly journals: JournalEntry[] = [];
  readonly story: StoryBeat[] = [];
  readonly clearing = new ExposureBook();

  constructor(opts: { startIso: string; genesisNonce: string; dailyLimit?: number; auditPath?: string; ledgerPath?: string }) {
    this.clock = new ManualClock(opts.startIso);
    this.ids = new IdFactory(this.clock);
    this.audit = new AuditLog(opts.auditPath);
    this.ledger = new Ledger(opts.ledgerPath);
    this.dailyLimit = opts.dailyLimit ?? 10_000_000;
    if (this.audit.length === 0) {
      const g = genesisRecord(this.clock, opts.genesisNonce);
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
    usdLines.push({ accountId: this.ledger.account("system:equity").id, debit: 0, credit: usdTotal });
    const usdcTotal = usdcLines.reduce((s, l) => s + l.debit, 0);
    usdcLines.push({ accountId: this.ledger.account("system:equity_usdc").id, debit: 0, credit: usdcTotal });
    this.postJournal("Opening USD cash", usdLines);
    this.postJournal("Opening USDC cash", usdcLines);
  }

  dispatch(cmd: Command, opts?: { thresholdWaived?: boolean; skipStep?: boolean }): DispatchResult {
    if (!opts?.skipStep) this.clock.step();
    const actor = cmd.actorId === "system" ? this.systemActor() : this.identity.require(cmd.actorId);
    const ctx = this.snapshot(cmd, actor, opts?.thresholdWaived === true);
    const decision = evaluate(ctx);
    this.decisions.push({ at: this.clock.now(), type: cmd.type, decision });
    this.pushStory(cmd, actor, decision, ctx);
    this.audit.append({
      clock: this.clock,
      actorId: cmd.actorId,
      action: "POLICY_DECISION",
      subjects: [{ type: "command", id: cmd.type }],
      payload: { type: cmd.type, verdict: decision.verdict, trace: decision.trace.map((t) => ({ ruleId: t.ruleId, verdict: t.verdict })) },
    });
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return fail({
        error: err("policy.deny", "Policy deny", 422, rule?.message ?? "denied", { ruleId: rule?.ruleId }),
        decision,
      });
    }
    if (decision.verdict === "escalate") {
      const ticket = this.openTicket(cmd, decision);
      return ok({ kind: "escalated", decision, data: { ticket }, ticket });
    }
    try {
      const data = this.mutate(cmd, actor);
      return ok({ kind: "allow", decision, data });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return fail({
        error: err("mutate", "Mutation failed", message.startsWith("HIRE") ? 409 : 400, message),
        decision,
      });
    }
  }

  snapshotState() {
    const verify = this.audit.verify();
    return {
      clock: this.clock.now(),
      rail: SIM_RAIL_ID,
      agents: this.identity.all(),
      aliases: Object.fromEntries(this.aliases),
      accounts: [...this.ledger.accounts.values()].map((a) => ({
        ...a,
        balance: this.ledger.balance(a.id),
      })),
      hires: [...this.hires.values()],
      rfqs: [...this.rfqs.values()],
      quotes: [...this.quotes.values()],
      receipts: [...this.receipts.values()],
      approvals: [...this.approvals.values()],
      story: this.story,
      analog: analog(),
      tldr: SPRINT_TLDR,
      clearing: this.clearing.snapshot(),
      agentCards: this.identity.all().map((a) => this.agentCard(a)),
      audit: { length: this.audit.length, verify, head: this.audit.head(), tail: this.audit.all().slice(-12) },
      decisions: this.decisions.slice(-40),
    };
  }

  agentCard(agent: Agent) {
    return {
      protocolVersion: "0.2.1",
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
        tripped: false,
      },
      auditHealthy: audit.ok,
    };
    if (intent) ctx.intent = intent;
    if (cart) ctx.cart = cart;
    if (payment) ctx.payment = payment;
    if (hire) ctx.hire = hire;
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
    return ctx;
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
      ...(ctx.amount ? { amountMinor: ctx.amount.amount } : {}),
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
    if (cmd.type === "hire.deliver" || cmd.type === "hire.accept" || cmd.type === "envelope.require" || cmd.type === "audit.verify" || cmd.type === "ledger.balances" || cmd.type === "receipt.get" || cmd.type === "approval.resolve") {
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
      case "hire.deliver":
        return this.mutHireDeliver(body);
      case "hire.release":
      case "envelope.submit":
        return this.mutRelease(body, actor, cmd.type);
      case "envelope.require":
        return this.mutRequire(body);
      case "approval.resolve":
        return this.mutApprove(body, actor);
      case "ledger.transfer":
        return this.mutTransfer(body);
      case "ledger.balances":
        return this.mutBalances(body);
      case "audit.verify":
        return this.mutAudit(actor);
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

  private mutLadder(body: Record<string, unknown>, actor: Agent) {
    const target = this.identity.require(body.agentId as AgentId);
    const to = body.to as AutonomyLevel;
    const legal = legalLadderTransition(target.autonomyLevel, to);
    if (!legal) throw new Error(`illegal ladder ${target.autonomyLevel} -> ${to}`);
    const gates = (body.gates as LadderExtraGate[] | undefined) ?? [];
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
      invitedSellerIds: body.invitedSellerIds as AgentId[],
      expiresAt: new Date(Date.parse(this.clock.now()) + 86_400_000).toISOString(),
    };
    this.rfqs.set(rfq.id, rfq);
    this.audit.append({
      clock: this.clock,
      actorId: actor.id,
      action: "RFQ_CREATE",
      subjects: [{ type: "rfq", id: rfq.id }],
      payload: { id: rfq.id, sku: rfq.sku },
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

  private mutHireDeliver(body: Record<string, unknown>) {
    const hire = this.requireHire(body.hireId as HireId);
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

  private mutRequire(body: Record<string, unknown>) {
    const hire = this.requireHire(body.hireId as HireId);
    const seller = this.identity.require(hire.sellerId);
    const required = paymentRequired({
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
    const receipt = issueReceipt({
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
    return { hire: next, receipt, settlement: settlementOk({ transaction: receipt.payment_id, payer: actor.accountId, receiptId: receipt.id }) };
  }

  private mutFx(body: Record<string, unknown>, actor: Agent) {
    const quote = this.quoteOf(body);
    if (!quote?.fx) throw new Error("quote is not FX");
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
    return { payout, rateE6: quote.fx.rateE6 };
  }

  private mutApprove(body: Record<string, unknown>, actor: Agent) {
    const ticket = this.approvals.get(body.approvalId as ApprovalId);
    if (!ticket) throw new Error("unknown approval");
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
    if (decision === "rejected") return next;
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
    this.spentByIntent.set(hire.intentId, (this.spentByIntent.get(hire.intentId) ?? 0) + hire.price.amount);
    this.occurrences.set(hire.intentId, (this.occurrences.get(hire.intentId) ?? 0) + 1);
    this.clearing.record(hire.buyerId, hire.sellerId, hire.price.amount, hire.price.currency);
    this.noteVolume(hire.price.amount);
  }

  private noteVolume(volume: number) {
    this.dailySpend += volume;
    this.settleEvents.push({ at: this.clock.now(), volume });
  }

  private keyOf(id: AgentId): string {
    for (const [k, v] of this.aliases) if (v === id) return k;
    throw new Error(`no alias for ${id}`);
  }
}

export function cmd(type: CommandType, actorId: AgentId | "system", body: unknown): Command {
  return { type, actorId, body };
}

function skillsFor(role: AgentRole): Array<{ id: string; name: string; description: string }> {
  const skills: Record<AgentRole, Array<{ id: string; name: string; description: string }>> = {
    human_operator: [{ id: "mandate", name: "Issue mandates", description: "Write permission slips agents must obey." }],
    treasury: [
      { id: "fund", name: "Allocate cash", description: "Move cash to operating agents." },
      { id: "approve", name: "Approve exceptions", description: "Sign escalation tickets above threshold." },
    ],
    procurement: [{ id: "hire", name: "Hire vendors", description: "RFQ, hire, escrow, and settle against a mandate." }],
    data_vendor: [{ id: "sell-data", name: "Sell data", description: "Quote and deliver datasets once escrow is funded." }],
    compute_vendor: [{ id: "sell-compute", name: "Sell compute", description: "Quote and deliver GPU hours once escrow is funded." }],
    market_maker: [{ id: "fx-window", name: "FX window", description: "Convert USD_SIM to USDC_SIM inside a 200 bps band." }],
    auditor: [{ id: "verify", name: "Verify audit chain", description: "Replay the notary book. Cannot spend." }],
  };
  return skills[role];
}

export { analog, SPRINT_TLDR };
export type { StoryBeat };
export { err, fail, ok, settlementFail };
export type { Clock };
