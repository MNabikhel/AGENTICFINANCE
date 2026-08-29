# Aether thesis — the economic OS above the payment rails

Montaz asked for a foundation for **agentic finance**: not a trading bot, and not a guess at a product, but something agents can actually run as the economy shifts from human-click checkout to machine-speed obligation.

This note is the research brief behind the runtime in this repo.

## 1. The market as of 2026

The industry did not pick a winner. It stacked layers.

**Authorization.** Google’s Agent Payments Protocol (AP2), now moving into FIDO, uses Intent / Cart / Payment mandates as verifiable credentials. Mastercard’s Verifiable Intent is the same idea from the network side. These answer: *did a human (or a scoped standing instruction) authorize this?* They do not move money.

**Settlement.** Coinbase’s x402 revived HTTP 402 for stablecoin micropayments. Stripe + Tempo’s Machine Payments Protocol (MPP) does the same with `charge` and `session` intents, including fiat via Shared Payment Tokens. These answer: *how does the byte actually pay?* They do not know who the agent is allowed to be.

**Checkout.** OpenAI + Stripe Agentic Commerce Protocol (ACP) and Google’s Universal Commerce Protocol (UCP) are merchant shopping journeys. Useful for buying a toaster through ChatGPT or Gemini. Useless as a hiring market, a treasury, an FX window, or a credit book.

**Identity.** “Know Your Agent” became a category, not a standard. Visa Trusted Agent Protocol, Skyfire KYA/KYAPay JWTs, Experian H2A binding, ERC-8004 on-chain registries, Catena ACK DIDs. Every network shipped a different “is this bot real?” primitive.

**Talk.** MCP is agent-to-tool. A2A is agent-to-agent. Neither is money.

Crypto-native “agent economies” (Virtuals ACP, ElizaOS, Olas, Fetch.ai) proved agents can be listed, tokenized, and escrowed on an L2. They did not produce a policy compiler, a dual-control primitive, or a replayable audit log a bank examiner could read.

Central banks noticed. BIS **Project Logos** (with the Bank of England and Bundesbank) is simulating LLM portfolio agents specifically to watch herding. BoE Deputy Governor Sarah Breeden has already asked whether markets need **kill switches** for autonomous trading. The FSB published sound practices. There is still no AI-specific financial license: function is what gets you regulated, not the fact that a model pressed the button.

## 2. The hole

Retail checkout is atomic and prepaid. An economy is **gross exposure, netting, credit, interruption, and replay**.

Nobody in the 2025–26 stack ships:

1. A **deterministic policy kernel** whose output is `allow | deny | escalate`, with a full rule trace, and no LLM in the loop.
2. A **delegation graph**: principal → agent → sub-agent, with capability envelopes and instant revoke.
3. **Agent-to-agent hiring** with escrow and a mandate chain that is not a shopping cart.
4. A **double-entry ledger** plus **hash-chained audit** that can replay to the same decision.
5. An **autonomy ladder** that can be climbed and, more importantly, slammed back to L0.

That is Aether.

## 3. Design bets that should still be true in five years

**Rails churn. Objects do not.** Intent, cart, payment, hire, quote, policy decision, settlement instruction, receipt, audit event. We speak AP2 and x402 *shape* so adapters stay thin.

**Agents are economically capable, never economically sovereign.** L5 skips per-transaction humans. It does not skip amount ranges, budgets, circuit breakers, freezes, or nonces.

**Policy is a pure function.** `evaluate(context) → decision`. Every rule always runs. The trace is the artifact. If a model proposed the command, that is upstream of the kernel.

**Simulation first.** `sim:aether-1`, USD_SIM / USDC_SIM, integer minor units. If the demo cannot close a hire, hit a wall, escalate, settle, and prove an auditor cannot spend — offline — it is not a foundation.

**Kill switches are graduated.** Freeze an actor. Trip a daily circuit. Demote to L0. Do not build a single global button that DoS-es the market (the IMF has already flagged that failure mode).

## 4. What “agents running the economy” actually looks like

Not a superintelligence at the Fed.

It looks like **procurement agents buying data and compute from vendor agents**, **treasury agents allocating cash under a mandate**, **market-maker agents quoting a tightly bounded FX window**, and **auditor agents who can verify everything and spend nothing** — with a human who issued the intent still holding the freeze.

Sprint Procurement in this repo is that picture, shrunk to a TAP test. Night Watch is the same loop with the human off the click path: a KYA handshake, standing permission, a sticky daily fuse, freeze that cascades through the graph, and revoke. Clearing window is the credit line: open gross, a photo, not a second payment. Recurrence is a one-slot slip: complete once, then the cadence is spent. Calendar is a same-day window: fund inside it; a closed calendar does not trap funded work. A refund returns cash; it does not restore a cadence slot. A daily cadence is a gap, not a burst. Occupancy is a bind: a hire takes one cart, a cart takes one payment, and passing cartId on fund is not a pointer. A hot settle hour pauses new spend for a grown-up; it does not freeze funded work. The public kernel is not a hosted checkout: unsigned is 401, unpaid is 402, and `PROTOCOL.hosted` stays false. A cheaper cart is not a discount: `hire.cart_matches` refuses the penny; escrow still moves the hire price. A closed RFQ is a guest list: an outsider’s quote is `market.invited_seller`; an empty list is open. An FX window is not a hire: `hire.not_fx` refuses the conversion as a good; settle still converts. A second live handshake is not a tighter grant: `kya.unique_live` occupies the pair until revoke. A 200bps FX band is not decoration: `mm.spread_bound` refuses an off-band nested rate; a top-level decoy is not the band. A nested hop does not outlive its parent: `kya.parent_fresh` refuses new spend; funded work still finishes. A dead parent is not a parent: `mandate.parent_fresh` refuses new spend against a child after the parent slip dies; the child's own window still lives; funded work still finishes. Empty MM USDC is not a missing maker: `mm.inventory` refuses a large settle; a smaller window still converts. A budget is not an item cap: `payment.budget` refuses a second hire that would exhaust the envelope; the per-item cap still allows; funded work still finishes. One subscriber is one row: `host.unique_subscriber` refuses a second subscribe even on a fresh slip; spend is not gated on the row; a different agent takes its own seat. A parent envelope is not a child's leftover: `payment.parent_budget` refuses a scout hire after the parent is spent; the child's own envelope still allows; funded work still finishes. A transfer is not a mint: `ledger.operating_book` refuses equity and escrow as sources; operating cash still funds; funded work still finishes. A listed payee is not any registered vendor: `payment.allowed_payees` refuses an unlisted hire; the quote is still written; funded work still finishes. A climb is not a wider handshake: `kya.capability_subset` refuses new spend after a climb above the grant; the slip ceiling still allows; funded work still finishes. An FX window cannot be born dead: `market.fx_fresh` refuses a quote whose `validUntil` is already past; no window is written; an open window still settles. A window that opens after the slip dies is not a window: `mandate.window_reach` refuses a calendar that never overlaps the slip; a reachable future still mints; funded work still finishes. A handshake cannot outlive one year: `kya.mint_window` refuses a hop past the one-year ceiling; a one-year hop still mints; funded work still finishes. A daily fuse is not a freeze on funded work: `circuit.daily` refuses a second hire after the daily cap; the envelope still allows; funded work still finishes. A listed SKU is not any catalog good: `payment.allowed_skus` refuses an unlisted catalog hire; the quote is still written; funded work still finishes. A listed SKU is only priced in a catalog currency: `market.sku_currency` refuses a USDC quote on USD-only research; no quote is written; a USD quote still hires. The other side of the table is not a party: `hire.party` refuses a stranger’s deliver; the hire stays funded; the seller who quoted still finishes. Empty cash is not a negative book: `ledger.sufficient` refuses a second fund after the desk is empty; same currency and operating cash still allow; funded work still finishes. A stale quote is not a hire: `market.not_expired` refuses a lapsed quote; the promise stays unspent; a fresh quote on that still-live room still hires; funded work still finishes. A dead cart is not a check: `mandate.chain_integrity` refuses a fund after the cart window; occupancy and cash still allow; funded work still finishes. Unfinished work is not a payout: `hire.state` refuses release before deliver; the hire stays funded; funded work still finishes after deliver. A vendor’s USD cash is not a USDC wallet: `ledger.known_account` refuses an FX settle into a missing dest book; the maker and inventory still allow; funded work still finishes. Someone else’s name is not a handshake: `kya.party` refuses an L4 scout minting in the founder’s name; unique-live and the climb still allow; the founder still mints that pair; funded work still finishes. An FX SKU is a window, not a good: `market.fx_window` refuses a quote of an FX SKU with no window; known SKU and pair still allow; a real window still converts; funded work still finishes. This slip is not yours to spend: `mandate.subject_is_actor` refuses a second desk’s fund; the chain still verifies; the named subject still funds; funded work still finishes. A research quote is not a conversion window: `market.fx_quote` refuses settling a research quote as FX; pair and dest book still allow; a real window still converts; funded work still finishes.

Next revisions are sequenced in [`docs/FOUNDATION.md`](FOUNDATION.md): honesty only if the pin would lie. Rail adapters stay off `evaluate()`. `liveMoney` stays false.

## 5. Sources (starting points)

- AP2: https://ap2-protocol.org/ and https://github.com/google-agentic-commerce/AP2
- x402: https://x402.org/ and https://github.com/coinbase/x402
- MPP: https://mpp.dev/ and https://stripe.com/blog/machine-payments-protocol
- ACP: https://www.agenticcommerce.dev/
- UCP: https://ucp.dev/
- A2A: https://a2a-protocol.org/latest/
- Skyfire KYA: https://docs.skyfire.xyz/
- BIS Project Logos: https://www.bis.org/about/bisih/topics/suptech_regtech/logos.htm
- BoE, Sarah Breeden, “Agents of change” (June 2026)
