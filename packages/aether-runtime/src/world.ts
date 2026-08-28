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
  settleEvents: Array<{ at: string; volume: number }>;
  decisions: Array<{ at: string; type: CommandType; decision: PolicyDecision }>;
  story: StoryBeat[];
  kya: { attestations: DelegationAttestation[]; blocked: string[] };
  clearing: { legs: ExposureLeg[]; windows: SettlementWindow[] };
  killSwitchTested: AgentId[];
  idempotency?: Array<[string, unknown]>;
}
