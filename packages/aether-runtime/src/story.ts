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

export interface Analog {
  title: string;
  lines: string[];
}

export const IDLE_TLDR =
  "Aether is a rulebook for software that spends money. Run a demo to see a human write a permission slip, an agent try to spend, and a referee that never guesses say yes, no, or ask a grown-up.";

export const SPRINT_TLDR =
  "A human gave an agent a $15,000 shopping list with a $5,000 per-item cap. The agent bought $800 of market data legally, was blocked on a $6,400 compute bill, got a new permission slip plus a treasury sign-off, paid, then swapped the data proceeds into USDC. An auditor confirmed the books and was not allowed to spend.";

export const NIGHT_WATCH_TLDR =
  "A founder shook hands with a night-watch agent (Know Your Agent) and gave it standing permission to buy research while everyone slept. The agent bought a cheap brief, then a $6,000 one without waking treasury — L5 skips the grown-up, not the rulebook. A $9,000 overpay was refused and blew the daily fuse, which stuck. Freezing the founder froze the agent’s spending. Revoking the handshake left the agent alive but broke. L5 is not god mode.";

export const SUBHIRE_TLDR =
  "A desk agent at L4 handed a smaller permission slip to a scout. The scout hired a vendor for $800. A $2,500 hire was refused because the child slip was tighter than the parent. Revoking the desk→scout handshake stopped the scout without deleting it. Agents hiring agents is the economy; nested slips are how authority stays bounded.";

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
    const parented = typeof (cmd.body as { parentId?: string }).parentId === "string";
    if (decision.verdict === "deny") {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} tried to hand down a wider slip and was refused`,
        body: "A sub-intent must be tighter than its parent: smaller caps, smaller budget, fewer SKUs. Delegation is not a laundering step.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    return {
      seq: input.seq,
      at: input.at,
      headline: parented ? `${who} handed a smaller permission slip to another agent` : `${who} wrote a permission slip`,
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
      headline: `${who} moved ${amt} into an operating account`,
      body: "Cash left treasury. The working agent can hire vendors without touching the rest of the company.",
      tone: "allow",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "market.rfq") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} asked the market for ${sku ?? "a service"}`,
      body: "This is an RFQ: a request for quotes. No money moved. An empty invite list is open; a named list is a closed room.",
      tone: "neutral",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "market.quote") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "market.invited_seller") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} quoted a job they were not invited to`,
          body: "An RFQ with invited sellers is not a bulletin board. Empty invite list is open; a non-empty list is the guest list.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "market.known_rfq") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} quoted a room that does not exist`,
          body: "A missing RFQ is not a missing SKU. Issue the request first, then quote it.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} submitted a quote the referee refused`,
        body: rule?.message ?? "The quote did not pass policy.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (amt) {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} quoted ${amt}${sku ? ` for ${sku}` : ""}`,
        body: "A quote is a promise with an expiry, not a charge. Policy still has to bless the hire.",
        tone: "neutral",
        commandType: cmd.type,
      };
    }
  }
  if (cmd.type === "hire.create") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      const ruleId = rule?.ruleId ?? "unknown";
      let body = `The referee (policy kernel) said no. Rule: ${ruleId}. ${rule?.message ?? ""}`;
      if (ruleId === "payment.amount_range") {
        body += " Hard constraints cannot be waved through by a manager — someone has to issue a new permission slip.";
      } else if (ruleId === "circuit.daily") {
        body = "The daily fuse blew. Standing permission does not mean unlimited. Until a human resets the circuit, even a tiny hire is refused.";
      } else if (ruleId === "kya.principal_not_frozen") {
        body = "The person this agent spends for is frozen. The handshake is still on file, but the referee will not let money move.";
      } else if (ruleId === "kya.chain_intact") {
        body = "No live handshake from the money’s owner. Registration-time supervision is not enough once a revoke tombstone exists.";
      } else if (ruleId === "actor.not_frozen") {
        body = "This agent is frozen. Freeze is a kill switch: autonomy drops to L0 and spend is denied.";
      } else if (ruleId === "market.invited_seller") {
        body = "That seller was not on the RFQ. A named invite list is a closed room.";
      } else if (ruleId === "market.known_rfq") {
        body = "That quote or RFQ is not in this world. A missing room is not a missing SKU.";
      } else if (ruleId === "hire.quote_unspent") {
        body = "That quote already produced a hire or an FX settle. A price promise is used once. A deny does not consume it; a void does not restore it.";
      } else if (ruleId === "payment.recurrence") {
        body = "This permission slip’s cadence is spent. Wait out the gap, or write a new slip if the occurrence cap is exhausted. A refund does not restore a slot.";
      }
      return {
        seq: input.seq,
        at: input.at,
        headline: `Stopped. ${who} was not allowed to hire${other ? ` ${other}` : ""} for ${amt ?? "that amount"}`,
        body,
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
  if (cmd.type === "hire.fund") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not lock escrow${amt ? ` (${amt})` : ""}`,
        body:
          rule?.ruleId === "hire.cart_matches"
            ? "The cart must equal the hire. Escrow moves the quoted price. A cheaper cart is not a discount."
            : (rule?.message ?? "The referee refused to fund this hire."),
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (amt) {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${amt} moved into escrow`,
        body: "The buyer’s cash is locked. The vendor can now do the work knowing they will be paid if they deliver. If they don’t, the money can be refunded.",
        tone: "settle",
        commandType: cmd.type,
      };
    }
  }
  if (cmd.type === "hire.refund") {
    if (decision.verdict === "deny") {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not unwind escrow${amt ? ` (${amt})` : ""}`,
        body: "Refund is only legal while the hire is funded and work has not been delivered. The referee still checks who may pull the money back.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    return {
      seq: input.seq,
      at: input.at,
      headline: `Escrow returned${amt ? ` (${amt})` : ""} to the buyer`,
      body: "The hire was unwound before delivery. Mandate spend goes back. The daily fuse stays sticky if it already blew — refund is not a circuit reset.",
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
  if (cmd.type === "market.fx_settle") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not swap${amt ? ` ${amt}` : ""} into USDC`,
        body:
          rule?.ruleId === "market.fx_quote"
            ? "An FX quote is a one-shot window. A missing quote, a research quote, or a spent quote is not a second settle."
            : (rule?.message ?? "The referee refused the FX settle."),
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (amt) {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} swapped ${amt} into USDC`,
        body: "The market maker is a dumb window (±2%), not a trading desk. Two balanced journal entries, two currencies, one audit trail.",
        tone: "settle",
        commandType: cmd.type,
      };
    }
  }
  if (cmd.type === "identity.freeze") {
    if (decision.verdict === "deny") {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not freeze anyone`,
        body: "Freeze is a kill switch. The referee still checks who is allowed to pull it.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} pulled the freeze`,
      body: "The target drops to L0 and cannot spend. Anyone they had shaken hands with also cannot spend in their name.",
      tone: "deny",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "identity.unfreeze") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} lifted the freeze`,
      body: "The agent returns to the rung it held before the freeze. This is also how we prove the kill switch works before standing permission (L5).",
      tone: "allow",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "kya.attest") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} shook hands with an agent`,
      body: "Know Your Agent: a signed handshake that says this software may spend in a human’s name, up to a listed autonomy, until revoked. TAP, Skyfire, and ERC-8004 can hang off this object later. The kernel already consults it.",
      tone: "allow",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "kya.revoke") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} revoked the handshake`,
      body: "The agent still exists. Its keys still work. It still cannot spend — implicit supervisor grants die with the tombstone. Revoke cascades to anyone it had hired underneath.",
      tone: "deny",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "ladder.set") {
    const to = (cmd.body as { to?: number }).to;
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} moved an agent to L${to ?? "?"}`,
      body: "Rungs cannot be skipped. L5 also requires a working circuit breaker and a tested freeze. The human is stepping back, not disappearing.",
      tone: "allow",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "circuit.reset") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} reset the daily fuse`,
      body: "The circuit breaker is sticky: once it blows, even a tiny spend is refused until a human or treasury resets it. Mandate budgets are unchanged.",
      tone: "allow",
      commandType: cmd.type,
    };
  }
  if (cmd.type === "clearing.settle_window") {
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} closed a settlement window`,
      body: "Gross exposure is photographed and archived. Money already moved at escrow — this is the clearing photo, not a second payment. Live net-settle of open credit comes later as an adapter.",
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

export function analog(): Analog {
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

export function nightWatchAnalog(): Analog {
  return {
    title: "Standing permission, in English",
    lines: [
      "A handshake (Know Your Agent) is not a password. It is a revocable permission to spend in a human’s name.",
      "Standing permission (L5) means nobody clicks yes on each purchase. The slip, the daily fuse, and the freeze still bind.",
      "If the founder’s account is frozen, agents holding their handshake cannot spend either. Authority is a graph, not a token sitting in a bot.",
      "Revoke the handshake and the agent is still there — it just cannot move money. That is how you fire software without deleting it.",
      "A tested freeze is required before L5. We do not give standing permission to something we have never paused.",
    ],
  };
}
