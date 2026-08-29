/**
 * Durable world. The economy is a file, not RAM.
 * `world.json` is the restore source. `audit.jsonl` is the notary.
 * They must agree on length/head or boot refuses.
 *
 * Private keys live here only because this is sim:aether-1.
 * Never put live-rail secrets in a world file.
 */

import type { ExportedKeypair } from "@aether/kernel";
import type {
  Account,
  Agent,
  AgentId,
  ApprovalId,
  ApprovalTicket,
  Command,
  CommandType,
  DelegationAttestation,
  HireContract,
  HostSubscription,
  OperatorInvoice,
  IntentMandate,
  Instant,
  JournalEntry,
  MandateId,
  PaymentMandate,
  PolicyDecision,
  Quote,
  Receipt,
  Rfq,
  SettlementWindow,
  Signed,
  CartMandate,
  KyaIssuer,
} from "@aether/types";
import type { Analog, StoryBeat } from "./story.js";
import type { ExposureLeg } from "@aether/clearing";

export const WORLD_VERSION = 1 as const;

export interface WorldState {
  v: typeof WORLD_VERSION;
  spec: "aether.protocol.1";
  clock: string;
  genesisNonce: string;
  idSeq: number;
  dailyLimit: number;
  dailySpend: number;
  circuitTripped: boolean;
  tldr: string;
  analog: Analog;
  auditLength: number;
  auditHead: string;
  agents: Agent[];
  keys: ExportedKeypair[];
  aliases: Record<string, AgentId>;
  accounts: Account[];
  journals: JournalEntry[];
  intents: Array<Signed<IntentMandate>>;
  carts: Array<Signed<CartMandate>>;
  payments: Array<Signed<PaymentMandate>>;
  hires: HireContract[];
  rfqs: Rfq[];
  quotes: Quote[];
  receipts: Receipt[];
  approvals: ApprovalTicket[];
  pending: Array<[ApprovalId, Command]>;
  nonces: string[];
  spentByIntent: Array<[MandateId, number]>;
  occurrences: Array<[MandateId, number]>;
  lastOccurrence?: Array<[MandateId, Instant]>;
  /** Quote ids already settled via `market.fx_settle`. Optional so 0.13 worlds boot. */
  settledFxQuotes?: string[];
  /** Quote ids consumed by hire.create or fx_settle. Optional so old worlds boot. */
  consumedQuotes?: string[];
  /** Quote id → pending approval id. Optional so old worlds boot. */
  reservedQuotes?: Array<[string, string]>;
  settleEvents: Array<{ at: string; volume: number }>;
  decisions: Array<{ at: string; type: CommandType; decision: PolicyDecision }>;
  story: StoryBeat[];
  kya: { attestations: DelegationAttestation[]; blocked: string[]; issuers?: KyaIssuer[] };
  clearing: { legs: ExposureLeg[]; windows: SettlementWindow[] };
  killSwitchTested: AgentId[];
  idempotency?: Array<[string, unknown]>;
  /**
   * Hosted operator flag. Optional so 0.89 worlds boot (treated as false).
   * Constructor `hosted` wins when passed.
   */
  hosted?: boolean;
  /** Unique subscriber rows. Optional so 0.89 worlds boot. */
  subscriptions?: HostSubscription[];
  /** Off-band operator invoices. Optional so 0.95 worlds boot. Spend is not gated on these. */
  operatorInvoices?: OperatorInvoice[];
}
