import type { Agent, Command, CommandType, PolicyDecision } from "@aether/types";

export type StoryTone = "neutral" | "allow" | "deny" | "escalate" | "settle";

export interface StoryBeat {
  seq: number;
  at: string;
  headline: string;
  body: string;
  tone: StoryTone;
  commandType?: CommandType;
}

export const SPRINT_TLDR =
  "A human gave an agent a $15,000 shopping list with a $5,000 per-item cap. The agent bought $800 of market data legally, was blocked on a $6,400 compute bill, got a new permission slip plus a treasury sign-off, paid, then swapped the data proceeds into USDC. An auditor confirmed the books and was not allowed to spend.";

function dollars(minor: number): string {
  return `$${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function nameOf(actor: Agent | undefined, fallback = "an agent"): string {
  return actor?.displayName ?? fallback;
}

export function autoBeat(input: {
  seq: number;
  at: string;
  cmd: Command;
  actor: Agent;
  decision: PolicyDecision;
  counterpartName?: string;
  amountMinor?: number;
  sku?: string;
  task?: string;
}): StoryBeat | undefined {
  const { cmd, actor, decision } = input;
  const who = nameOf(actor);
  const amt = input.amountMinor !== undefined ? dollars(input.amountMinor) : undefined;
  const other = input.counterpartName;
  const sku = input.sku;

  if (cmd.type === "identity.register") return undefined;
  if (cmd.type === "mandate.issue_cart" || cmd.type === "mandate.issue_payment") return undefined;
  if (cmd.type === "hire.accept" || cmd.type === "hire.deliver" || cmd.type === "envelope.require") return undefined;
  if (cmd.type === "ledger.balances" || cmd.type === "receipt.get") return undefined;

  if (cmd.type === "mandate.issue_intent") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} wrote a permission slip`,
      body: input.task
        ? `The slip says: ${input.task}`
        : "A signed intent now bounds what an agent may spend, on whom, and how far.",
      tone: "neutral",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "ledger.transfer" && amt) {
    return {
      seq: input.seq,
      at: input.at,
      headline: `Treasury funded the shopping trip with ${amt}`,
      body: "Cash moved from the treasury account to procurement. The agent can now hire vendors without touching the rest of the company.",
      tone: "allow",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "market.rfq") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} asked the market for ${sku ?? "a service"}`,
      body: "This is an RFQ: a request for quotes. No money moved. Vendors are invited to name a price.",
      tone: "neutral",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "market.quote" && amt) {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} quoted ${amt}${sku ? ` for ${sku}` : ""}`,
      body: "A quote is a promise with an expiry, not a charge. Policy still has to bless the hire.",
      tone: "neutral",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "hire.create") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `Stopped. ${who} was not allowed to hire${other ? ` ${other}` : ""} for ${amt ?? "that amount"}`,
        body: `The referee (policy kernel) said no. Rule: ${rule?.ruleId ?? "unknown"}. ${rule?.message ?? ""} Hard constraints cannot be waved through by a manager — someone has to issue a new permission slip.`,
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (decision.verdict === "escalate") {
      return {
        seq: input.seq,
        at: input.at,
        headline: `Paused. ${amt ?? "This hire"} needs a grown-up`,
        body: `${who} is allowed to try, but the amount sits above the auto-approve threshold. Treasury (or a human) must sign the ticket. The books do not change until they do.`,
        tone: "escalate",
        commandType: cmd.type,
      };
    }
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} hired${other ? ` ${other}` : ""}${amt ? ` for ${amt}` : ""}`,
      body: "A hire contract now exists with an empty escrow account. Work must not start until that escrow is funded.",
      tone: "allow",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "approval.resolve") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} approved the exception`,
      body: "The original command is replayed byte-for-byte. Policy runs again. Only the threshold is waived — caps, freezes, and the audit chain still bind.",
      tone: "escalate",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "hire.fund" && amt) {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${amt} moved into escrow`,
      body: "The buyer’s cash is locked. The vendor can now do the work knowing they will be paid if they deliver. If they don’t, the money can be refunded.",
      tone: "settle",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "envelope.submit") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} tried to spend and was refused`,
        body: `Role ${actor.role} is not allowed to move money. Rule: ${rule?.ruleId ?? "actor.role_capability"}. An auditor who can spend is not an auditor.`,
        tone: "deny",
        commandType: cmd.type,
      };
    }
    return {
      seq: input.seq,
      at: input.at,
      headline: `Escrow released${amt ? ` (${amt})` : ""}. A receipt was written.`,
      body: "The vendor is paid. The receipt’s reference is the hash of the payment mandate, so anyone can prove which permission this settlement fulfilled.",
      tone: "settle",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "market.fx_settle" && amt) {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} swapped ${amt} into USDC`,
      body: "The market maker is a dumb window (±2%), not a trading desk. Two balanced journal entries, two currencies, one audit trail.",
      tone: "settle",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "audit.verify") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} read the notary book`,
      body: "Every mutation is a hash-chained line. If anyone alters a past event, verify() fails at that line. The auditor can read this. They cannot spend.",
      tone: "allow",
      commandType: cmd.type,
    };
  }
  return undefined;
}

export function analog(): { title: string; lines: string[] } {
  return {
    title: "The kitchen-table version",
    lines: [
      "A human writes a permission slip (a mandate): what may be bought, from whom, and the max price.",
      "Software agents go shopping with that slip. They ask vendors for prices. They do not get a blank check.",
      "A referee that never gets tired and never guesses (the policy kernel) says yes, no, or ask a grown-up.",
      "If yes, money sits in escrow until the work is done, then a receipt is written that points back at the slip.",
      "A notary (the audit log) writes every decision in ink that smudges if you try to rewrite yesterday.",
      "An auditor may read the notary book. They may freeze people. They may not buy lunch with the company card.",
    ],
  };
}
