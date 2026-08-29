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

export const CLEARING_TLDR =
  "A desk hired a vendor for $800. A second $400 hire was refused — that pair’s open gross would have blown a $1,000 bilateral credit line. Closing a settlement window photographed the $800 and cleared the open book. Money did not move again. After the photo, the $400 hire went through. Credit is a window, not a second payment.";

export const REFUND_TLDR =
  "A desk funded an $800 research hire. Refund returned escrow, restored the mandate budget, and reverse-recorded the pair in the clearing book. The quote stayed spent. An over-cap hire had already blown the daily fuse; refund did not untrip it. After a treasury reset, refund of delivered work was hire.state. Unwind is not a new quote and not a circuit reset.";

export const REPLAY_TLDR =
  "A desk funded an $800 research hire. Retrying the same fund did not move cash again — the allow replayed. Retrying the same hire.create returned the same contract. A new key on that spent quote was hire.quote_unspent. A retry is not a second spend.";

export const NONCE_TLDR =
  "A desk released an $800 hire with an envelope nonce. Reusing that nonce on a second hire was idempotency.nonce — the second escrow did not release. A leftover nonce on a cash transfer was not that deny. A payment nonce is one-shot, and it is not a field on a transfer.";

export const DENY_CACHE_TLDR =
  "A frozen desk tried to hire and was refused. Retrying the same hire.create was a new decision — the deny was not cached. After unfreeze, that same command went through. A deny is not a leftover no.";

export const RECURRENCE_TLDR =
  "A founder wrote a one-slot slip. The desk hired once and released. Completing that funded work was not a second slot. A second hire.create was payment.recurrence. A cadence is not an open checkbook.";

export const CALENDAR_TLDR =
  "A founder wrote a same-day calendar. Hiring before it opened was payment.execution_date. Inside the window the desk funded an $800 hire. After the calendar closed, that funded work still released. A new hire was payment.execution_date. A closed calendar is not a freeze on funded work.";

export const SLOT_TLDR =
  "A founder wrote a one-slot slip. The desk funded an $800 hire, then unwound it. Cash and mandate spend came back. The cadence slot did not. A second hire.create was payment.recurrence. A refund is not a new slot.";

export const DAILY_TLDR =
  "A founder wrote a daily cadence. The desk hired once and released. A same-day second hire.create was payment.recurrence. After 24 hours that command went through. A cadence is a gap, not a burst.";

export const CART_TLDR =
  "A desk accepted an $800 hire. Funding with a loose cartId was hire.bound_cart. Binding a cart occupied the hire; a second cart was hire.unique_cart. A second payment on that cart was mandate.unique_payment. The same fund command then went through — occupancy is a bind, not a field on fund.";

export const VELOCITY_TLDR =
  "A desk funded an $800 hire. The settle hour ran hot. That funded work still released. A new hire.create was velocity.window — paused for a grown-up, not refused. A hot hour is not a freeze on funded work.";

export const DOOR_TLDR =
  "The public kernel refused subscribe as host.not_hosted. A hosted operator refused an unsigned speaker (401) and an unpaid month (402). After an invoice the same command went through. Subscribe recorded a row; spend was not gated on it. PROTOCOL.hosted stays false.";

export const MATCH_TLDR =
  "A desk accepted an $800 hire. A $0.01 cart was hire.cart_matches — a cheaper cart is not a discount. The matching cart occupied the hire. Funding moved $800, not a penny. Match is not occupancy.";

export const ROOM_TLDR =
  "A desk opened a closed RFQ for one vendor. An outsider’s quote was market.invited_seller — no quote was written. The invited vendor quoted and the hire went through. An empty invite list let the outsider quote. A closed room is not a bulletin board.";

export const CONVERSION_TLDR =
  "A desk tried to hire an FX window. That was hire.not_fx — no hire, window unspent. The vendor then settled it. A spent window is hire.quote_unspent. An FX window is not a good.";

export const PAIR_TLDR =
  "A founder shook hands with a desk. A tighter second hop was kya.unique_live — one live handshake per pair. A hop to a different agent went through. Revoke, then attest again. A second live hop is not a tighter grant.";

export const BAND_TLDR =
  "A market maker quoted a conversion at half price. That was mm.spread_bound — no window written. An in-band quote went through and settled. A decoy top-level rate is not the nested band. The 200bps band is not decoration.";

export const NEST_TLDR =
  "A founder nested a scout under a desk hop. The scout hired while the parent lived. After the parent hop died, a new hire was kya.parent_fresh — no hire written. That funded work still released. A nested hop does not outlive its parent.";

export const HEIR_TLDR =
  "A founder handed a tighter child slip to a desk. The desk hired while the parent lived. After the parent slip died, a new hire was mandate.parent_fresh — no hire written. That funded work still released. A dead parent is not a parent.";

export const STOCK_TLDR =
  "A market maker quoted a conversion against a thin USDC book. That was mm.inventory — the window stayed unspent. A smaller window on a different RFQ converted. Empty MM USDC is not a missing maker, not a vendor overdraft, and not the 200bps band.";

export const PURSE_TLDR =
  "A founder wrote a $1,000 envelope with a $5,000 per-item cap. The desk funded an $800 hire. A $400 second hire was payment.budget — the item cap still allowed. That funded work still released. A budget is not an item cap.";

export const SEAT_TLDR =
  "A hosted operator recorded one subscribe row. The desk funded an $800 hire — spend is not gated on the row. A second subscribe was host.unique_subscriber — no second row. A different agent took its own seat. That funded work still released. One subscriber, one row.";

export const COVER_TLDR =
  "A founder wrote a $1,000 parent envelope. The desk funded an $800 hire against the parent. A $400 scout hire on a tighter child was payment.parent_budget — the child's own envelope still allowed. That funded work still released. A parent envelope is not a child's leftover.";

export const MINT_TLDR =
  "Treasury tried to pull from equity. That was ledger.operating_book — not a mint. The desk funded an $800 hire. Pulling that escrow was ledger.operating_book — not an allocation. That funded work still released. A transfer moves operating cash.";

export const PAYEE_TLDR =
  "A founder listed one research vendor. The desk funded an $800 hire to that name. A registered outsider quoted and hire.create was payment.allowed_payees — the room still wrote the quote. That funded work still released. A listed payee is not any registered vendor.";

export const CLIMB_TLDR =
  "A founder shook hands with a desk at a ceiling of L3. The desk funded an $800 hire. After a climb to L4, a new hire was kya.capability_subset — the slip ceiling still allowed. That funded work still released. A climb is not a wider handshake.";

export const BORN_TLDR =
  "A market maker quoted a conversion that had already closed. That was market.fx_fresh — no window written. An open window went through and settled. A later lapse is still market.not_expired. An FX window cannot be born dead.";

export const REACH_TLDR =
  "A founder funded an $800 hire on a live slip. A calendar that only opened after that slip would die was mandate.window_reach — no second slip written. A future window that still opens while the slip lives still minted. That funded work still released. A window that opens after the slip dies is not a window.";

export const YEAR_TLDR =
  "A founder funded an $800 hire under a one-year handshake. A hop that outlived one year was kya.mint_window — no handshake written. A one-year hop still minted. That funded work still released. Year 9999 is not standing identity.";

export const FUSE_TLDR =
  "A founder funded an $800 hire against a $1,000 daily fuse. A $400 second hire was circuit.daily — the envelope and the item cap still allowed. That funded work still released. A daily fuse is not a freeze on funded work.";

export const SKU_TLDR =
  "A founder listed research.brief. The desk funded an $800 hire of that good. A catalog deep-research quote was payment.allowed_skus — the room still wrote the quote. That funded work still released. A listed SKU is not any catalog good.";

export const PRICED_TLDR =
  "A vendor quoted research.brief in USDC. That was market.sku_currency — no quote written. A USD quote went through and the $800 hire released. Convert with market.fx_settle. A listed SKU is only priced in a currency the catalog names.";

export const PARTY_TLDR =
  "A founder funded an $800 hire. A different vendor’s deliver was hire.party — the hire stayed funded. The seller who quoted still delivered and that work still released. The other side of the table is not a party.";

export const CASH_TLDR =
  "A founder funded an $800 hire that emptied the desk. A $400 second fund was ledger.sufficient — same currency, operating cash, legal hire arrow. That funded work still released. Empty cash is not a negative book.";

export const STALE_TLDR =
  "A founder funded an $800 hire on a live quote. After that quote’s hour lapsed, hire.create was market.not_expired — known SKU, known room, unspent promise. A fresh quote on that still-live room still hired. That funded work still released. A stale quote is not a hire.";

export const CHAIN_TLDR =
  "A founder funded an $800 hire on a live cart. After that cart’s day, a second fund was mandate.chain_integrity — occupancy still bound, cash still there, hire still accepted. That funded work still released. A dead cart is not a check.";

export const ARROW_TLDR =
  "A founder funded an $800 hire. Release before deliver was hire.state — the hire stayed funded, escrow did not pay the vendor. After deliver that work still released. Unfinished work is not a payout.";

export const WALLET_TLDR =
  "A founder funded an $800 hire. A compute vendor’s settle was ledger.known_account — USD cash, live window, maker still there. A research vendor with a USDC book still converted. That funded work still released. A vendor’s USD cash is not a USDC wallet.";

export const NAME_TLDR =
  "A founder funded an $800 hire. An L4 scout minting a handshake in the founder’s name was kya.party — not a second hop, not a climb above the grant. The founder still minted that pair. That funded work still released. Someone else’s name is not a handshake.";

export const PANE_TLDR =
  "A founder funded an $800 hire. A market maker quoted an FX SKU with no window. That was market.fx_window — known SKU, known room, pair still allows. A real window still quoted and converted. That funded work still released. An FX SKU is a window, not a good.";

export const SUBJECT_TLDR =
  "A founder issued a slip to desk A. Desk B’s fund was mandate.subject_is_actor — the chain still verified, cash still there, hire still accepted. Desk A still funded. That work still released. This slip is not yours to spend.";

export const PAPER_TLDR =
  "A founder funded an $800 hire. Settling a research quote as FX was market.fx_quote — pair, maker, and dest book still allow. A real window still converted. That funded work still released. A research quote is not a conversion window.";

export const MIX_TLDR =
  "A founder funded an $800 hire. Treasury posting USD into a USDC book was ledger.same_currency — the dest book, operating cash, and source still allow. A real window still converted. That funded work still released. A mixed journal is not a conversion.";

export const RUNG_TLDR =
  "A founder funded an $800 hire. Skipping L2→L4 on a scout was ladder.legal — the scout still exists, the founder may still set rungs. A one-rung climb still went through. That funded work still released. A skipped rung is not a promotion.";

export const GRADE_TLDR =
  "A founder funded an $800 hire. An L3 scout minting a nested slip was ladder.min_level — the parent still exists, the child is still tighter, the handshake ceiling still allows. An L4 desk still minted that child. That funded work still released. A junior desk is not a nested-slip mint.";

export const CRADLE_TLDR =
  "A founder funded an $800 hire. Minting a sentinel at L5 was ladder.birth_rung — the alias is still free, the founder may still register, a skip is not this deny. An L4 register still went through. That funded work still released. L5 is not a birthright.";

export const CEILING_TLDR =
  "A founder funded an $800 hire under an L3 slip. After a climb to L4, a new hire was ladder.max_autonomy_constraint — the handshake ceiling still allows. That funded work still released. A climb is not a wider slip.";

export const LAPSE_TLDR =
  "A founder funded an $800 hire under a noon handshake. After that hop died, a new hire was kya.attestation_fresh — the chain still verifies, a nested parent is not this deny. That funded work still released. An expired hop is not a freeze on funded work.";

export const PAUSE_TLDR =
  "A founder funded an $800 hire under the auto-approve line. A $6,400 hire paused for a grown-up. After that ticket died, a late yes was approval.pending — the ticket still exists, a stale command is not this deny. That funded work still released. A dead pause is not a late yes.";

export const MIRROR_TLDR =
  "A founder funded an $800 hire. Attesting themselves was kya.not_self — not someone else's name, not a second hop, not a corpse mint. The founder still minted a real pair. That funded work still released. A handshake is not a mirror.";

export const WARRANT_TLDR =
  "A founder funded an $800 hire. Subscribe on an agent-issued slip was host.human_authority — not a missing seat, not the public kernel. A human-issued slip still seated. That funded work still released. An agent-issued slip is not host authority.";

export const VACANT_TLDR =
  "A founder funded an $800 hire. Minting a cadence with no slots was mandate.occurrence_fresh — not a spent slot, not a closed calendar, not a nested child. A one-slot slip still minted. That funded work still released. A cadence with no slots is not a cadence.";

export const BADGE_TLDR =
  "A founder funded an $800 hire. An auditor’s hire.create was actor.role_capability — not a freeze, not a missing speaker, not a spent quote. The auditor still verified the notary. That funded work still released. A badge is not a shopping pass.";

export const LID_TLDR =
  "A founder wrote a $1,000 item cap with a $5,000 envelope. The desk funded an $800 hire. A $1,500 second hire was payment.amount_range — the envelope and the fuse still allowed. That funded work still released. An item cap is not an envelope.";

export const BARE_TLDR =
  "A founder funded an $800 hire. Deliver on an accepted hire was hire.escrow_required — the seller is still the party, the hire is still known. That funded work still released. Unfunded work is not a delivery.";

export const SHELF_TLDR =
  "A founder funded an $800 hire of a catalog good. An RFQ for a ghost SKU was market.known_sku — the slip list still allows, a listed SKU is not this deny. That funded work still released. A ghost SKU is not a catalog good.";

export const HALL_TLDR =
  "A founder funded an $800 hire. A quote on a ghost RFQ was market.known_rfq — a missing SKU is not this deny, a closed guest list is not this deny. That funded work still released. A missing room is not a missing SKU.";

export const WRIT_TLDR =
  "A founder funded an $800 hire. A hire against a ghost slip was mandate.known_intent — a missing handshake is not this deny, a dead parent is not this deny. That funded work still released. A missing slip is not a missing handshake.";

export const CRATE_TLDR =
  "A founder funded an $800 hire. A payment on a ghost cart was mandate.known_cart — occupancy is not this deny, a dead cart at fund is not this deny. That funded work still released. A missing cart is not a broken payment chain.";

export const PACT_TLDR =
  "A founder funded an $800 hire. Deliver on a ghost hire was hire.known — a stranger’s deliver is not this deny, unfunded work is not this deny. That funded work still released. A missing contract is not a broken mandate chain.";

export const ROOT_TLDR =
  "A founder funded an $800 hire. A child of a ghost parent was mandate.known_parent — a tighter child is not this deny, a dead parent is not this deny. That funded work still released. A missing parent is not a tighter child.";

export const DOCKET_TLDR =
  "A founder funded an $800 hire. Resolve of a ghost ticket was approval.known — a dead pause is not this deny, a stale command is not this deny. That funded work still released. A missing ticket is not a late yes.";

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

  if (decision.verdict === "deny") {
    const rule = decision.trace.find((t) => t.verdict === "deny");
    if (rule?.ruleId === "actor.system_scope") {
      return {
        seq: input.seq,
        at: input.at,
        headline: "system is not a treasurer",
        body: "System may bootstrap the first human and read the catalog, the host card, the notary, balances, and receipts. Name a registered actor to spend, freeze, or mint further agents.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (rule?.ruleId === "host.not_hosted") {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} cannot subscribe to the public kernel`,
        body: "This instance is the public protocol. Self-host is free. A hosted operator records a unique subscriber against a live human-issued intent. GitHub is not a checkout. Read host.card.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (rule?.ruleId === "host.human_authority") {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} cannot subscribe on an agent-issued slip`,
        body: "Host subscribe binds a live intent issued by a human_operator or treasury. An agent-issued slip is not host authority.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (rule?.ruleId === "host.unique_subscriber") {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} is already subscribed`,
        body: "One subscriber, one row. Spend is not gated on the row.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
  }

  if (cmd.type === "identity.register") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "identity.unique_key") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} could not register that agent`,
          body: "That runtime alias (or its USD/USDC operating book) is already taken. Two agents cannot share one operating book.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "ladder.birth_rung") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot mint L5 at birth`,
          body: "L5 is not a birthright. Register at L0–L4, then climb with ladder.set after a freeze that was actually tested. Listing the gate names is not the test.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
    }
    return undefined;
  }
  if (cmd.type === "mandate.issue_cart") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "hire.cart_matches") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} could not bind a cheaper cart`,
          body: "The cart must equal the hire. Escrow moves the quoted price. A cheaper cart is not a discount.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "hire.unique_cart") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} could not bind a second cart`,
          body: "A hire takes one cart. A second cart is not a pointer swap.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
    }
    return undefined;
  }
  if (cmd.type === "mandate.issue_payment") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "mandate.known_cart") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} named a cart that is not here`,
          body: "A missing cart is not a broken payment chain. Issue the cart first. Completing funded work after that is legal. Occupancy is a different object.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "mandate.unique_payment") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} could not mint a second payment`,
          body: "A cart takes one payment. A second payment is not a second check.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
    }
    return undefined;
  }
  if (cmd.type === "hire.accept" || cmd.type === "hire.deliver" || cmd.type === "envelope.require") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "hire.escrow_required") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot deliver unfunded work`,
          body: "Escrow must be funded before the vendor delivers. Offered or accepted is not funded. Completing funded work after that is legal; unfunded work is not a delivery.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "hire.state") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot move that hire`,
          body: "A hire only walks offered → accepted → funded → delivered → released. Payment-required is only after deliver. An illegal arrow is a refuse, not a 409 after yes.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "hire.known") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} named a hire that is not here`,
          body: "That hire is not in this world. A missing contract is not a broken mandate chain.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "hire.party") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} is not the seller on that hire`,
          body: "Accept, deliver, and payment-required belong to the vendor who quoted. Completing funded work after that is legal; a stranger’s deliver is not.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} is not the seller on that hire`,
        body: "Accept, deliver, and payment-required belong to the vendor who quoted. A missing hire is hire.known.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    return undefined;
  }
  if (cmd.type === "ledger.balances" || cmd.type === "receipt.get" || cmd.type === "host.card") return undefined;

  if (cmd.type === "host.subscribe") {
    if (decision.verdict === "allow") {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} subscribed to this host`,
        body: "This hosted operator recorded the agent against a live human-issued intent. One subscriber, one row. Spend is not gated on this row.",
        tone: "allow",
        commandType: cmd.type,
      };
    }
    return undefined;
  }

  if (cmd.type === "mandate.issue_intent") {
    const parented = typeof (cmd.body as { parentId?: string }).parentId === "string";
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "mandate.known_parent") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} tried to hand down a slip with no parent`,
          body: "A missing parent is not a tighter child. Issue the parent permission slip first.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "identity.known") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} wrote a permission slip for nobody`,
          body: "That subject is not in this world. A missing agent is not a permission slip.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "mandate.window_fresh") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot mint a closed calendar`,
          body: "A permission slip cannot be born with a window that has already closed. Name a not_after after now, or omit the window. Hire still checks the calendar when money would move.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "mandate.window_reach") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot mint a calendar that opens after the slip dies`,
          body: "A permission slip lives seven days. A window that opens after that is not a window. Name a not_before inside the slip, or omit it.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "mandate.occurrence_fresh") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot mint a cadence with no slots`,
          body: "A permission slip cannot be born with max_occurrences already exhausted. Name at least one slot, or omit the cap. Hire still checks cadence when money would move.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "ladder.min_level") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot mint a nested slip below L4`,
          body: "Issuing a sub-intent is L4. A junior desk cannot hand down a child mandate. A grown-up ticket does not waive that verb. Climb, then issue. Completing funded work is still legal.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "mandate.parent_fresh") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot hand down a slip whose parent is dead`,
          body: "A dead parent is not a parent. Issue a new parent permission slip, then a tighter child. Completing a funded hire after the parent dies is still legal.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "kya.parent_fresh") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot hand down a slip whose handshake parent is dead`,
          body: "A dead parent hop is not a parent. Attest a live parent, then nest. Completing a funded hire after that is still legal.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
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
  if (cmd.type === "ledger.transfer") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "ledger.same_currency") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} tried to mix currencies in one journal`,
          body: "One journal is one currency. Convert with an FX quote and settle. A transfer is not a swap.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "ledger.sufficient") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} tried to overdraw a book`,
          body: "The source book does not have that many cents. A transfer is not an overdraft.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "ledger.safe_balance") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} tried to write cents this book cannot hold`,
          body: "A book must stay a safe integer. IEEE rounding is not a mint. Split the journal or drain the dest first.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "ledger.operating_book") {
        const from = String((cmd.body as { fromAccount?: unknown }).fromAccount ?? "");
        const escrow = from.startsWith("escrow:");
        return {
          seq: input.seq,
          at: input.at,
          headline: escrow ? "escrow is not an allocation" : "a transfer is not a mint",
          body: escrow
            ? "Escrow moves through hire.fund, refund, or release. A transfer cannot pick the lock."
            : "Opening cash is seedOpening. A transfer moves operating cash. Equity is not a source.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} tried to move money through a missing book`,
        body: "That account name is not in this world. A missing book is not an allocation.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (amt) {
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} moved ${amt} into an operating account`,
        body: "Cash left treasury. The working agent can hire vendors without touching the rest of the company.",
        tone: "allow",
        commandType: cmd.type,
      };
    }
  }
  if (cmd.type === "market.rfq") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "market.known_sku") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} asked the market for a SKU that is not in the catalog`,
          body: "This is not a storefront. Only catalog SKUs can be hired. A listed SKU not on the slip is a different object. Completing funded work after that is legal.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "identity.known") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} invited a seller who is not in this world`,
          body: "A closed RFQ is a guest list of live agents. A missing id is not a closed room. Register them first.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} asked the market for a job the referee refused`,
        body: rule?.message ?? "The RFQ did not pass policy.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} asked the market for ${sku ?? "a service"}`,
      body: "This is an RFQ: a request for quotes. No money moved. An empty invite list is open; a named list is a closed room of live agents.",
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
          body: "A missing RFQ is not a missing SKU. Issue the request first, then quote it. Completing funded work after that is legal. A closed guest list is a different object.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "market.fx_fresh") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} quoted a conversion window that was already closed`,
          body: "An FX window cannot be born dead. Name a validUntil after now. Settle of a window that later lapses is still market.not_expired.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "market.fx_window") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} quoted an FX SKU without a window`,
          body: "An FX SKU is a conversion window, not a hireable good. Attach fx.from/to/rateE6/validUntil. Settle with market.fx_settle. A missing window is not a quote.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "mm.spread_bound") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} quoted outside the 200bps band`,
          body: "The nested rate is what is stored and what settle uses. A top-level rateE6 is not the band. Re-quote inside 980000–1020000.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "market.sku_currency") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} quoted a listed SKU in a currency the catalog does not name`,
          body: "Research is USD_SIM. Convert with market.fx_settle. A deny does not write a quote. Ghost SKU stays market.known_sku.",
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
        body = "This permission slip’s per-item cap is the lid. The envelope is a different object. Completing funded work after that is legal; a new hire is not.";
      } else if (ruleId === "payment.budget") {
        body = "This permission slip’s envelope is spent. The per-item cap is a different object. Completing funded work after that is legal; a new hire is not.";
      } else if (ruleId === "payment.parent_budget") {
        body = "The parent permission slip’s envelope is spent. The child’s own leftover is not a new parent envelope. Completing funded work after that is legal; a new hire is not.";
      } else if (ruleId === "payment.allowed_payees") {
        body = "That seller is not on this permission slip’s payee list. A registered vendor is not a listed payee. A closed room is a guest list on the RFQ; this is the slip. Completing funded work after that is legal; a new hire is not.";
      } else if (ruleId === "payment.allowed_skus") {
        body = "That good is not on this permission slip’s SKU list. A catalog SKU is not a listed SKU. Completing funded work after that is legal; a new hire is not.";
      } else if (ruleId === "circuit.daily") {
        body = "The daily fuse blew. Standing permission does not mean unlimited. Completing funded work after that is legal; a new hire is not. Until a human resets the circuit, even a tiny hire is refused.";
      } else if (ruleId === "kya.principal_not_frozen") {
        body = "The person this agent spends for is frozen. The handshake is still on file, but the referee will not let money move.";
      } else if (ruleId === "kya.chain_intact") {
        body = "No live handshake from the money’s owner. Registration-time supervision is not enough once a revoke tombstone exists.";
      } else if (ruleId === "actor.role_capability") {
        body = "This role cannot hire. An auditor who can spend is not an auditor. Completing funded work after that is legal; a new hire by this speaker is not.";
      } else if (ruleId === "actor.not_frozen") {
        body = "This agent is frozen. Freeze is a kill switch: autonomy drops to L0 and spend is denied.";
      } else if (ruleId === "market.invited_seller") {
        body = "That seller was not on the RFQ. A named invite list is a closed room.";
      } else if (ruleId === "market.known_rfq") {
        body = "That quote or RFQ is not in this world. A missing room is not a missing SKU.";
      } else if (ruleId === "market.not_expired") {
        body = "That quote or RFQ has expired. A price promise is one hour; a room is one day. Completing funded work after that is legal; a new hire on a dead price is not. A corpse FX window at mint stays market.fx_fresh.";
      } else if (ruleId === "hire.quote_unspent") {
        body = "That quote already produced a hire, an FX settle, or is held by an open approval. A price promise is used once. A deny does not consume it; a void does not restore it.";
      } else if (ruleId === "mandate.known_intent") {
        body = "That permission slip is not in this world. A missing slip is not a missing handshake.";
      } else if (ruleId === "payment.recurrence") {
        body = "This permission slip’s cadence is spent. Wait out the gap, or write a new slip if the occurrence cap is exhausted. A refund does not restore a slot.";
      } else if (ruleId === "payment.execution_date") {
        body = "This permission slip’s calendar is closed. Completing funded work after that is legal; a new hire is not.";
      } else if (ruleId === "mandate.parent_fresh") {
        body = "The parent permission slip has expired. A dead parent is not a parent. Completing a funded hire after that is legal; a new hire is not.";
      } else if (ruleId === "kya.parent_fresh") {
        body = "The parent handshake has expired. A nested hop does not outlive its parent. Completing a funded hire after that is legal; a new hire is not.";
      } else if (ruleId === "kya.attestation_fresh") {
        body = "The handshake expired. Revoke it, then attest again. A dead hop still occupies the pair. Completing a funded hire after that is legal; a new hire is not.";
      } else if (ruleId === "kya.capability_subset") {
        body = "This agent sits above the handshake ceiling. Completing a funded hire after a climb is legal; a new hire is not.";
      } else if (ruleId === "ladder.max_autonomy_constraint") {
        body = "This permission slip’s max autonomy is below the actor’s rung. Completing a funded hire after a climb is legal; a new hire is not.";
      } else if (ruleId === "hire.not_fx") {
        body = "An FX window is a conversion, not a good. Settle it. A deny does not consume or reserve the window.";
      } else if (ruleId === "clearing.bilateral_limit") {
        body = "This pair’s open gross would exceed the bilateral credit limit. Close a settlement window (the photo, not a second payment) or hire a smaller amount. Money already moved at escrow stays moved.";
      }
      return {
        seq: input.seq,
        at: input.at,
        headline:
          ruleId === "mandate.known_intent"
            ? `${who} hired against a slip that does not exist`
            : `Stopped. ${who} was not allowed to hire${other ? ` ${other}` : ""} for ${amt ?? "that amount"}`,
        body,
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (decision.verdict === "escalate") {
      const rule = decision.trace.find((t) => t.verdict === "escalate");
      return {
        seq: input.seq,
        at: input.at,
        headline: `Paused. ${amt ?? "This hire"} needs a grown-up`,
        body:
          rule?.ruleId === "velocity.window"
            ? `${who} is allowed to try, but this hour already has too many settles. Completing a funded hire after that is legal; a new hire is not. Treasury (or a human) must sign the ticket. The books do not change until they do.`
            : `${who} is allowed to try, but the amount sits above the auto-approve threshold. Treasury (or a human) must sign the ticket. The books do not change until they do.`,
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
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not resolve that ticket`,
        body:
          rule?.ruleId === "approval.known"
            ? "That approval is not in this world. A missing ticket is not a late yes."
            : rule?.ruleId === "approval.pending"
              ? "That ticket is expired or already resolved. Resolving it is a refuse, not a late yes."
              : (rule?.message ?? "The referee refused this ticket."),
        tone: "deny",
        commandType: cmd.type,
      };
    }
    return {
      seq: input.seq,
      at: input.at,
      headline: `${who} approved the exception`,
      body: "The original command is replayed byte-for-byte. Policy runs again. The threshold and the hire/settle rung are waived — caps, freezes, KYA, and the audit chain still bind.",
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
            : rule?.ruleId === "hire.known"
              ? "That hire is not in this world. A missing contract is not a broken mandate chain."
              : rule?.ruleId === "hire.state"
                ? "A hire must be accepted before escrow can lock. Offered is not funded. An illegal arrow is a refuse, not a 409 after yes."
                : rule?.ruleId === "ledger.sufficient"
                  ? "The buyer’s cash does not cover this hire. Escrow cannot lock on an overdraft. Allocate first."
                  : rule?.ruleId === "hire.bound_cart"
                    ? "That hire has not bound a cart. Issue the cart with hireId, then the payment. Passing cartId on fund is not a pointer."
                  : rule?.ruleId === "mandate.chain_integrity"
                    ? "The cart or payment window has closed. Completing funded work after that is legal; a new fund is not. Occupancy is a bind, not this refuse."
                  : rule?.ruleId === "mandate.subject_is_actor"
                    ? "This permission slip names a different subject. The speaker is not that agent. A live chain is not a shared checkbook. Completing funded work by the named subject is legal; a stranger’s fund is not."
                  : rule?.ruleId === "ledger.safe_balance"
                    ? "The escrow (or the buyer’s remaining cash) cannot hold this many cents. IEEE rounding is not a mint."
                  : rule?.ruleId === "kya.parent_fresh"
                    ? "The parent handshake has expired. A nested hop does not outlive its parent. Completing a funded hire after that is legal; a new fund is not."
                  : rule?.ruleId === "kya.attestation_fresh"
                    ? "The handshake expired. Revoke it, then attest again. A dead hop still occupies the pair. Completing a funded hire after that is legal; a new fund is not."
                  : rule?.ruleId === "kya.capability_subset"
                    ? "This agent sits above the handshake ceiling. Completing a funded hire after a climb is legal; a new fund is not."
                  : rule?.ruleId === "ladder.max_autonomy_constraint"
                    ? "This permission slip’s max autonomy is below the actor’s rung. Completing a funded hire after a climb is legal; a new fund is not."
                : (rule?.message ?? "The referee refused to fund this hire."),
        tone: "deny",
        commandType: cmd.type,
      };
    }
    if (decision.verdict === "escalate") {
      const rule = decision.trace.find((t) => t.verdict === "escalate");
      return {
        seq: input.seq,
        at: input.at,
        headline: `Paused. ${amt ?? "This fund"} needs a grown-up`,
        body:
          rule?.ruleId === "velocity.window"
            ? `${who} is allowed to try, but this hour already has too many settles. Completing a funded hire after that is legal; a new fund is not. Treasury (or a human) must sign the ticket. The books do not change until they do.`
            : `${who} is allowed to try, but the amount sits above the auto-approve threshold. Treasury (or a human) must sign the ticket. The books do not change until they do.`,
        tone: "escalate",
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
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not unwind escrow${amt ? ` (${amt})` : ""}`,
        body:
          rule?.ruleId === "hire.state"
            ? "Refund is only from funded. After deliver, escrow can only be released to the vendor. Delivered work cannot be unwound."
            : rule?.ruleId === "ledger.safe_balance"
              ? "The buyer’s book cannot hold the returned cents. IEEE rounding is not a mint."
            : "Refund is the buyer or treasury, and only while the hire is funded. The other side of the table does not unwind escrow.",
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
  if (cmd.type === "hire.release") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not release escrow${amt ? ` (${amt})` : ""}`,
        body:
          rule?.ruleId === "hire.state"
            ? "Escrow releases only after the vendor has delivered. Funded is not released. An illegal arrow is a refuse, not a 409 after yes."
            : rule?.ruleId === "hire.party"
              ? "Release belongs to the buyer or treasury. Completing funded work after that is legal; a stranger’s payout is not."
              : rule?.ruleId === "hire.known"
                ? "That hire is not in this world. A missing contract is not a broken mandate chain."
                : "Release is the buyer or treasury, and only after deliver. Unfinished work is not a payout.",
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
  if (cmd.type === "envelope.submit") {
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} tried to spend and was refused`,
        body:
          rule?.ruleId === "hire.state"
            ? "Escrow releases only after the vendor has delivered. Funded is not released. An illegal arrow is a refuse, not a 409 after yes."
            : rule?.ruleId === "hire.bound_cart"
              ? "That hire has not bound a cart. Issue the cart with hireId. A loose cart on the command is not this hire’s check."
            : rule?.ruleId === "ledger.safe_balance"
              ? "The vendor’s book cannot hold these cents. IEEE rounding is not a mint."
            : `Role ${actor.role} is not allowed to move money. Rule: ${rule?.ruleId ?? "actor.role_capability"}. An auditor who can spend is not an auditor.`,
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
            : rule?.ruleId === "ledger.known_account"
              ? "The vendor has no USDC book. An FX settle is not a journal throw. A compute vendor’s USD cash is not a USDC wallet."
            : rule?.ruleId === "ledger.sufficient"
              ? "The vendor’s USD book does not cover this window. An FX settle is not an overdraft. The market maker’s USDC inventory is a different rule."
              : rule?.ruleId === "mm.known"
                ? "There is no market maker in this world. Register one before settling FX. A window is not a journal against missing books."
                : rule?.ruleId === "mm.inventory"
                  ? "The market maker’s USDC book does not cover this payout. Empty inventory is not a missing maker, not a vendor overdraft, and not the 200bps band. A smaller window still converts."
                : rule?.ruleId === "ledger.safe_balance"
                  ? "A book on this window cannot hold the resulting cents. IEEE rounding is not a mint. The market maker’s USDC inventory is a different rule."
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
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "identity.known") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} could not freeze anyone`,
          body: "That agent is not in this world. A missing agent is not a kill switch.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "identity.freeze_state") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} could not freeze that agent again`,
          body: "That agent is already frozen. A second pull is not a notary line after yes.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
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
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "identity.freeze_state") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} could not lift a freeze`,
          body: "That agent is not frozen. Lifting a freeze that was never pulled is not a kill-switch test.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not lift a freeze`,
        body: "That agent is not in this world. A missing agent is not a thawed kill switch.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
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
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "kya.not_self") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot shake hands with themselves`,
          body: "A handshake is with another agent. Know Your Agent is a grant, not a mirror.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "kya.known_parent") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} tried to nest a handshake under nobody`,
          body: "A missing parent hop is not a live nested handshake. Attest the parent first.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "kya.parent_fresh") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot nest a handshake under a dead parent`,
          body: "A dead parent hop is not a parent. Attest a live parent, then nest. An expired hop still occupies its pair until you revoke.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "kya.party") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot shake hands in someone else’s name`,
          body: "You can only mint a handshake for which you are the principal. A human or treasury may attest any pair. An L4 scout cannot write a founder’s handshake by filling in the ids. Someone else’s name is not a handshake.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "kya.unique_live") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} already shook hands with that agent`,
          body: "One live handshake per pair. Revoke it, then attest again. A second live hop is not a tighter grant.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "kya.capability_subset") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot grant a ceiling they do not hold`,
          body: "Omitted maxAutonomy is L5. An agent may not grant standing-mandate ceiling above its own rung. Name a ceiling you hold. A human or treasury may grant L5.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "kya.mint_fresh") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot mint a dead handshake`,
          body: "A handshake cannot be born expired. Name an expiresAt after now, or omit it for one year. An expired hop still occupies the pair until you revoke.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      if (rule?.ruleId === "kya.mint_window") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot mint a handshake that outlives one year`,
          body: "Omit expiresAt for one year, or name a sooner Instant. Year 9999 is not standing identity.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not shake hands`,
        body: "That agent is not in this world. A missing agent is not a handshake.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
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
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not revoke that handshake`,
        body:
          rule?.ruleId === "kya.known_attestation"
            ? "That handshake is not in this world for this principal. A missing attestation is not a tombstone. You cannot tombstone someone else’s handshake by guessing its id."
            : rule?.ruleId === "kya.party"
              ? "You can only tombstone a handshake for which you are the principal. A human or treasury may revoke any pair. An L4 desk cannot revoke a founder’s handshake by filling in the ids."
              : "That agent is not in this world. A missing agent is not a tombstone.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
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
    if (decision.verdict === "deny") {
      const rule = decision.trace.find((t) => t.verdict === "deny");
      if (rule?.ruleId === "ladder.legal") {
        return {
          seq: input.seq,
          at: input.at,
          headline: `${who} cannot skip a rung`,
          body: "Rungs cannot be skipped. L5 also requires a working circuit breaker and a freeze that was actually tested. Listing the gate names is not the test.",
          tone: "deny",
          commandType: cmd.type,
        };
      }
      return {
        seq: input.seq,
        at: input.at,
        headline: `${who} could not move that agent`,
        body: "That agent is not in this world. A missing agent is not a ladder rung.",
        tone: "deny",
        commandType: cmd.type,
      };
    }
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
      "Other agents find this referee by pinning the host card. Self-host is free. A hosted operator records a unique subscriber against a live human-issued intent. This public kernel is not that operator. GitHub is not a checkout.",
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
