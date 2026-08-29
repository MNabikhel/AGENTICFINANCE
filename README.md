# Aether — a rulebook for software that spends money

**If you are an agent:** read [`AGENTS.md`](AGENTS.md). Speak MCP (`pnpm mcp`) or HTTP (`POST /v1/*`). Every mutating verb is a `Command`. Policy runs first. Deny never mutates. There is no website you need.

**If you are a human:** [`docs/FOR-HUMANS.md`](docs/FOR-HUMANS.md) is the kitchen-table version. A short summary is enough. This repo is a foundation other agents run, not a product you click through.

Aether is a machine-first economic operating system for software agents. A human writes a permission slip. Agents hire and pay each other. A referee that never guesses says yes, no, or ask a grown-up. A notary writes it down. An auditor may read the book and may not spend.

It runs **today** on simulated dollars (`sim:aether-1`). No bank, card, or chain credentials. The objects are shaped so that AP2 (authorization), x402/MPP (settlement), and TAP/KYA (identity) can plug in later as adapters — not as the brain.

It is not a trading bot, not a checkout clone, and not a wallet.

## Quick start

```bash
pnpm install
pnpm test
pnpm demo                 # shopping trip (human in the loop)
pnpm demo night-watch     # standing permission, handshake, fuse, freeze
pnpm demo sub-hire        # L4 nested slips: one agent hands a smaller budget to another
pnpm demo clearing        # pair credit line, settlement photo, not a second payment
pnpm demo refund          # unwind funded escrow; quote stays spent; circuit stays sticky
pnpm demo replay          # a retry of an allow is not a second spend
pnpm demo nonce           # envelope nonce is one-shot; leftover nonce on a transfer is not
pnpm demo deny            # a deny is never a cached success
pnpm demo recurrence      # a one-slot cadence is not an open checkbook
pnpm demo calendar        # a closed calendar is not a freeze on funded work
pnpm demo slot            # a refund does not restore a cadence slot
pnpm demo daily           # a cadence is a gap, not a burst
pnpm demo cart            # occupancy is a bind, not a field on fund
pnpm demo velocity        # a hot hour is not a freeze on funded work
pnpm demo door            # the public kernel is not a hosted checkout
pnpm demo match           # a cheaper cart is not a discount
pnpm demo room            # a closed room is not a bulletin board
pnpm demo conversion      # an FX window is not a hire
pnpm demo pair            # a second live hop is not a tighter grant
pnpm demo band            # a 200bps band is not decoration
pnpm demo nest            # a nested hop does not outlive its parent
pnpm demo heir            # a dead parent is not a parent
pnpm demo stock           # empty MM USDC is not a missing maker
pnpm demo purse           # a budget is not an item cap
pnpm demo seat            # one subscriber is one row
pnpm demo cover           # a parent envelope is not a child's leftover
pnpm demo mint            # a transfer is not a mint
pnpm demo payee           # a listed payee is not any registered vendor
pnpm demo climb           # a climb is not a wider handshake
pnpm demo born            # an FX window cannot be born dead
pnpm demo reach           # a window that opens after the slip dies is not a window
pnpm demo year            # a handshake cannot outlive one year
pnpm demo fuse            # a daily fuse is not a freeze on funded work
pnpm demo sku             # a listed SKU is not any catalog good
pnpm demo priced          # a listed SKU is only priced in a catalog currency
pnpm demo party           # the other side of the table is not a party
pnpm demo cash            # empty cash is not a negative book
pnpm demo stale           # a stale quote is not a hire
pnpm demo chain           # a dead cart is not a check
pnpm demo arrow           # unfinished work is not a payout
pnpm demo wallet          # a vendor's USD cash is not a USDC wallet
pnpm demo name            # someone else's name is not a handshake
pnpm mcp                  # stdio MCP — this is the agent face
AETHER_DATA_DIR=./data pnpm mcp   # same, but the economy survives restart
```

**Sprint Procurement:** seven agents, a $5,000 per-item cap, an $800 data buy that is allowed, a $6,400 compute buy that is refused, a new slip plus treasury sign-off, receipts bound to payment hashes, a 0.2% FX window, and an auditor who cannot spend.

**Night Watch:** a founder shakes hands with an overnight agent (Know Your Agent), climbs it to L5 after testing the freeze, lets it buy $200 and $6,000 without waking treasury, stops a $9,000 overpay, blows a sticky daily fuse, freezes the founder (the agent still cannot spend), then revokes the handshake. L5 is not god mode.

**Sub-hire:** a desk at L4 issues a tighter child slip to a scout. The scout hires a vendor for $800. A $2,500 hire is refused by the child cap. Spend counts against the parent budget. Revoking the desk→scout handshake stops the scout without deleting it.

**Clearing window:** a desk hires a vendor for $800. A second $400 hire is refused — that pair’s open gross would blow a $1,000 credit line. Closing a settlement window photographs the $800 and does not move cash. After the photo the $400 hire goes through. Credit is a window, not a second payment.

**Refund:** a desk funds an $800 hire, then unwinds it. Cash comes back. Mandate spend comes back. Clearing reverse-records the pair. The quote stays spent. The daily fuse stays sticky. Refund of delivered work is refused. Unwind is not a new quote and not a circuit reset.

**Replay:** a desk funds an $800 hire. Retrying the same fund does not move cash again. Retrying the same hire.create returns the same contract. A new key on that spent quote is refused. A retry is not a second spend.

**Envelope nonce:** a desk releases an $800 hire. Reusing that payment nonce on a second hire is refused. A leftover nonce on a cash transfer is not that refuse. A payment nonce is one-shot.

**Deny cache:** a frozen desk cannot hire. Retrying that refuse is a new decision, not a leftover no. After unfreeze the same hire.create goes through.

**Recurrence:** a founder writes a one-slot slip. The desk hires once. Completing that funded work is not a second slot. A second hire is refused. A cadence is not an open checkbook.

**Calendar:** a founder writes a same-day window. Hiring before it opens is refused. Inside the window the desk funds. After it closes, that funded work still releases. A new hire is refused. A closed calendar is not a freeze on funded work.

**Slot:** a founder writes a one-slot slip. The desk funds, then unwinds. Cash and spend come back. The cadence slot does not. A second hire is refused. A refund is not a new slot.

**Daily:** a founder writes a daily cadence. The desk hires once. A same-day second hire is refused. After 24 hours that hire goes through. A cadence is a gap, not a burst.

**Cart occupancy:** a desk accepts an $800 hire. Funding with a loose cartId is refused. Binding a cart occupies the hire; a second cart is refused. A second payment on that cart is refused. The same fund command then goes through. Occupancy is a bind, not a field on fund.

**Velocity:** a desk funds an $800 hire. The settle hour runs hot. That funded work still releases. A new hire pauses for a grown-up. A hot hour is not a freeze on funded work.

**Operator door:** the public kernel refuses subscribe. A hosted operator refuses an unsigned speaker and an unpaid month. After an invoice, subscribe records a row. Spend is not gated on that row. The public pin stays unhosted.

**Cart match:** a desk accepts an $800 hire. A $0.01 cart is refused. The matching cart occupies the hire. Funding moves $800, not a penny. A cheaper cart is not a discount.

**Closed room:** a desk opens an RFQ for one vendor. An outsider’s quote is refused. The invited vendor quotes and the hire goes through. An empty invite list lets the outsider quote. A closed room is not a bulletin board.

**Conversion:** a desk tries to hire an FX window and is refused. The window stays unspent. The vendor then settles it. An FX window is not a good.

**Unique live:** a founder shakes hands with a desk. A tighter second hop is refused. A hop to a different agent goes through. Revoke, then attest again. A second live hop is not a tighter grant.

**Spread:** a market maker quotes a conversion at half price and is refused. A decoy top-level rate does not save it. An in-band quote settles. The 200bps band is not decoration.

**Nest:** a founder nests a scout under a desk hop. The scout hires while the parent lives. After the parent hop dies, a new hire is refused. That funded work still releases. A nested hop does not outlive its parent.

**Heir:** a founder hands a tighter child slip to a desk. The desk hires while the parent lives. After the parent slip dies, a new hire is refused even though the child's own window still lives. That funded work still releases. A dead parent is not a parent.

**Stock:** a market maker quotes a conversion against a thin USDC book and is refused. The window stays unspent. A smaller window on a different RFQ converts. Empty MM USDC is not a missing maker.

**Purse:** a founder writes a $1,000 envelope with a $5,000 per-item cap. The desk funds an $800 hire. A $400 second hire is refused — the item cap still allowed. That funded work still releases. A budget is not an item cap.

**Seat:** a hosted operator records one subscribe row. The desk funds an $800 hire — spend is not gated on the row. A second subscribe is refused even on a fresh slip. A different agent takes its own seat. That funded work still releases. One subscriber, one row.

**Cover:** a founder writes a $1,000 parent envelope. The desk funds an $800 hire against the parent. A $400 scout hire on a tighter child is refused — the child's own envelope still allowed. That funded work still releases. A parent envelope is not a child's leftover.

**Mint:** treasury tries to pull from equity and is refused. The desk funds an $800 hire. Pulling that escrow is refused. That funded work still releases. A transfer is not a mint, and it cannot pick the escrow lock.

**Payee:** a founder lists one research vendor. The desk funds an $800 hire to that name. A registered outsider quotes; hire.create is refused. The quote stays unspent. That funded work still releases. A listed payee is not any registered vendor.

**Climb:** a founder shakes hands with a desk at L3. The desk funds an $800 hire. After a climb to L4, a new hire is refused — the slip ceiling still allowed. That funded work still releases. A climb is not a wider handshake.

**Born:** a market maker quotes a conversion that has already closed and is refused. No window is written. An open window quotes and settles. A later lapse is still a settle refuse. An FX window cannot be born dead.

**Reach:** a founder funds an $800 hire on a live slip. A calendar that only opens after that slip would die is refused — no second slip is written. A future window that still opens while the slip lives still mints. That funded work still releases. A window that opens after the slip dies is not a window.

**Year:** a founder funds an $800 hire under a one-year handshake. A hop that outlives one year is refused — no handshake is written. A one-year hop still mints. That funded work still releases. Year 9999 is not standing identity.

**Fuse:** a founder funds an $800 hire against a $1,000 daily fuse. A $400 second hire is refused — the envelope and the item cap still allowed. That funded work still releases. A daily fuse is not a freeze on funded work.

**SKU:** a founder lists research.brief. The desk funds an $800 hire of that good. A catalog deep-research quote is refused. The quote stays unspent. That funded work still releases. A listed SKU is not any catalog good.

**Priced:** a vendor quotes research.brief in USDC. That is refused — no quote is written. A USD quote still hires and that funded work still releases. Convert with market.fx_settle. A listed SKU is only priced in a currency the catalog names.

**Party:** a founder funds an $800 hire. A different vendor’s deliver is refused — the hire stays funded. The seller who quoted still delivers and that work still releases. The other side of the table is not a party.

**Cash:** a founder funds an $800 hire that empties the desk. A $400 second fund is refused — same currency, operating cash, legal hire arrow. That funded work still releases. Empty cash is not a negative book.

**Stale:** a founder funds an $800 hire on a live quote. After that quote’s hour lapses, hire.create is refused — known SKU, known room, unspent promise. A fresh quote on that still-live room still hires. That funded work still releases. A stale quote is not a hire.

**Chain:** a founder funds an $800 hire on a live cart. After that cart’s day, a second fund is refused — occupancy still bound, cash still there. That funded work still releases. A dead cart is not a check.

**Arrow:** a founder funds an $800 hire. Release before deliver is refused — the hire stays funded, escrow does not pay the vendor. After deliver that work still releases. Unfinished work is not a payout.

**Wallet:** a founder funds an $800 hire. A compute vendor’s FX settle is refused — USD cash, live window, maker still there. A research vendor with a USDC book still converts. That funded work still releases. A vendor’s USD cash is not a USDC wallet.

**Name:** a founder funds an $800 hire. An L4 scout minting a handshake in the founder’s name is refused — not a second hop, not a climb above the grant. The founder still mints that pair. That funded work still releases. Someone else’s name is not a handshake.

Pin `aether.protocol.1` v0.96.0. Further protocol bumps are not the default. Public protocol (`liveMoney: false`, `evaluateLlm: false`, `hosted: false`) is what other agents run. Self-host is free. A hosted operator (`Runtime({ hosted: true })` / `AETHER_HOSTED=true`) lists a monthly price (`AETHER_HOSTED_MONTHLY`), requires Ed25519 speaker proof, and records off-band invoices; this public kernel still refuses `host.subscribe` as `host.not_hosted` and `hostedMonthly` stays null. Live rails stay off this pin. `pricing.takeRate` is null. Live bank/chain rails are adapters on these objects, later. A durable world (`AETHER_DATA_DIR`) is what you host. Retries of money-moving commands replay; a deny comes with a typed next step; funded escrow can be unwound. Fetch one object with `aether_get` / `GET /v1/objects/:id`. Command bodies are in `schemas/commands.schema.json` and required fields, listed enums, and integer ranges are enforced at dispatch. Money is integer cents at the bus, not later. The SKU catalog is what may be hired; a catalog SKU is not a listed SKU; stale quotes cannot; an RFQ invite list is binding; a missing RFQ is a missing room, not a missing SKU; a quote settles or hires once; an open approval holds the quote; an expired pause is not a live escalate; a slip cannot be born with a closed calendar; a window that opens after the slip dies is not a window; a cadence with no slots is not a cadence; an expired handshake fetched by id is not live; a dead parent is not a parent; a nested handshake under a dead parent hop is not a handshake; a nested hop does not outlive its parent on a new hire; a spent quote fetched by id is not live; an expired RFQ fetched by id is not an open room; a hire quote in a dead room is not live; a bound cart fetched by id is not unpaid; a funded payment fetched by id is not unpaid; a payment whose parent cart died is not live; a funded intent fetched by id is not unused; an offered hire whose slip died is not live; a pending ticket whose paused command died is not a live yes; a child slip whose parent died is not live; an FX window cannot be born dead; a missing RFQ guest is a missing agent, not a closed room; a missing hire is a missing contract, not a broken chain; a missing intent is a missing slip, not a missing handshake; a missing cart is a missing cart, not a broken chain; a missing ticket is a missing ticket, not a late yes; a grown-up yes does not revive a stale pause; accept and deliver belong to the seller; a missing parent is a missing parent, not a tighter child; a missing agent is a missing agent, not a freeze; an illegal hire arrow is a refuse, not a 409 after yes; payment-required is only after deliver; a skipped rung is a refuse, not a 409 after yes; L5 is not a birthright; you cannot attest yourself; a missing KYA parent is a missing parent, not a live nested handshake; a missing KYA handshake is a missing handshake, not a tombstone; an L4 scout cannot write a founder’s handshake by filling in the ids; omitted handshake principal is the speaker, not the boss; an L4 desk cannot grant a standing-mandate ceiling it does not hold; a reused register alias (or a second market maker sharing one cash book) is a refuse, not a journal throw after yes; two agents cannot share one operating book; a vendor’s USDC wallet is the vendor’s, not system’s; a missing receipt is a missing receipt, not an empty success; a no-op freeze is a refuse, not a notary line after yes; a second live handshake for the same pair is a refuse, not a tighter grant; a handshake cannot be born dead; a handshake cannot outlive one year; an expired handshake is not live in the graph view; a number where a string id belongs is syntax, not a throw after yes; a cart line without an amount is syntax, not a throw after yes; an amount_range without a max is syntax, not an open checkbook; an FX window without a nested rate is syntax, not a NaN settle; the 200bps band binds the nested rate that is stored, not a decoy top-level rateE6; a hire takes one cart, not a pointer swap; a cart takes one payment, not a second check; a payment check is one day in unix seconds, not a thousand; a hire that has not bound its cart is not a funded escrow; a listed SKU is only priced in a currency the catalog names; this rail's FX window is USD_SIM → USDC_SIM with the price in from, not a research quote wearing an fx object, and not a hire; an FX SKU without a window is not a good; a window is not a journal without a market maker; a leftover nonce on a transfer is not a settled payment; a grown-up yes on a hire ticket is the signature, not a stuck escalate; a missing speaker is not a 500; an unknown alias is a missing speaker, not system; a dest book that cannot hold the cents is a refuse, not silent IEEE rounding; system is not a treasurer; GET audit verify is the command bus, not a silent peek; GET accounts and receipts are the command bus as system, not ops-human; a cart line whose cents overflow is syntax, not a throw after yes; mixed USD and USDC in one cart is syntax, not a silent relabel; escrow cannot mix USD cash into a USDC hire; a missing book is a missing book, not an allocation; an FX settle without a USDC book is a missing book, not a journal throw; one journal is one currency; a transfer is not an overdraft; a transfer is not a mint; escrow is not an allocation; escrow cannot lock on empty cash; an FX settle cannot spend USD the vendor does not hold; recurrence frequency is not decoration; a cart must equal the hire it pays; a stale cart does not trap funded escrow; an expired handshake does not trap funded escrow; climbing above a handshake does not trap funded escrow; climbing above a permission-slip ceiling does not trap funded escrow; a hot settle hour does not trap funded escrow; a blown daily fuse does not trap funded escrow; a closed calendar window does not freeze funded work; other agents pin the host card; subscribe to this public kernel is not a checkout.

## The loop

```
Human writes a permission slip (mandate)
        │
        ▼
 Agent asks vendors for prices (RFQ)
        │
        ▼
 Hire + escrow ──► referee (policy kernel)
        │                     no  → stop, with a reason
        │                     ask → a grown-up must sign
        ▼                     yes
 Money locked, work done, receipt written
        │
        ▼
 Notary chain += n     Auditor can read, cannot spend
```

## Why this exists

2025–2026 produced a **payments stack**, not an economy — AP2 for authorization, x402/MPP for HTTP settlement, ACP/UCP for checkout, TAP/KYA for “is this bot real?”, A2A/MCP for talk. The missing layer is still the one that matters when agents actually run parts of the economy: **permission → referee → hire → escrow → receipt → replay**, with a ladder from human-in-the-loop to human-out-of-the-loop.

[`docs/THESIS.md`](docs/THESIS.md) is the market map. [`DESIGN.md`](DESIGN.md) is the machine contract. [`AGENTS.md`](AGENTS.md) is how another agent uses this. [`docs/FOR-HUMANS.md`](docs/FOR-HUMANS.md) is the kitchen table.

## Autonomy ladder

| Level | In English |
|---|---|
| L0 | Human does it. Agent drafts. |
| L1 | Agent prepares. Human says yes each time. |
| L2 | Agent may pay if it still fits the slip. |
| L3 | Agent may hire other agents against that slip. |
| L4 | Agent may hand a smaller slip to another agent. |
| L5 | Standing permission. Humans still hold freeze and circuit breakers. Not god mode. |

## Repository map

| Path | Role |
|---|---|
| `AGENTS.md` | How another agent talks to Aether |
| `packages/aether-policy` | Referee. 87 ordered rules. No LLM. No I/O. |
| `packages/aether-kya` | Know Your Agent. Principal → agent → sub-agent. Revoke cascades. |
| `packages/aether-mcp` | Real MCP host. One Runtime. Tools are commands. |
| `packages/aether-clearing` | Who owes whom. Bilateral exposure and netting views. |
| `packages/aether-runtime` | Command bus |
| `packages/aether-audit` | Notary. Hash-chained log. |
| `packages/aether-ledger` | Double-entry, integer cents |
| `apps/runtime-http` | HTTP command bus + `/.well-known/agent-card.json` |
| `docs/FOR-HUMANS.md` | Kitchen table |

Amounts are integer minor units. Never floats. Canonical JSON is what we hash.

## What we will not add

Live rails in this version. An order book. A storefront. Copied AP2/x402 SDKs. An LLM inside `evaluate()`. Silent re-spend retries. Mutable history.

Adapters for real x402, MPP, AP2, TAP, and ACK belong later, hanging off this kernel.

## License

Apache-2.0
