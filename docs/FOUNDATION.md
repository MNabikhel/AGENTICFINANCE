# Foundation backlog (10-day stretch)

Montaz is out until about **2026-09-07**. He asked for a planning phase, then autonomous building of the agent economic kernel — not the same inspect overlay again. This file is the queue. Check a box when tests + the TAP demos pass and the work is on the PR.

## What we are building

Aether is the missing layer above the 2026 payments stack: **permission → referee → hire → escrow → receipt → replay**. Other agents should be able to run an economy on this kernel without a website, a token, a live bank, or an LLM in `evaluate()`.

Public pin stays `aether.protocol.1` / `0.96.0` until the pin would otherwise lie. `PROTOCOL.hosted` stays false. `WORLD_VERSION` stays 1. Catalog stays 119 rules unless a new first-deny is required.

## Do not

- Grind `live | expired | funded` inspect overlays. Those were real honesty patches. They are not the next foundation.
- Ask Montaz for a spec.
- Ship a website, an Aether token, live rails, or an LLM referee.
- Mint 0.97 unless a lying allow or a lying pin forces it.

## Workstreams (in order)

### 1. HTTP is the same bus as MCP

An HTTP agent could not deliver work, release escrow, settle an FX window, or transfer treasury cash. MCP already can. That is not a polish gap; it is a missing face of the kernel.

- [x] `POST /v1/commands` `{ type, actor, …body }` dispatches every `CommandType` (unknown type is `command.malformed`, HTTP 400).
- [x] REST aliases: `hire.deliver`, `hire.release`, `market.fx_settle`, `ledger.transfer`.
- [x] Envelope require/submit still set `PAYMENT-*` headers when those types go through `/v1/commands`.
- [x] `GET /v1/commands` stays the JSON Schema (not the dispatcher).

### 2. Discovery serves the spec

- [x] `GET /openapi.yaml` is the OpenAPI document (not a local filesystem note).
- [x] `GET /openapi.json` does not pretend to be a path on the operator’s laptop.
- [x] OpenAPI lists `POST /v1/commands` and the missing hire/FX/transfer aliases. Status codes stay 200 / 422 / 402 / 202 as the bus actually returns.

### 3. Clearing is a demonstrated economic object

`clearing.bilateral_limit` already binds when a payee and amount exist. The TAP demos never hit it. `clearing.settle_window` archives net exposure; it is not a second payment.

- [x] A fourth TAP (`pnpm demo clearing` or an extension of sprint) shows gross legs, a window photo, and a deny when projected gross exceeds the bilateral limit.
- [x] No new policy rule unless the current allow is a lie (limit absent when a pair is in the book).
- [x] Constructor / host option for a test limit is fine. A new `clearing.set_limit` command is not the default.

### 4. KYA issuers are objects, not stickers

`issuerKind` already lists `aether.self`, `tap.http-sig`, `skyfire.kya`, `erc8004.agent`. The graph does not yet pin what those issuers *are*.

- [x] An attestation can name an issuer object the kernel stores (shape-only: no live TAP/Skyfire/chain call).
- [x] Inspect of `dlg_` still derives `live | expired | revoked`. Unique_live still occupies.
- [x] Credentials never enter `evaluate()`. `liveMoney` stays false.

### 5. Only if the pin would lie

Inspect honesty, OpenAPI status codes, MCP description drift. Not a workstream of its own.

- [x] MCP command tools are 1:1 with `CommandType` (`market.fx_settle`, `ledger.transfer` were missing from `tools/list` while HTTP already dispatched them).
- [x] OpenAPI lists HTTP aliases the bus actually serves (`/v1/kya/attest`, `/v1/circuit/reset`, freeze/unfreeze, `/.well-known/agent-card.json`, `GET /v1/kya`).

### 6. Refund is a demonstrated unwind

`hire.refund` reverses escrow, restores mandate spend, and reverse-records clearing. A quote is not restored. The daily circuit stays sticky.

- [x] A TAP (`pnpm demo refund`) funds a hire, unwinds it, and shows cash back, spend restored, clearing reversed, quote still spent, circuit still sticky if it had tripped.
- [x] No new policy rule unless a current allow is a lie (refund after deliver, or a restored quote).

### 7. Retry is a demonstrated replay

Money-moving allows are replayed by key so a retry cannot double-spend. Denies are never cached.

- [x] A TAP (`pnpm demo replay`) funds a hire, retries the same `hire.fund`, and shows cash moved once. The same `hire.create` replays the same hire. A new key on that quote is `hire.quote_unspent`.
- [x] No new policy rule unless a current allow is a double-spend.

### 8. Envelope nonce is a demonstrated one-shot

`idempotency.nonce` binds `envelope.submit`. A leftover `nonce` on a transfer is not a settled payment.

- [x] A TAP (`pnpm demo nonce`) completes a funded hire’s envelope, retries the same nonce, and shows `idempotency.nonce`. A leftover nonce on `ledger.transfer` is not that deny.
- [x] No new policy rule unless a current allow is a second release.

### 9. Honesty if the pin would lie

Not a grind of inspect overlays. Listed command faces match the bus. A deny is never a cached success.

- [x] Command tools stay 1:1 with `CommandType`. OpenAPI lists the TAP demos the discovery card names, including refund, replay, nonce, deny-cache, recurrence, calendar, slot, and daily.
- [x] A TAP (`pnpm demo deny`) freezes a desk, refuses `hire.create`, retries that deny as a new decision, then unfreezes and the same command allows. No new policy rule.

### 10. Honesty if the pin would lie

Not a grind of inspect overlays. Listed command faces match the bus.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. No lying allow this turn. No protocol bump.

### 11. Recurrence is a demonstrated cadence

`payment.recurrence` already binds when a slip names `payment.agent_recurrence`. Completing funded work is not a second slot. A refund does not restore a slot.

- [x] A TAP (`pnpm demo recurrence`) funds and releases one hire on a one-slot slip, shows the occurrence count stays 1 after complete, then refuses a second `hire.create` as `payment.recurrence`. That deny does not write a second hire or spend the quote.
- [x] No new policy rule unless a current allow is a second slot.

### 12. Honesty if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. No lying allow this turn. No protocol bump.

### 13. Calendar is a demonstrated window

`payment.execution_date` already binds new spend. Completing funded work after `not_after` is legal.

- [x] A TAP (`pnpm demo calendar`) refuses `hire.create` before `not_before`, funds inside the window, still releases after `not_after`, then refuses a new hire as `payment.execution_date`.
- [x] No new policy rule unless a current allow traps funded work or lets a new hire through a closed calendar.

### 14. Honesty if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. FOUNDATION claimed a refund does not restore a slot; that was not a TAP until now.

### 15. A refund does not restore a slot

`hire.refund` restores cash and mandate spend. It does not decrement `occurrences`. A one-slot slip stays spent.

- [x] A TAP (`pnpm demo slot`) funds a one-slot hire, unwinds it, shows spend restored and occurrence count still 1, then refuses a second `hire.create` as `payment.recurrence`.
- [x] No new policy rule unless a current allow is a restored slot.

### 16. Honesty if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. No lying allow this turn.

### 17. A cadence is a gap, not a burst

`payment.recurrence` already binds a `DAILY` frequency gap. Completing funded work is not a new occurrence. The cap (`max_occurrences`) is a different object (`pnpm demo recurrence`).

- [x] A TAP (`pnpm demo daily`) releases one hire on a `DAILY` slip, refuses a same-day second `hire.create` as `payment.recurrence`, then after 24 hours that command allows.
- [x] No new policy rule unless a current allow is a same-day burst.

### 18. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. Unique cart occupancy was policy, not a TAP.

### 19. Occupancy is a bind, not a field on fund

A hire takes one cart (`hire.unique_cart`). A cart takes one payment (`mandate.unique_payment`). Passing `cartId` on `hire.fund` is not a pointer (`hire.bound_cart`).

- [x] A TAP (`pnpm demo cart`) funds with a loose `cartId` as `hire.bound_cart`, refuses a second cart as `hire.unique_cart` and a second payment as `mandate.unique_payment`, then the same fund command allows against the bound cart.
- [x] No new policy rule unless a current allow is a pointer swap.

### 20. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A hot settle hour was policy, not a TAP.

### 21. A hot hour is not a freeze on funded work

`velocity.window` already pauses new spend (`hire.create`, `hire.fund`, `market.fx_settle`) after a hot hour. Completing funded work is not a velocity event.

- [x] A TAP (`pnpm demo velocity`) funds one hire, still releases after the hour runs hot, then pauses a new `hire.create` as `velocity.window`. That pause holds the quote; it is not a second hire.
- [x] No new policy rule unless a current allow is a new spend through a hot hour, or a current escalate traps funded work.

### 22. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. The hosted operator door was unit-tested, not a TAP.

### 23. The public kernel is not a hosted checkout

The door sits around `evaluate()`, not inside it. `PROTOCOL.hosted` stays false. A hosted instance (`Runtime({ hosted: true })`) may require speaker proof and a current invoice. Subscribe is enrollment, not a spend gate.

- [x] A TAP (`pnpm demo door`) refuses public subscribe as `host.not_hosted`, refuses an unsigned hosted speaker as 401 `speaker.proof` and an unpaid month as 402 `host.unpaid`, then after an invoice records a subscribe row. Spend is not gated on that row.
- [x] No new policy rule unless a current allow is a public checkout, or spend is gated on a hosted row.

### 24. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A cheaper cart was policy, not a TAP.

### 25. A cheaper cart is not a discount

`hire.cart_matches` already binds `mandate.issue_cart` with `hireId`. Occupancy (`hire.unique_cart`) is a different object (`pnpm demo cart`). Escrow moves the hire price.

- [x] A TAP (`pnpm demo match`) refuses a $0.01 cart as `hire.cart_matches` without occupying the hire, then a matching cart allows and fund moves the hire price. A second matching cart is `hire.unique_cart`.
- [x] No new policy rule unless a current allow is a discount cart.

### 26. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A closed RFQ guest list was policy, not a TAP.

### 27. A closed room is not a bulletin board

Non-empty `invitedSellerIds` already binds `market.quote` / `hire.create` (`market.invited_seller`). Empty or omitted is open. A ghost guest is `identity.known`.

- [x] A TAP (`pnpm demo room`) refuses an uninvited quote as `market.invited_seller` without writing a quote, then the invited seller quotes and `hire.create` allows. An empty invite list lets the outsider quote.
- [x] No new policy rule unless a current allow is a closed room that anyone can quote.

### 28. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. Hiring an FX window was policy, not a TAP.

### 29. An FX window is not a hire

`hire.not_fx` already binds `hire.create` against an FX quote or FX SKU. Windows settle (`market.fx_settle`). A deny does not consume or reserve the window.

- [x] A TAP (`pnpm demo conversion`) refuses `hire.create` as `hire.not_fx` without writing a hire or spending the quote, then `market.fx_settle` converts. A spent window is `hire.quote_unspent`.
- [x] No new policy rule unless a current allow is a hire of a conversion window.

### 30. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A second live handshake was policy, not a TAP.

### 31. A second live hop is not a tighter grant

`kya.unique_live` already binds one live hop per principal→delegate pair. Night-watch attests once and revokes. A tighter second hop is not a new grant.

- [x] A TAP (`pnpm demo pair`) attests once, refuses a second live handshake as `kya.unique_live` without writing a hop, attests a different pair, then revokes and attests again.
- [x] No new policy rule unless a current allow is a second live hop.

### 32. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. The 200bps FX band was policy, not a TAP.

### 33. A 200bps band is not decoration

`mm.spread_bound` already binds the nested `fx.rateE6` on an MM quote. Conversion (`hire.not_fx`) is a different object. A top-level `rateE6` is not the band.

- [x] A TAP (`pnpm demo band`) refuses an off-band nested rate as `mm.spread_bound` without writing a window, even with an in-band top-level decoy, then an in-band quote on that RFQ settles.
- [x] No new policy rule unless a current allow is an off-band nested rate.

### 34. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A nested hop outliving its parent was policy, not a TAP.

### 35. A nested hop does not outlive its parent

`kya.parent_fresh` already binds new spend along a nested hop whose parent is dead. Completing funded work is legal. Unique-live is one hop per pair. Sub-hire is nested slips.

- [x] A TAP (`pnpm demo nest`) funds a scout hire while the parent hop lives, refuses a new `hire.create` as `kya.parent_fresh` after that parent dies without writing a hire, then that funded work still releases.
- [x] No new policy rule unless a current allow is nested spend under a dead parent, or a current deny traps funded work.

### 36. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A dead parent intent was policy, not a TAP.

### 37. A dead parent is not a parent

`mandate.parent_fresh` already binds new spend against a child whose parent slip is dead. Completing funded work is legal. The child's own expiry stays `mandate.not_expired`. Nest TAP is the hop.

- [x] A TAP (`pnpm demo heir`) funds a child hire while the parent slip lives, refuses a new `hire.create` as `mandate.parent_fresh` after that parent dies without writing a hire, then that funded work still releases.
- [x] No new policy rule unless a current allow is nested spend under a dead parent slip, or a current deny traps funded work.

### 38. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. Empty MM USDC was policy, not a TAP.

### 39. Empty MM USDC is not a missing maker

`mm.inventory` already binds `market.fx_settle` when the market maker’s USDC book cannot cover the payout. Conversion (`hire.not_fx`) is a different object. Spread (`mm.spread_bound`) is a different object. A missing maker stays `mm.known`. Vendor USD overdraft stays `ledger.sufficient`.

- [x] A TAP (`pnpm demo stock`) refuses a large FX settle as `mm.inventory` without consuming the window, then a smaller window on a different RFQ converts.
- [x] No new policy rule unless a current allow is an overdraw of MM USDC, or a current deny consumes the window.

### 40. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. An envelope vs an item cap was policy, not a TAP.

### 41. A budget is not an item cap

`payment.budget` already binds new spend when `spent + amount > max`. Completing funded work is legal. Sprint hits `payment.amount_range` inside a longer story. Lid TAP is the focused item cap. Recurrence is a cadence.

- [x] A TAP (`pnpm demo purse`) funds an $800 hire against a $1,000 envelope with a $5,000 per-item cap, refuses a $400 second `hire.create` as `payment.budget` without writing a hire, then that funded work still releases.
- [x] No new policy rule unless a current allow is a second hire through an exhausted envelope, or a current deny traps funded work.

### 42. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A second subscribe row was policy, not a TAP.

### 43. One subscriber is one row

`host.unique_subscriber` already binds a second hosted `host.subscribe` for the same agent. Completing funded work is legal. Spend is not gated on the row. Door TAP is the 401/402 door. Unique-live is one hop per pair.

- [x] A TAP (`pnpm demo seat`) records one hosted subscribe row, funds an $800 hire while subscribed, refuses a second `host.subscribe` as `host.unique_subscriber` even on a fresh slip without writing a row, then a different agent takes its own seat and that funded work still releases.
- [x] No new policy rule unless a current allow is a second row for the same subscriber, or a current deny traps funded work.

### 44. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. Child spend against an exhausted parent envelope was policy, not a TAP.

### 45. A parent envelope is not a child's leftover

`payment.parent_budget` already binds new spend against a child when `parentSpent + amount > parent max`. Completing funded work is legal. Sub-hire hits `mandate.child_tighter` and the child's item cap. Purse is the child's own envelope.

- [x] A TAP (`pnpm demo cover`) funds an $800 desk hire against a $1,000 parent envelope, refuses a $400 scout `hire.create` as `payment.parent_budget` without writing a hire (the child's own envelope still allows), then that funded parent work still releases.
- [x] No new policy rule unless a current allow is child spend through an exhausted parent envelope, or a current deny traps funded work.

### 46. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A transfer against equity or escrow was policy, not a TAP.

### 47. A transfer is not a mint

`ledger.operating_book` already binds `ledger.transfer` when from or to is equity or escrow. Completing funded work is legal. Overdraft stays `ledger.sufficient`. Opening cash is `seedOpening`.

- [x] A TAP (`pnpm demo mint`) refuses a transfer from equity as `ledger.operating_book` without writing a journal, funds an $800 hire, refuses a transfer out of that escrow as `ledger.operating_book` without moving the lock, then that funded work still releases.
- [x] No new policy rule unless a current allow is a mint from equity or a pick of the escrow lock, or a current deny traps funded work.

### 48. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. An unlisted registered vendor was policy, not a TAP.

### 49. A listed payee is not any registered vendor

`payment.allowed_payees` already binds `hire.create` when the seller is not on the slip. Completing funded work is legal. Room TAP is the RFQ guest list (`market.invited_seller`). A missing vendor stays `counterparty.known`.

- [x] A TAP (`pnpm demo payee`) funds an $800 hire to a listed vendor, refuses `hire.create` of a registered outsider as `payment.allowed_payees` without writing a hire (the quote is still written; amount and known counterparty still allow), then that funded work still releases.
- [x] No new policy rule unless a current allow is an unlisted hire, or a current deny traps funded work.

### 50. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A climb above a handshake ceiling was policy, not a TAP.

### 51. A climb is not a wider handshake

`kya.capability_subset` already binds new spend when the actor sits above the handshake ceiling. Completing funded work is legal. Night Watch climbs inside the grant. The slip ceiling stays `ladder.max_autonomy_constraint`.

- [x] A TAP (`pnpm demo climb`) funds an $800 hire under an L3 handshake, climbs the desk to L4, refuses a new `hire.create` as `kya.capability_subset` without writing a hire (the slip ceiling still allows), then that funded work still releases.
- [x] No new policy rule unless a current allow is spend above the grant, or a current deny traps funded work.

### 52. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A window born dead was policy, not a TAP.

### 53. An FX window cannot be born dead

`market.fx_fresh` already binds `market.quote` when `validUntil` is already past or unparseable. A later lapse at settle stays `market.not_expired`. Conversion TAP is `hire.not_fx`. Spread TAP is `mm.spread_bound`. Stock TAP is `mm.inventory`.

- [x] A TAP (`pnpm demo born`) refuses a quote whose window is already closed as `market.fx_fresh` without writing a quote (pair, window shape, band, and later-lapse still allow), then an open window quotes and settles.
- [x] No new policy rule unless a current allow is a corpse born dead, or a current deny traps a later lapse as `market.fx_fresh`.

### 54. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A window that opens after the slip dies was policy, not a TAP.

### 55. A window that opens after the slip dies is not a window

`mandate.window_reach` already binds `mandate.issue_intent` when `not_before` is at or after the slip's seven-day exp. Completing funded work is legal. Calendar TAP is `payment.execution_date` on hire. Wilt TAP is a corpse calendar (`mandate.window_fresh`).

- [x] A TAP (`pnpm demo reach`) funds an $800 hire on a live slip, refuses `mandate.issue_intent` whose window opens after the slip dies as `mandate.window_reach` without writing a slip (a closed calendar still allows), then a reachable future still mints and that funded work still releases.
- [x] No new policy rule unless a current allow is a calendar that never overlaps the slip, or a current deny traps funded work.

### 56. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A handshake that outlives one year was policy, not a TAP.

### 57. A handshake cannot outlive one year

`kya.mint_window` already binds `kya.attest` when `expiresAt` is after now + one year. Completing funded work is legal. Pair TAP is `kya.unique_live`. Spark TAP is a corpse mint (`kya.mint_fresh`). Omit `expiresAt` is the one-year ceiling.

- [x] A TAP (`pnpm demo year`) funds an $800 hire under a one-year handshake, refuses `kya.attest` that outlives one year as `kya.mint_window` without writing a hop (born-dead and unique-live still allow), then a one-year hop still mints and that funded work still releases.
- [x] No new policy rule unless a current allow is standing identity past one year, or a current deny traps funded work.

### 58. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A daily fuse trapping funded work was policy, not a TAP.

### 59. A daily fuse is not a freeze on funded work

`circuit.daily` already binds new spend when the daily cap would trip. Completing funded work is legal. Night Watch first-denies `payment.amount_range` inside a longer story. Lid TAP is the focused item cap. Refund TAP is unwind plus sticky. Velocity TAP is a hot hour.

- [x] A TAP (`pnpm demo fuse`) funds an $800 hire against a $1,000 daily fuse, refuses a $400 second `hire.create` as `circuit.daily` without writing a hire (the envelope and the item cap still allow; the fuse blows), then that funded work still releases.
- [x] No new policy rule unless a current allow is spend after the fuse, or a current deny traps funded work.

### 60. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. An unlisted catalog good was policy, not a TAP.

### 61. A listed SKU is not any catalog good

`payment.allowed_skus` already binds `hire.create` when the slip lists SKUs and the quote’s good is not among them. Completing funded work is legal. Payee TAP is who. Shelf TAP is a ghost SKU (`market.known_sku`). Conversion TAP is `hire.not_fx`.

- [x] A TAP (`pnpm demo sku`) funds an $800 hire of listed `research.brief`, refuses `hire.create` of catalog `research.deep` as `payment.allowed_skus` without writing a hire (known SKU, listed payee, and room still allow), then that funded work still releases.
- [x] No new policy rule unless a current allow is an unlisted catalog hire, or a current deny traps funded work.

### 62. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A listed SKU priced in a currency the catalog does not name was policy, not a TAP.

### 63. A listed SKU is only priced in a catalog currency

`market.sku_currency` already binds `market.quote` when a catalog SKU is priced in a currency the catalog does not name. Completing funded work is legal. SKU TAP is the slip list. Convert with `market.fx_settle`. Shelf TAP is a ghost SKU.

- [x] A TAP (`pnpm demo priced`) refuses `market.quote` of `research.brief` in `USDC_SIM` as `market.sku_currency` without writing a quote (known SKU, known RFQ, and FX pair still allow), then a USD quote still writes and that funded work still releases.
- [x] No new policy rule unless a current allow is a mixed-currency catalog quote, or a current deny traps funded work.

### 64. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. The other side of the table was policy, not a TAP.

### 65. The other side of the table is not a party

`hire.party` already binds accept, deliver, and payment-required to the seller, and refund/release to the buyer or treasury. Completing funded work is legal. Payee TAP is who may be hired. Room TAP is who may quote.

- [x] A TAP (`pnpm demo party`) funds an $800 hire, refuses a different vendor’s `hire.deliver` as `hire.party` without changing hire state (the hire is still known; the funded arrow still allows), then the seller who quoted still delivers and that funded work still releases.
- [x] No new policy rule unless a current allow is a stranger’s deliver, or a current deny traps funded work.

### 66. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. Empty cash trapping funded work was policy, not a TAP.

### 67. Empty cash is not a negative book

`ledger.sufficient` already binds `hire.fund` when the buyer’s operating cash cannot cover escrow. Completing funded work is legal. Mint TAP is a transfer from equity. Stock TAP is empty MM USDC.

- [x] A TAP (`pnpm demo cash`) funds an $800 hire that empties the desk, refuses a $400 second `hire.fund` as `ledger.sufficient` without locking escrow (same currency, operating cash, and the hire arrow still allow), then that funded work still releases.
- [x] No new policy rule unless a current allow is an overdraft, or a current deny traps funded work.

### 68. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A lapsed quote trapping funded work was policy, not a TAP.

### 69. A stale quote is not a hire

`market.not_expired` already binds `hire.create` when the quote or RFQ has lapsed. Completing funded work is legal. Calendar TAP is the slip calendar (`payment.execution_date`). Born TAP is a corpse FX window (`market.fx_fresh`). Replay TAP is a spent quote (`hire.quote_unspent`).

- [x] A TAP (`pnpm demo stale`) funds an $800 hire on a live quote, refuses `hire.create` of a lapsed quote as `market.not_expired` without writing a hire (known SKU, known room, unspent promise, and born-dead still allow; quote unspent), then a fresh quote on that still-live room still hires and that funded work still releases.
- [x] No new policy rule unless a current allow is a hire on a dead price, or a current deny traps funded work.

### 70. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A dead cart trapping funded work was policy, not a TAP.

### 71. A dead cart is not a check

`mandate.chain_integrity` already binds `hire.fund` when verifyChain fails (expiry is checked at fund). Completing funded work is legal. Cart TAP is occupancy. Calendar TAP is the slip calendar (`payment.execution_date`). Stale TAP is quote TTL (`market.not_expired`). A first payment on a stale unpaid cart stays `mandate.not_expired`.

- [x] A TAP (`pnpm demo chain`) funds an $800 hire on a live cart, refuses a second `hire.fund` after that cart’s day as `mandate.chain_integrity` without locking escrow (occupancy, cash, and the hire arrow still allow; hire stays accepted), then that funded work still releases.
- [x] No new policy rule unless a current allow is a fund through a dead cart, or a current deny traps funded work.

### 72. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. An illegal hire arrow trapping funded work was policy, not a TAP.

### 73. Unfinished work is not a payout

`hire.state` already binds `hire.release` when the hire is funded (illegal `funded → released`). Completing funded work after deliver is legal. Bare TAP is deliver before fund (`hire.escrow_required`). Refund TAP is unwind after deliver. Party TAP is who sits on the hire.

- [x] A TAP (`pnpm demo arrow`) funds an $800 hire, refuses `hire.release` before deliver as `hire.state` without paying the vendor (the hire is still known; the buyer is still the party; escrow discipline and the bound cart still allow; hire stays funded), then after deliver that funded work still releases.
- [x] No new policy rule unless a current allow is a payout before deliver, or a current deny traps funded work.

### 74. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A missing USDC book trapping funded work was policy, not a TAP.

### 75. A vendor’s USD cash is not a USDC wallet

`ledger.known_account` already binds `market.fx_settle` when the speaker has no USDC book. Completing funded work is legal. Mint TAP is a transfer from equity. Stock TAP is empty MM USDC.

- [x] A TAP (`pnpm demo wallet`) funds an $800 hire, refuses a compute vendor’s `market.fx_settle` as `ledger.known_account` without consuming the window (the maker, inventory, live quote, and USD cash still allow), then a research vendor with a USDC book still converts and that funded work still releases.
- [x] No new policy rule unless a current allow is an FX settle into a missing dest book, or a current deny traps funded work.

### 76. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A filled-in founder id trapping funded work was policy, not a TAP.

### 77. Someone else's name is not a handshake

`kya.party` already binds `kya.attest` when the speaker is not the named principal (and is not a human/treasury kill switch). Completing funded work is legal. Pair TAP is `kya.unique_live`. Climb TAP is `kya.capability_subset`. Year TAP is `kya.mint_window`. Omit `principalId` is L5 (`kya.capability_subset`). A desk at L3 is `ladder.min_level`.

- [x] A TAP (`pnpm demo name`) funds an $800 hire, refuses an L4 scout’s `kya.attest` in the founder’s name as `kya.party` without writing a hop (not-self, chain, unique-live, and capability-subset still allow), then the founder still mints that pair and that funded work still releases.
- [x] No new policy rule unless a current allow is a handshake in someone else’s name, or a current deny traps funded work.

### 78. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. An FX SKU quoted without a window trapping funded work was policy, not a TAP.

### 79. An FX SKU is a window, not a good

`market.fx_window` already binds `market.quote` when a listed FX SKU has no `fx` window. Completing funded work is legal. Conversion TAP is hiring the window (`hire.not_fx`). Born TAP is a corpse mint (`market.fx_fresh`). Swap TAP is a swapped pair (`market.fx_pair`). Pair TAP is a second live hop (`kya.unique_live`). Shelf TAP is a ghost SKU.

- [x] A TAP (`pnpm demo pane`) funds an $800 hire, refuses `market.quote` of an FX SKU without an `fx` window as `market.fx_window` without writing a quote (known SKU, known room, pair, and born-dead still allow), then a real window still quotes and converts and that funded work still releases.
- [x] No new policy rule unless a current allow is an FX SKU quoted as a good, or a current deny traps funded work.

### 80. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A second desk funding desk A’s hire trapping funded work was policy, not a TAP.

### 81. This slip is not yours to spend

`mandate.subject_is_actor` already binds `hire.fund` when the speaker is not the intent subject. Completing funded work is legal. Party TAP is who sits on the hire (`hire.party`). Name TAP is whose name a handshake is in (`kya.party`). Seat TAP is a hosted subscribe row (`host.unique_subscriber`). A dead cart at fund stays `mandate.chain_integrity`. Empty cash at fund stays `ledger.sufficient`.

- [x] A TAP (`pnpm demo subject`) binds an $800 hire to desk A, refuses desk B’s `hire.fund` as `mandate.subject_is_actor` without locking escrow (known hire, legal arrow, bound cart, cash, intact chain, and hire.party still allow; hire stays accepted), then desk A still funds and that work still releases.
- [x] No new policy rule unless a current allow is a stranger’s fund, or a current deny traps funded work.

### 82. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A research quote settled as FX trapping funded work was policy, not a TAP.

### 83. A research quote is not a conversion window

`market.fx_quote` already binds `market.fx_settle` when the quote has no `fx` window (or is missing, spent, or reserved). Completing funded work is legal. Conversion TAP is hiring the window (`hire.not_fx`). Pane TAP is quoting an FX SKU without a window (`market.fx_window`). Wallet TAP is a missing dest book (`ledger.known_account`). Stock TAP is empty MM USDC (`mm.inventory`).

- [x] A TAP (`pnpm demo paper`) funds an $800 hire, refuses `market.fx_settle` of a research quote as `market.fx_quote` without consuming the quote (pair, maker, dest book, and band still allow), then a real window still converts and that funded work still releases.
- [x] No new policy rule unless a current allow is a research quote settled as FX, or a current deny traps funded work.

### 84. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A mixed-currency transfer trapping funded work was policy, not a TAP.

### 85. A mixed journal is not a conversion

`ledger.same_currency` already binds `ledger.transfer` when USD cash would post into a USDC book. Completing funded work is legal. Wallet TAP is a missing dest book (`ledger.known_account`). Cash TAP is empty operating cash (`ledger.sufficient`). Mint TAP is a transfer from equity (`ledger.operating_book`). Priced TAP is catalog currency (`market.sku_currency`). Paper TAP is settling a research quote as FX (`market.fx_quote`).

- [x] A TAP (`pnpm demo mix`) funds an $800 hire, refuses `ledger.transfer` of USD into a USDC book as `ledger.same_currency` without posting a journal (known books, operating cash, and source still allow), then a real window still converts and that funded work still releases.
- [x] No new policy rule unless a current allow is a mixed journal, or a current deny traps funded work.

### 86. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A skipped rung trapping funded work was policy, not a TAP.

### 87. A skipped rung is not a promotion

`ladder.legal` already binds `ladder.set` when a climb skips a rung. Completing funded work is legal. Climb TAP is a handshake ceiling (`kya.capability_subset`). Night Watch’s premature L5 is the freeze-test gate. Name TAP is whose name a handshake is in (`kya.party`).

- [x] A TAP (`pnpm demo rung`) funds an $800 hire, refuses `ladder.set` L2→L4 as `ladder.legal` without moving the scout (the scout is still known; the founder may still set rungs), then a one-rung climb still goes through and that funded work still releases.
- [x] No new policy rule unless a current allow is a skipped rung, or a current deny traps funded work.

### 88. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] Next turn: if a listed face is missing from the bus, or a current allow is a lie, patch it. If not, take a missing demonstrated economic object rather than a website.

### 89. A junior desk is not a nested-slip mint

`ladder.min_level` already binds `mandate.issue_intent` when a non-human is below L4 (this verb does not escalate). Completing funded work is legal. Climb TAP is a handshake ceiling (`kya.capability_subset`). Rung TAP is a skipped climb (`ladder.legal`). Sub-hire TAP is a wider child (`mandate.child_tighter`). An L1 hire.create stays an escalate.

- [x] A TAP (`pnpm demo grade`) funds an $800 hire, refuses an L3 scout’s nested `mandate.issue_intent` as `ladder.min_level` without writing a child (the parent still exists; the child is still tighter; the handshake ceiling still allows), then an L4 desk still mints that child and that funded work still releases.
- [x] No new policy rule unless a current allow is a nested mint below L4, or a current deny traps funded work.

### 90. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] Next turn: if a listed face is missing from the bus, or a current allow is a lie, patch it. If not, take a missing demonstrated economic object rather than a website.

### 91. L5 is not a birthright

`ladder.birth_rung` already binds `identity.register` when the birth rung is 5. Completing funded work is legal. Rung TAP is a skipped climb (`ladder.legal`). Night Watch’s premature L5 is the freeze-test gate on `ladder.set`. Grade TAP is a junior nested mint (`ladder.min_level`). A taken alias stays `identity.unique_key`. System minting a second agent stays `actor.system_scope`.

- [x] A TAP (`pnpm demo cradle`) funds an $800 hire, refuses `identity.register` at L5 as `ladder.birth_rung` without writing the agent (the alias is still free; the founder may still register; a skip is not this deny), then an L4 register still goes through and that funded work still releases.
- [x] No new policy rule unless a current allow is L5 at register, or a current deny traps funded work.

### 92. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] Next turn: if a listed face is missing from the bus, or a current allow is a lie, patch it. If not, take a missing demonstrated economic object rather than a website.

### 93. A climb is not a wider slip

`ladder.max_autonomy_constraint` already binds new spend when the actor sits above the permission-slip ceiling. Completing funded work is legal. Climb TAP is a handshake ceiling (`kya.capability_subset`). Rung TAP is a skipped climb (`ladder.legal`). Grade TAP is a junior nested mint (`ladder.min_level`). Night Watch climbs inside the grant.

- [x] A TAP (`pnpm demo ceiling`) funds an $800 hire under an L3 slip, climbs the desk to L4, refuses a new `hire.create` as `ladder.max_autonomy_constraint` without writing a hire (the handshake ceiling still allows; the item cap still allows), then that funded work still releases.
- [x] No new policy rule unless a current allow is a climb above the slip ceiling, or a current deny traps funded work.

### 94. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list ceiling. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through ceiling. No inspect-overlay grind.

### 95. An expired hop is not a freeze on funded work

`kya.attestation_fresh` already binds new spend when the handshake itself died. Completing funded work is legal. Nest TAP is a nested hop whose parent died (`kya.parent_fresh`). Year TAP is a hop minted past one year (`kya.mint_window`). Climb TAP is a handshake ceiling (`kya.capability_subset`). Pair TAP is a second live hop (`kya.unique_live`). Stale TAP is quote TTL (`market.not_expired`).

- [x] A TAP (`pnpm demo lapse`) funds an $800 hire under a noon handshake, refuses a new `hire.create` as `kya.attestation_fresh` after that hop dies without writing a hire (the chain still verifies; a nested parent is not this deny; the grant still allows; the pair still occupies), then that funded work still releases.
- [x] No new policy rule unless a current allow is a new hire on a dead hop, or a current deny traps funded work.

### 96. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list lapse. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through lapse. No inspect-overlay grind.

### 97. A dead pause is not a late yes

`approval.pending` already binds resolve when the ticket is expired or already resolved. Completing funded work is legal. Velocity TAP is a hot hour (`velocity.window`). Deny TAP is a cached no. Sour TAP is a stale pause (`approval.replay`). Replay TAP is a retry of an allow (`hire.quote_unspent`). A missing ticket stays `approval.known`.

- [x] A TAP (`pnpm demo pause`) funds an $800 hire under the auto-approve line, pauses a $6,400 `hire.create` as `approval.threshold`, refuses `approval.resolve` after that ticket dies as `approval.pending` without writing a hire (the ticket still exists; a stale command is not this deny; the quote is free again), then that funded work still releases.
- [x] No new policy rule unless a current allow is a late yes on a dead pause, or a current deny traps funded work.

### 98. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list pause. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through pause. No inspect-overlay grind.

### 99. A handshake is not a mirror

`kya.not_self` already binds `kya.attest` when the grantor is the delegate. Completing funded work is legal. Name TAP is whose name a handshake is in (`kya.party`). Pair TAP is a second live hop (`kya.unique_live`). Year TAP is a hop minted past one year (`kya.mint_window`). A corpse handshake mint stays `kya.mint_fresh`.

- [x] A TAP (`pnpm demo mirror`) funds an $800 hire, refuses `kya.attest` of the speaker as `kya.not_self` without writing a hop (someone else's name, a second hop, and a corpse mint still allow), then the founder still mints a real pair and that funded work still releases.
- [x] No new policy rule unless a current allow is a handshake with yourself, or a current deny traps funded work.

### 100. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list mirror. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through mirror. No inspect-overlay grind.

### 101. An agent-issued slip is not host authority

`host.human_authority` already binds hosted `host.subscribe` when the intent issuer is not a human_operator or treasury. Completing funded work is legal. Door TAP is the public kernel (`host.not_hosted`). Seat TAP is a second subscribe row (`host.unique_subscriber`). Spend is not gated on the row. `PROTOCOL.hosted` stays false.

- [x] A TAP (`pnpm demo warrant`) funds an $800 hire, refuses `host.subscribe` on an agent-issued intent as `host.human_authority` without writing a row (the public kernel still allows; a missing seat is not this deny), then a human-issued slip still seats and that funded work still releases.
- [x] No new policy rule unless a current allow is an agent-issued host seat, or a current deny traps funded work.

### 102. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list warrant. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through warrant. No inspect-overlay grind.

### 103. A cadence with no slots is not a cadence

`mandate.occurrence_fresh` already binds `mandate.issue_intent` when a recurrence cap cannot admit a first hire. Completing funded work is legal. Recurrence TAP is a spent slot (`payment.recurrence`). Slot TAP is a refunded slot. Daily TAP is a same-day burst. Calendar TAP is a closed window (`payment.execution_date`).

- [x] A TAP (`pnpm demo vacant`) funds an $800 hire, refuses `mandate.issue_intent` with `max_occurrences` 0 as `mandate.occurrence_fresh` without writing a slip (a spent slot, a closed calendar, and a nested child still allow), then a one-slot slip still mints and that funded work still releases.
- [x] No new policy rule unless a current allow is a cadence with no slots, or a current deny traps funded work.

### 104. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list vacant. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through vacant. No inspect-overlay grind.

### 105. A badge is not a shopping pass

`actor.role_capability` already binds when the speaker's role cannot run the command. Completing funded work is legal. Deny TAP is a freeze (`actor.not_frozen`). Replay TAP is a spent quote (`hire.quote_unspent`). Sprint already shows an auditor cannot spend.

- [x] A TAP (`pnpm demo badge`) funds an $800 hire, refuses an auditor's `hire.create` as `actor.role_capability` without writing a hire (a freeze, a missing speaker, and a spent quote still allow; the quote stays unspent), then the auditor still verifies the notary and that funded work still releases.
- [x] No new policy rule unless a current allow is an auditor hire, or a current deny traps funded work.

### 106. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list badge. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through badge. No inspect-overlay grind.

### 107. An item cap is not an envelope

`payment.amount_range` already binds new spend when `amount > max`. Completing funded work is legal. Purse TAP is the envelope (`payment.budget`). Fuse TAP is the daily cap (`circuit.daily`). Sprint and Night Watch hit this rule inside a longer story.

- [x] A TAP (`pnpm demo lid`) funds an $800 hire against a $1,000 item cap with a $5,000 envelope, refuses a $1,500 `hire.create` as `payment.amount_range` without writing a hire (the envelope still allows; the fuse still allows; the quote stays unspent), then that funded work still releases.
- [x] No new policy rule unless a current allow is a hire over the item cap, or a current deny traps funded work.

### 108. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list lid. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through lid. No inspect-overlay grind.

### 109. Unfunded work is not a delivery

`hire.escrow_required` already binds `hire.deliver` when the hire is not funded. Completing funded work is legal. Arrow TAP is release before deliver (`hire.state`). Party TAP is who sits on the hire. `hire.escrow_required` is before `hire.state` in RULES.

- [x] A TAP (`pnpm demo bare`) funds an $800 hire, refuses `hire.deliver` on an accepted hire as `hire.escrow_required` without writing a deliverable (the hire is still known; the seller is still the party; hire stays accepted), then that funded work still releases.
- [x] No new policy rule unless a current allow is a delivery on unfunded work, or a current deny traps funded work.

### 110. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list bare. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through bare. No inspect-overlay grind.

### 111. A ghost SKU is not a catalog good

`market.known_sku` already binds `market.rfq` when the SKU is not in the catalog. Completing funded work is legal. SKU TAP is the slip list (`payment.allowed_skus`). Priced TAP is catalog currency (`market.sku_currency`).

- [x] A TAP (`pnpm demo shelf`) funds an $800 hire of a catalog good, refuses `market.rfq` of a SKU not in the catalog as `market.known_sku` without writing an RFQ (the slip list still allows; catalog currency is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a ghost SKU hire, or a current deny traps funded work.

### 112. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list shelf. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through shelf. No inspect-overlay grind.

### 113. A missing room is not a missing SKU

`market.known_rfq` already binds `market.quote` when the RFQ is not in this world. Completing funded work is legal. Room TAP is a closed guest list (`market.invited_seller`). Shelf TAP is a ghost SKU (`market.known_sku`). `market.known_sku` is before `market.known_rfq` in RULES but allows when flags are unset.

- [x] A TAP (`pnpm demo hall`) funds an $800 hire, refuses `market.quote` on a ghost RFQ as `market.known_rfq` without writing a quote (a missing SKU still allows; a closed guest list is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a quote on a ghost RFQ, or a current deny traps funded work.

### 114. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list hall. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through hall. No inspect-overlay grind.

### 115. A missing slip is not a missing handshake

`mandate.known_intent` already binds `hire.create` when the intent is not in this world. Completing funded work is legal. Hall TAP is a ghost RFQ (`market.known_rfq`). Heir TAP is a dead parent (`mandate.parent_fresh`). Name TAP is whose name a handshake is in (`kya.party`).

- [x] A TAP (`pnpm demo writ`) funds an $800 hire, refuses `hire.create` on a ghost intent as `mandate.known_intent` without writing a hire (a missing handshake still allows; a dead parent is not this deny; the quote stays unspent), then that funded work still releases.
- [x] No new policy rule unless a current allow is a hire against a ghost slip, or a current deny traps funded work.

### 116. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list writ. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through writ. No inspect-overlay grind.

### 117. A missing cart is not a broken payment chain

`mandate.known_cart` already binds `mandate.issue_payment` when the cart is not in this world. Completing funded work is legal. Cart TAP is occupancy (`mandate.unique_payment`). Chain TAP is a dead cart at fund (`mandate.chain_integrity`). Writ TAP is a ghost slip (`mandate.known_intent`).

- [x] A TAP (`pnpm demo crate`) funds an $800 hire, refuses `mandate.issue_payment` on a ghost cart as `mandate.known_cart` without writing a payment (occupancy still allows; a dead cart at fund is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a payment on a ghost cart, or a current deny traps funded work.

### 118. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list crate. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through crate. No inspect-overlay grind.

### 119. A missing contract is not a broken mandate chain

`hire.known` already binds accept, fund, deliver, and release when the hire is not in this world. Completing funded work is legal. Party TAP is a stranger on a live hire (`hire.party`). Bare TAP is deliver before fund (`hire.escrow_required`). Arrow TAP is release before deliver (`hire.state`). Crate TAP is a ghost cart (`mandate.known_cart`).

- [x] A TAP (`pnpm demo pact`) funds an $800 hire, refuses `hire.deliver` on a ghost hire as `hire.known` without writing a deliverable (a stranger’s deliver still allows; unfunded work is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a delivery on a ghost hire, or a current deny traps funded work.

### 120. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list pact. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through pact. No inspect-overlay grind.

### 121. A missing parent is not a tighter child

`mandate.known_parent` already binds `mandate.issue_intent` when `parentId` is not in this world. Completing funded work is legal. Heir TAP is a dead parent (`mandate.parent_fresh`). Nest TAP is a dead hop (`kya.parent_fresh`). Vacant TAP is a cadence with no slots (`mandate.occurrence_fresh`). Grade TAP is a junior nested mint (`ladder.min_level`).

- [x] A TAP (`pnpm demo root`) funds an $800 hire, refuses `mandate.issue_intent` on a ghost parent as `mandate.known_parent` without writing a child (a tighter child still allows; a dead parent is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a child of a ghost parent, or a current deny traps funded work.

### 122. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list root. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through root. No inspect-overlay grind.

### 123. A missing ticket is not a late yes

`approval.known` already binds `approval.resolve` when the ticket is not in this world. Completing funded work is legal. Pause TAP is a dead ticket (`approval.pending`). Sour TAP is a stale pause (`approval.replay`). Replay TAP is a retry of an allow (`hire.quote_unspent`). Velocity TAP is a hot hour (`velocity.window`). Root TAP is a ghost parent (`mandate.known_parent`).

- [x] A TAP (`pnpm demo docket`) funds an $800 hire, refuses `approval.resolve` on a ghost ticket as `approval.known` without writing a ticket (a dead pause still allows; a stale command is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a yes on a ghost ticket, or a current deny traps funded work.

### 124. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list docket. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through docket. No inspect-overlay grind.

### 125. A missing hop parent is not a nested handshake

`kya.known_parent` already binds `kya.attest` when `parentId` is not in this world. Completing funded work is legal. Nest TAP is a dead hop (`kya.parent_fresh`). Root TAP is a missing slip parent (`mandate.known_parent`). Pair TAP is a second live hop (`kya.unique_live`). Mirror TAP is a handshake with yourself (`kya.not_self`). Docket TAP is a ghost ticket (`approval.known`).

- [x] A TAP (`pnpm demo graft`) funds an $800 hire, refuses `kya.attest` under a ghost parent hop as `kya.known_parent` without writing a hop (a dead hop still allows; a missing slip parent is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a nested hop under a ghost parent, or a current deny traps funded work.

### 126. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list graft. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through graft. No inspect-overlay grind.

### 127. A missing handshake is not a silent tombstone

`kya.known_attestation` already binds `kya.revoke` when the attestation is not in this world (or belongs to another principal). Completing funded work is legal. Graft TAP is a missing hop parent (`kya.known_parent`). Name TAP is whose name a handshake is in (`kya.party`). Night Watch is revoke of a live hop. A foreign handshake by id is the same first deny.

- [x] A TAP (`pnpm demo seal`) funds an $800 hire, mints a live handshake, refuses `kya.revoke` of a ghost attestation as `kya.known_attestation` without tombstoning the live hop (a missing hop parent still allows; someone else’s name is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a tombstone of a missing handshake, or a current deny traps funded work.

### 128. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list seal. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through seal. No inspect-overlay grind.

### 129. A missing invitee is not a closed room

`identity.known` already binds `market.rfq` when an invitee is not in this world. Completing funded work is legal. Room TAP is a closed guest list (`market.invited_seller`). Shelf TAP is a ghost SKU (`market.known_sku`). Hall TAP is a ghost RFQ (`market.known_rfq`). Seal TAP is a missing handshake (`kya.known_attestation`).

- [x] A TAP (`pnpm demo guest`) funds an $800 hire, refuses `market.rfq` that invites a missing seller as `identity.known` without writing an RFQ (a closed guest list still allows; a missing SKU is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a closed room of nobody, or a current deny traps funded work.

### 130. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list guest. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through guest. No inspect-overlay grind.

### 131. A stale unpaid cart is not a late check

`mandate.not_expired` already binds `mandate.issue_payment` when the cart window has closed. Completing funded work is legal. Cart TAP is occupancy (`mandate.unique_payment`). Chain TAP is a dead cart at fund (`mandate.chain_integrity`). Crate TAP is a ghost cart (`mandate.known_cart`). Guest TAP is a missing invitee (`identity.known`).

- [x] A TAP (`pnpm demo dust`) funds an $800 hire, refuses `mandate.issue_payment` on a stale unpaid cart as `mandate.not_expired` without writing a payment (occupancy still allows; a dead cart at fund is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a check on a stale unpaid cart, or a current deny traps funded work.

### 132. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list dust. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through dust. No inspect-overlay grind.

### 133. A no-op thaw is not a kill-switch test

`identity.freeze_state` already binds `identity.unfreeze` when the named agent is live and not frozen. Completing funded work is legal. Deny TAP is a frozen speaker (`actor.not_frozen`). Night Watch is freeze then a real unfreeze. Guest TAP is a missing agent (`identity.known`). Badge TAP is auditor hire (`actor.role_capability`). Dust TAP is a stale unpaid cart (`mandate.not_expired`).

- [x] A TAP (`pnpm demo thaw`) funds an $800 hire, refuses `identity.unfreeze` of a live unfrozen auditor as `identity.freeze_state` without writing an UNFREEZE line (a missing agent still allows; a frozen speaker is not this deny), then that funded work still releases and the auditor still verifies.
- [x] No new policy rule unless a current allow is a notary line after a no-op thaw, or a current deny traps funded work.

### 134. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list thaw. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through thaw. No inspect-overlay grind.

### 135. A taken alias is not a second agent

`identity.unique_key` already binds `identity.register` when the runtime alias (or its operating book) is taken. Completing funded work is legal. Cradle TAP is L5 at birth (`ladder.birth_rung`). System minting a second agent stays `actor.system_scope`. Thaw TAP is a no-op freeze delta (`identity.freeze_state`).

- [x] A TAP (`pnpm demo twin`) funds an $800 hire, refuses `identity.register` on the taken desk alias as `identity.unique_key` without writing an agent (L5 at birth still allows; system minting a second agent is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a second agent on a taken name, or a current deny traps funded work.

### 136. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list twin. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through twin. No inspect-overlay grind.

### 137. System is not a treasurer

`actor.system_scope` already binds `identity.register` as system after the first human exists. Completing funded work is legal. Twin TAP is a taken alias (`identity.unique_key`). Cradle TAP is L5 at birth (`ladder.birth_rung`). A missing speaker stays `actor.known`.

- [x] A TAP (`pnpm demo fence`) funds an $800 hire, refuses `identity.register` as system after the first human as `actor.system_scope` without writing an agent (a taken alias still allows; L5 at birth is not this deny), then that funded work still releases.
- [x] No new policy rule unless a current allow is a system mint after the first human, or a current deny traps funded work.

### 138. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list fence. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through fence. No inspect-overlay grind.

### 139. A missing speaker is not a 500

`actor.known` already binds a command whose `actorId` is not `system` and is not a registered agent. Completing funded work is legal. Guest TAP is a missing named target (`identity.known`). Fence TAP is system spending (`actor.system_scope`). Deny TAP is a frozen registered speaker (`actor.not_frozen`). Badge TAP is auditor hire (`actor.role_capability`).

- [x] A TAP (`pnpm demo mute`) funds an $800 hire, refuses `ledger.balances` from a missing actorId as `actor.known` without writing books (a missing named target still allows; a frozen speaker is not this deny; system spending is not this deny; the live desk still reads), then that funded work still releases.
- [x] No new policy rule unless a current allow is a 500 or silent system from a missing speaker, or a current deny traps funded work.

### 140. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list mute. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through mute. No inspect-overlay grind.

### 141. A missing receipt is not an empty success

`receipt.known` already binds `receipt.get` when the receiptId is not in this world. Completing funded work is legal. Mute TAP is a missing speaker (`actor.known`). Guest TAP is a missing named target (`identity.known`). HTTP GET of a miss is the same first deny.

- [x] A TAP (`pnpm demo nil`) funds an $800 hire, refuses `receipt.get` of a missing receiptId as `receipt.known` without writing a receipt (a missing speaker still allows; a missing named target is not this deny; the live receipt still fetches), then that funded work still releases.
- [x] No new policy rule unless a current allow is an empty success from a missing receipt, or a current deny traps funded work.

### 142. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list nil. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through nil. No inspect-overlay grind.

### 143. A handshake cannot be born dead

`kya.mint_fresh` already binds `kya.attest` when `expiresAt` is already past (or unparseable). Completing funded work is legal. Year TAP is a hop past one year (`kya.mint_window`). Pair TAP is a second live hop (`kya.unique_live`). Mirror TAP is a handshake with yourself (`kya.not_self`). Unparseable `expiresAt` is the same first deny.

- [x] A TAP (`pnpm demo spark`) funds an $800 hire, refuses `kya.attest` with `expiresAt` already past as `kya.mint_fresh` without writing a hop (a century mint still allows; a second live hop is not this deny), then a one-year hop still mints and that funded work still releases.
- [x] No new policy rule unless a current allow is a written corpse handshake, or a current deny traps funded work.

### 144. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list spark. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through spark. No inspect-overlay grind.

### 145. A permission slip cannot be born with a closed calendar

`mandate.window_fresh` already binds `mandate.issue_intent` when `not_after` is already past (or inverted, or unparseable). Completing funded work is legal. Reach TAP is a window that opens after the slip dies (`mandate.window_reach`). Calendar TAP is hire-time (`payment.execution_date`). Vacant TAP is a cadence with no slots (`mandate.occurrence_fresh`). Unparseable or inverted windows are the same first deny.

- [x] A TAP (`pnpm demo wilt`) funds an $800 hire, refuses `mandate.issue_intent` with `not_after` already past as `mandate.window_fresh` without writing a slip (a window that opens after the slip dies still allows; a hire-time calendar is not this deny), then a live slip still mints and that funded work still releases.
- [x] No new policy rule unless a current allow is a written corpse calendar, or a current deny traps funded work.

### 146. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list wilt. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through wilt. No inspect-overlay grind.

### 147. A window is not a journal against nobody

`mm.known` already binds `market.fx_settle` of a live FX quote when there is no market maker (or missing MM books). Completing funded work is legal. Wallet TAP is a missing dest book (`ledger.known_account`). Stock TAP is empty MM USDC (`mm.inventory`). Missing MM books is the same first deny.

- [x] A TAP (`pnpm demo maker`) funds an $800 hire, refuses `market.fx_settle` of a live FX quote with no market maker as `mm.known` without consuming the window (empty inventory still allows; a missing dest book is not this deny), then a maker still sits and that same window still converts and that funded work still releases.
- [x] No new policy rule unless a current allow is a journal against nobody, or a current deny traps funded work.

### 148. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list maker. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through maker. No inspect-overlay grind.

### 149. A cart label is not the hire's money

`payment.currency_match` already binds `hire.fund` when the cart or payment currency is not the hire's money. Completing funded work is legal. Mix TAP is a mixed journal (`ledger.same_currency`). Priced TAP is a USDC quote (`market.sku_currency`). Cart TAP is a loose USD pointer (`hire.bound_cart`). Match TAP is a cheaper cart (`hire.cart_matches`). A USDC `issue_cart` with `hireId` is `hire.cart_matches` first — do not sneak that way.

- [x] A TAP (`pnpm demo ink`) funds an $800 hire, refuses `hire.fund` of a second accepted USD hire with a loose USDC cart as `payment.currency_match` without locking escrow (a mixed journal, a USDC quote, and a loose USD pointer still allow), then a USD cart still binds and funds and that first funded work still releases.
- [x] No new policy rule unless a current allow is a cart label standing in for the hire's money, or a current deny traps funded work.

### 150. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list ink. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through ink. No inspect-overlay grind.

### 151. IEEE rounding is not a mint

`ledger.safe_balance` already binds a journal whose dest (or matching source/equity leg) would leave a book outside `Number.isSafeInteger`. Completing funded work is legal. Cash TAP is empty operating cash (`ledger.sufficient`). Wallet TAP is a missing dest book (`ledger.known_account`). Mix TAP is a mixed journal (`ledger.same_currency`). Mint TAP is a transfer from equity (`ledger.operating_book`). Restore of old worlds still applies historical journals; a new post does not.

- [x] A TAP (`pnpm demo brim`) funds an $800 hire, refuses `ledger.transfer` of one more cent into a book already at the integer ceiling as `ledger.safe_balance` without posting a journal (empty cash, a missing dest, a mixed journal, and a mint still allow), then a penny still posts to a book that can hold it and that funded work still releases.
- [x] No new policy rule unless a current allow is silent IEEE rounding, or a current deny traps funded work.

### 152. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list brim. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through brim. No inspect-overlay grind.

### 153. A swapped pair is not a silent journal of the books this rail actually posts

`market.fx_pair` already binds `market.quote` / `market.fx_settle` when the window is not USD_SIM → USDC_SIM priced in `from`. Completing funded work is legal. Pane TAP is a missing window (`market.fx_window`). Born TAP is a corpse mint (`market.fx_fresh`). Conversion TAP is hiring the window (`hire.not_fx`). Paper TAP is settling a research quote (`market.fx_quote`). Pair TAP is a second live hop (`kya.unique_live`). A research SKU wearing an FX window or a price in `to` is the same first deny.

- [x] A TAP (`pnpm demo swap`) funds an $800 hire, refuses `market.quote` of an FX SKU with swapped `from`/`to` as `market.fx_pair` without writing a quote (a missing window, a corpse mint, and catalog currency still allow), then a real window still quotes and converts and that funded work still releases.
- [x] No new policy rule unless a current allow is a silent journal of the books this rail actually posts, or a current deny traps funded work.

### 154. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list swap. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through swap. No inspect-overlay grind.

### 155. A grown-up yes is not a late hire

`approval.replay` already binds `approval.resolve` approved when the ticket is live but the paused command would not allow. Completing funded work is legal. Pause TAP is a dead ticket (`approval.pending`). Docket TAP is a missing ticket (`approval.known`). Replay TAP is a retry of an allow (`hire.quote_unspent`). A missing held command is the same first deny. Do not grind inspect overlays (`stale` is a view, not a store field).

- [x] A TAP (`pnpm demo sour`) funds an $800 hire under the auto-approve line, pauses a $6,400 `hire.create`, refuses `approval.resolve` approved after that quote dies as `approval.replay` without writing a hire (a missing ticket and a dead ticket still allow; the quote stays held), then a grown-up no still frees the quote and that funded work still releases.
- [x] No new policy rule unless a current allow is a late hire, or a current deny traps funded work.

### 156. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list sour. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through sour. No inspect-overlay grind.

### 157. A revoke is not an expiry

`kya.chain_intact` already binds spend when there is no live path from the principal, including a revoke tombstone. Completing funded work after hop expiry is legal; freeze and revoke still bind. Lapse TAP is an expired hop (`kya.attestation_fresh`). Nest TAP is a nested parent (`kya.parent_fresh`). Deny TAP is a frozen speaker (`actor.not_frozen`). Seal TAP is a ghost revoke (`kya.known_attestation`). Freeze of the founder is `kya.principal_not_frozen`. Night Watch and sub-hire already first-deny this inside a longer story.

- [x] A TAP (`pnpm demo cut`) funds an $800 hire under a live handshake, refuses a new `hire.create` after that hop is revoked as `kya.chain_intact` without writing a hire (an expired hop, a nested parent, a frozen speaker, and a ghost revoke still allow; the tombstone still occupies), then a new handshake still unlocks the lock and that funded work still releases.
- [x] No new policy rule unless a current allow is a spend after revoke, or a current deny traps funded work after expiry.

### 158. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list cut. No lying allow.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through cut. No inspect-overlay grind.

### 159. A frozen principal is not a frozen desk

`kya.principal_not_frozen` already binds KYA-gated spend when the money’s owner is frozen and the speaker is a delegate. Completing funded work after hop expiry is legal; freeze and revoke still bind. Deny TAP is a frozen speaker (`actor.not_frozen`). Cut TAP is a revoked hop (`kya.chain_intact`). Thaw TAP is a no-op unfreeze (`identity.freeze_state`). Night Watch already first-denies this inside a longer story.

- [x] A TAP (`pnpm demo ice`) funds an $800 hire under a live handshake, refuses a new `hire.create` after the founder is frozen as `kya.principal_not_frozen` without writing a hire (a frozen speaker, a revoked hop, and a no-op thaw still allow; the handshake still lives), then an unfreeze still unlocks the lock and that funded work still releases.
- [x] No new policy rule unless a current allow is a spend after the principal is frozen, or a current deny traps funded work after expiry.

### 160. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list ice. No lying allow on the ice listing.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through ice. No inspect-overlay grind.

### 161. A listed rail is not decoration

`payment.allowed_payment_instruments` is a listed constraint type. DESIGN claimed every intent constraint evaluates; the referee never did. That allow was a lie. Completing funded work is legal. Payee TAP is who (`payment.allowed_payees`). SKU TAP is what (`payment.allowed_skus`). Live-rail *type* stays `instrument.sim_only`. Empty lists and nested children that drop the parent's list are the same first deny / `mandate.child_tighter`. Cite TAP binds `payment.reference` once a funded check exists.

- [x] A TAP (`pnpm demo rail`) funds an $800 hire under a slip that lists this kernel's sim ledger, refuses a new `hire.create` against a slip that lists a ghost rail as `payment.allowed_payment_instruments` without writing a hire (a listed payee and a live-rail type still allow), then that funded work still releases.
- [x] New first-deny: a listed instrument is not decoration. Catalog is 88. Pin stays 0.96.0.

### 162. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list rail. No lying allow on the rail listing.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through rail. No inspect-overlay grind.

### 163. A junior signature is not a grown-up pause

`human.signature_present` already binds `envelope.submit` at L0/L1 when the payment JWS is not a `human_operator`. Completing funded work is legal. Grade TAP is a junior nested mint (`ladder.min_level`). Pause TAP is a dead ticket (`approval.pending`). Badge TAP is auditor hire (`actor.role_capability`). Subject TAP is a stranger's slip (`mandate.subject_is_actor`). A vendor pull is `mandate.subject_is_actor` first. Demoting the buyer after fund is the same first deny.

- [x] A TAP (`pnpm demo pen`) funds an $800 hire through grown-up pauses on an L1 desk, refuses `envelope.submit` as `human.signature_present` without minting a ticket (role, subject, and party still allow; the rung only pauses), then treasury still releases.
- [x] No new policy rule unless a current allow is a junior envelope that settles, or a grown-up pause that winks the missing JWS.

### 164. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list pen. No lying allow on the pen listing.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through pen. No inspect-overlay grind.

### 165. A fourth hop is not a nested parent

`kya.delegation_depth` already binds KYA-gated spend when a live path is longer than three hops. Nested `parentId` hops minted by the same grantor do not add BFS depth. An agent cannot attest the founder's principal (`kya.party`). Kill-switch grantors can. Completing funded work is legal. Cut TAP is a revoked hop (`kya.chain_intact`). Nest TAP is a dead parent hop (`kya.parent_fresh`). Climb TAP is a grant ceiling (`kya.capability_subset`). Name TAP is attesting in someone else's name (`kya.party`).

- [x] A TAP (`pnpm demo well`) funds an $800 hire under a three-hop handshake, refuses a new `hire.create` down a four-hop chain as `kya.delegation_depth` without writing a hire (a missing path, a dead parent hop, and a climb still allow), then that funded work still releases.
- [x] No new policy rule unless a current allow is a fourth hop that spends, or a nested parent that is counted as a hop.

### 166. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list well. No lying allow on the well listing.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through well. No inspect-overlay grind.

### 167. A listed reference is not decoration once a check exists

`payment.reference` is a listed constraint type. DESIGN claimed every intent constraint evaluates; the referee did not bind it until a prior payment existed. After every TAP's $800 fund, a prior funded payment does exist, and a ghost `conditional_transaction_id` still allowed. That allow was a lie. Completing funded work is legal. Payee TAP is who (`payment.allowed_payees`). Rail TAP is which ledger (`payment.allowed_payment_instruments`). SKU TAP is what (`payment.allowed_skus`). Live-rail *type* stays `instrument.sim_only`. Before any funded payment the constraint is still AP2-shaped catalog surface. Nested children that drop or change the parent's hash stay `mandate.child_tighter`.

- [x] A TAP (`pnpm demo cite`) funds an $800 hire, refuses a new `hire.create` against a slip that cites a ghost checkout as `payment.reference` without writing a hire (a listed payee, a listed rail, and a listed SKU still allow), then a citation of that funded check still hires and that funded work still releases.
- [x] New first-deny: `payment.reference`. Catalog 88 → 89. Protocol stays 0.96.0.

### 168. Honesty remainder

CommandType 1:1 with MCP command tools. OpenAPI and the discovery card list cite. The submit header is not the command bus. No lying allow on the cite listing.

- [x] CommandType ↔ MCP command tools stay 1:1. OpenAPI lists every TAP the discovery card names through cite. No inspect-overlay grind.
- [x] OpenAPI `PAYMENT-SIGNATURE` is optional. The command bus is the JSON body. Omit is a policy deny, not a missing header. `envelope.require` is HTTP 402 with `PAYMENT-REQUIRED`. Hosted unpaid stays the door (`host.unpaid`).

### 169. Honesty remainder

`verifyChain` is signatures and hashes, not the referee. Intent constraints evaluate in policy. Dispatch cannot mint a self-deal. No lying listed HTTP/MCP face on the cite listing.

- [x] DESIGN `verifyChain` steps are JWS / hash / payee / amount / exp. Constraint evaluation is §3. A ghost `payment.reference` still verifyChains. Cite TAP is the referee.
- [x] Self-deal is `policy.test.ts` (unit deny). `hire.test.ts` does not mint one. No role has both `hire.create` and `market.quote`. MCP command tools stay 1:1; demo tools are TAP runners.

### 170. Honesty remainder

The CLI audit verify is the command bus, not a stub. A replay file is the books.

- [x] `aether audit verify` dispatches `audit.verify` (system speaker). DESIGN HTTP is `node:http`, not Fastify. OpenAPI is handwritten, not generated.
- [x] `aether ledger replay` is jsonl ≡ memory. `replayEqualsMemory` restores this ledger's accounts, then the journals. A tampered file is not a match. No inspect-overlay grind.

### 171. Someone else's key is not yours to turn

DESIGN listed `rotateKey` on the identity package. The bus had no `identity.rotate`. That is a missing key-lifecycle object, not a website, a token, or a live rail. Rotation is not a new identity. Retired keys still verify. Completing funded work after a stolen rotate is refused is legal. Ghost rotate stays `identity.known`. Frozen speaker stays `actor.not_frozen`. System stays `actor.system_scope`.

- [x] A TAP (`pnpm demo lock`) funds an $800 hire, refuses `identity.rotate` of a desk by a vendor as `identity.party` without writing an `IDENTITY_ROTATE` line (a missing agent and a frozen speaker still allow), then the desk still turns its own lock and that funded work still releases.
- [x] New first-deny: `identity.party`. Catalog 89 → 90. Protocol stays 0.96.0.

### 172. A void is not a refund

DESIGN listed `offered → void` and `accepted → void` before fund. The bus had no `hire.void`. That is a missing hire-lifecycle object, not a website, a token, or a live rail. Void does not restore the quote. Completing funded work after a funded void is refused is legal. Ghost void stays `hire.known`. A stranger stays `hire.party`. Refund TAP is unwind funded escrow. Arrow TAP is release before deliver.

- [x] A TAP (`pnpm demo void`) funds an $800 hire, refuses `hire.void` of that funded hire as `hire.state` without writing a void line (the party still allows; a missing hire is not this deny), then an unfunded offer still voids without restoring the quote and that funded work still releases.
- [x] No new policy rule. Catalog stays 90. Protocol stays 0.96.0.

### 173. Someone else's bid is not yours to pull

DESIGN listed `acceptQuote` on the market package. That is hire.create / fx_settle consuming a quote — do not mint `market.accept_quote`. The bus had no `market.withdraw`. A live bid sitting until the hour dies is a missing quote-lifecycle object, not a website, a token, or a live rail. Folding does not restore a spent quote. Completing funded work after a stolen fold is refused is legal. Ghost fold stays `market.known_rfq`. An expired window stays `market.not_expired`. Spent stays `hire.quote_unspent`. Lock TAP is someone else's key (`identity.party`). Void TAP is tearing up an unfunded hire (`hire.void`).

- [x] A TAP (`pnpm demo fold`) funds an $800 hire, refuses `market.withdraw` of a live quote by a second vendor as `market.party` without writing a `QUOTE_WITHDRAW` line (a missing quote and an expired window still allow), then the seller still folds its own bid, hiring that folded quote is `market.not_expired`, and that funded work still releases.
- [x] New first-deny: `market.party`. Catalog 90 → 91. Protocol stays 0.96.0.

### 174. Someone else's unused slip is not yours to tear

DESIGN listed `issueIntent` / `issueCart` / `issuePayment` / `verifyChain` on the mandate package. The bus had no `mandate.revoke`. A live unused slip sitting until `exp` is a missing permission-lifecycle object, not a website, a token, or a live rail. Ripping does not unwind funded escrow. Completing funded work after a stolen rip is refused is legal. Ghost rip stays `mandate.known_intent`. An expired window stays `mandate.not_expired`. Fold TAP is someone else's bid (`market.party`). Void TAP is tearing up an unfunded hire (`hire.void`). Cut TAP is firing a handshake (`kya.revoke`).

- [x] A TAP (`pnpm demo rip`) funds an $800 hire, refuses `mandate.revoke` of a live unused intent by a desk as `mandate.party` without writing a `MANDATE_REVOKE` line (a missing slip and an expired window still allow), then the founder still rips its own unused slip, hiring that ripped slip is `mandate.not_expired`, and that funded work still releases.
- [x] New first-deny: `mandate.party`. Catalog 91 → 92. Protocol stays 0.96.0.

### 175. Someone else's room is not yours to close

DESIGN listed `createRfq` / `submitQuote` / `withdrawQuote` on the market package. The bus had no `market.close`. A live room sitting until the day dies is a missing market-lifecycle object, not a website, a token, or a live rail. Fold TAP is someone else's bid (`market.party`). Do not reuse that flag: it is the named seller of a quote. Shut TAP is the named buyer who opened the room. Completing funded work after a stolen shut is refused is legal. Ghost shut stays `market.known_rfq`. An expired window stays `market.not_expired`. Closing the room does not kill an already-minted FX window.

- [x] A TAP (`pnpm demo shut`) funds an $800 hire, refuses `market.close` of a live RFQ by a second procurement desk as `market.rfq_party` without writing an `RFQ_CLOSE` line (a missing room and an expired window still allow; `market.party` still allows), then the buyer still shuts its own room, hiring that shut room's quote is `market.not_expired`, and that funded work still releases.
- [x] New first-deny: `market.rfq_party`. Catalog 92 → 93. Protocol stays 0.96.0.

### 176. Someone else's unused checkout is not yours to dump

DESIGN listed `issueIntent` / `issueCart` / `issuePayment` / `revokeIntent` / `verifyChain` on the mandate package. The bus had no `mandate.revoke_cart`. A live unused checkout sitting until `expiresAt` is a missing mandate-lifecycle object, not a website, a token, or a live rail. Rip TAP is someone else's unused slip (`mandate.party`). Do not reuse that flag: it is the named issuer of an intent. Dump TAP is the named merchant, the hire's buyer, or the intent subject. Completing funded work after a stolen dump is refused is legal. Ghost dump stays `mandate.known_cart`. An expired window stays `mandate.not_expired`. Bound is when a payment occupies it — dump of a bound cart is not a refund. Unused dump frees hire occupancy.

- [x] A TAP (`pnpm demo dump`) funds an $800 hire, refuses `mandate.revoke_cart` of a live unused cart by a second procurement desk as `mandate.cart_party` without writing a `CART_REVOKE` line (a missing cart and an expired window still allow; `mandate.party` still allows), then the buyer still dumps its own unused cart, paying that dumped cart is `mandate.not_expired`, occupancy frees, and that funded work still releases.
- [x] New first-deny: `mandate.cart_party`. Catalog 93 → 94. Protocol stays 0.96.0.

### 177. Someone else's unused payment is not yours to spike

DESIGN listed `issueIntent` / `issueCart` / `issuePayment` / `revokeIntent` / `revokeCart` on the mandate package. The bus had no `mandate.revoke_payment`. A live unused check sitting until `exp` is a missing mandate-lifecycle object, not a website, a token, or a live rail. Dump TAP is someone else's unused checkout (`mandate.cart_party`). Do not reuse that flag: it is the named merchant of a cart. Spike TAP is the named signer, the payee, the hire's buyer, or the intent subject. Completing funded work after a stolen spike is refused is legal. Ghost spike stays `mandate.known_payment`. An expired window stays `mandate.not_expired`. Funded is when escrow occupies it — spike of a funded payment is not a refund. Unused spike frees unique_payment occupancy.

- [x] A TAP (`pnpm demo spike`) funds an $800 hire, refuses `mandate.revoke_payment` of a live unused payment by a second procurement desk as `mandate.payment_party` without writing a `PAYMENT_REVOKE` line (a missing payment and an expired window still allow; `mandate.cart_party` still allows), then the buyer still spikes its own unused payment, funding that spiked payment is `mandate.not_expired`, occupancy frees, and that funded work still releases.
- [x] New first-denies: `mandate.known_payment`, `mandate.payment_party`. Catalog 94 → 96. Protocol stays 0.96.0.

### 178. A week is not a cadence on a seven-day slip

`payment.agent_recurrence` listed WEEKLY = 7d and MONTHLY = 30d. Intent `exp` is seven days. A second WEEKLY hire opens as the slip dies (`mandate.not_expired` first). That allow at mint was a lie: the slip named a week it could not keep. Completing funded work is legal. Vacant TAP is no slots (`mandate.occurrence_fresh`). Reach TAP is a calendar that opens after the slip dies (`mandate.window_reach`). Daily TAP is 24 hours (`payment.recurrence`). A one-shot WEEKLY still mints. DAILY still mints.

- [x] A TAP (`pnpm demo week`) funds an $800 hire, refuses `mandate.issue_intent` with WEEKLY or MONTHLY that cannot admit a second hire as `mandate.cadence_reach` without writing a slip (a vacant slot, a closed calendar, and hire-time recurrence still allow), then a one-shot WEEKLY still mints, DAILY still mints, and that funded work still releases.
- [x] New first-deny: `mandate.cadence_reach`. Catalog 96 → 97. Protocol stays 0.96.0.

### 179. A floor above the lid is not a range

`payment.amount_range` listed `[min,max]`. DESIGN claimed every intent constraint evaluates; min > max still minted. That allow at mint was a lie: the slip named a band no hire could enter. Completing funded work is legal. Lid TAP is hire-time max (`payment.amount_range`). Vacant TAP is no slots (`mandate.occurrence_fresh`). Week TAP is WEEKLY/MONTHLY (`mandate.cadence_reach`). An exact band (min === max) still mints. An open floor still mints. Nested children whose floor is below the parent stay `mandate.child_tighter`.

- [x] A TAP (`pnpm demo gulf`) funds an $800 hire, refuses `mandate.issue_intent` with min exceeding max as `mandate.range_fresh` without writing a slip (a vacant slot, a week on a seven-day slip, and hire-time max still allow), then an exact band still mints, an open floor still mints, and that funded work still releases.
- [x] New first-deny: `mandate.range_fresh`. Catalog 97 → 98. Protocol stays 0.96.0.

### 180. A closed coffer is not a budget

`payment.budget` listed an envelope max. DESIGN claimed every intent constraint evaluates; max 0, or max below an `amount_range` floor, still minted. That allow at mint was a lie: the slip named an envelope no hire could enter. Completing funded work is legal. Purse TAP is hire-time envelope (`payment.budget`). Gulf TAP is an inverted band (`mandate.range_fresh`). Vacant TAP is no slots (`mandate.occurrence_fresh`). A coffer that covers the floor (max ≥ min) still mints. An open floor still mints. Nested children whose envelope is wider than the parent stay `mandate.child_tighter`.

- [x] A TAP (`pnpm demo coffer`) funds an $800 hire, refuses `mandate.issue_intent` with budget max 0 or budget below the amount_range floor as `mandate.budget_fresh` without writing a slip (a vacant slot, a floor above the lid, and hire-time envelope still allow), then a coffer that covers the floor still mints, an open floor still mints, and that funded work still releases.
- [x] New first-deny: `mandate.budget_fresh`. Catalog 98 → 99. Protocol stays 0.96.0.

### 181. A USDC coffer on a USD lid is not a budget

`payment.amount_range` and `payment.budget` can name different currencies. DESIGN claimed every intent constraint evaluates; a USD lid + USDC coffer still minted. That allow at mint was a lie: no hire can satisfy both (USD fails budget currency; USDC fails range currency). Completing funded work is legal. Ink TAP is cart vs hire (`payment.currency_match`). Mix TAP is a mixed journal (`ledger.same_currency`). Priced TAP is SKU currency (`market.sku_currency`). Coffer TAP is a closed envelope (`mandate.budget_fresh`). Gulf TAP is an inverted band (`mandate.range_fresh`). Matching USD still mints. Matching USDC still mints. Nested children whose envelope is wider than the parent stay `mandate.child_tighter`.

- [x] A TAP (`pnpm demo clash`) funds an $800 hire, refuses `mandate.issue_intent` with amount_range and payment.budget in different currencies as `mandate.currency_fresh` without writing a slip (a vacant slot, a closed coffer, and hire-time currency still allow), then matching USD still mints, matching USDC still mints, and that funded work still releases.
- [x] New first-deny: `mandate.currency_fresh`. Catalog 99 → 100. Protocol stays 0.96.0.

### 182. A closed hatch is not a range

`payment.amount_range` listed `[min,max]`. DESIGN claimed every intent constraint evaluates; max ≤ 0 still minted. That allow at mint was a lie: the slip named a lid no positive hire could enter. Completing funded work is legal. Lid TAP is hire-time max (`payment.amount_range`). Gulf TAP is an inverted band (`mandate.range_fresh`). Vacant TAP is no slots (`mandate.occurrence_fresh`). Coffer TAP is a closed envelope (`mandate.budget_fresh`). Clash TAP is a mixed envelope (`mandate.currency_fresh`). A live lid still mints. An open floor still mints. Nested children whose hatch is closed stay `mandate.lid_fresh`, not `child_tighter`.

- [x] A TAP (`pnpm demo hatch`) funds an $800 hire, refuses `mandate.issue_intent` with amount_range max 0 or an exact zero lid as `mandate.lid_fresh` without writing a slip (a vacant slot, a floor above the lid, and hire-time max still allow), then a live lid still mints, an open floor still mints, and that funded work still releases.
- [x] New first-deny: `mandate.lid_fresh`. Catalog 100 → 101. Protocol stays 0.96.0.

### 183. A cap below the desk is not a cap

`aether.max_autonomy` listed a ceiling. DESIGN claimed every intent constraint evaluates; a cap below the named subject's live rung still minted. Hire-time `ladder.max_autonomy_constraint` evaluates the issuer (founder L0), not the desk. That allow at mint was a lie: the desk can never `hire.create` on that slip. Completing funded work is legal. Ceiling TAP is a climb after mint (`ladder.max_autonomy_constraint`). Grade TAP is a junior nested-slip mint (`ladder.min_level`). Rung TAP is a skipped climb (`ladder.legal`). Cradle TAP is L5 at birth (`ladder.birth_rung`). Hatch TAP is a closed lid (`mandate.lid_fresh`). An exact cap still mints. An open ceiling still mints. Nested children whose cap is below the desk stay `mandate.cap_fresh`, not `child_tighter`. Nested children whose cap is wider than the parent stay `child_tighter` first. Ghost subject stays `identity.known`.

- [x] A TAP (`pnpm demo eave`) funds an $800 hire, refuses `mandate.issue_intent` with `aether.max_autonomy` below the desk's live rung as `mandate.cap_fresh` without writing a slip (a vacant slot, a closed hatch, and hire-time climb still allow), then an exact cap still mints, an open ceiling still mints, and that funded work still releases.
- [x] New first-deny: `mandate.cap_fresh`. Catalog 101 → 102. Protocol stays 0.96.0.

### 184. A grant below the desk is not a handshake

`kya.attest` listed a ceiling. DESIGN claimed omitted `maxAutonomy` is L5 and hire-time `kya.capability_subset` binds spend; a grant below the named delegate's live rung still minted. Hire-time grant ceiling is not required for a human attest. That allow at mint was a lie: a live hop with max 2 on an L3 desk shadows the implicit supervisor L5 grant, and the desk can never `hire.create` under that handshake. Completing funded work is legal. Climb TAP is a climb after mint (`kya.capability_subset`). Spark TAP is a corpse mint (`kya.mint_fresh`). Year TAP is a hop past one year (`kya.mint_window`). Pair TAP is a second live hop (`kya.unique_live`). Eave TAP is a slip cap below the desk (`mandate.cap_fresh`). An exact grant still mints. An open ceiling still mints. Ghost delegate stays `identity.known`. A second live hop stays `kya.unique_live` first. A corpse mint stays `kya.mint_fresh` first. An agent over-grant stays `kya.capability_subset` first.

- [x] A TAP (`pnpm demo sill`) funds an $800 hire, refuses `kya.attest` with `maxAutonomy` below the desk's live rung as `kya.grant_fresh` without writing a hop (a dead handshake, a second live hop, and hire-time climb still allow), then an exact grant still mints, an open ceiling still mints, and that funded work still releases.
- [x] New first-deny: `kya.grant_fresh`. Catalog 102 → 103. Protocol stays 0.96.0.

### 185. A nested grant wider than its parent is not a handshake

`kya.attest` with `parentId` listed a nested hop. DESIGN claimed nesting sits under the parent; a child `maxAutonomy` above the live parent's ceiling still minted. `grantedMaxAutonomy` is the leaf hop, not min along the path. Hire-time `kya.capability_subset` is a climb after mint, not a mint-time nest check. That allow at mint was a lie: a nested hop is not a promotion. Completing funded work is legal. Nest TAP is a dead parent hop (`kya.parent_fresh`). Graft TAP is a missing hop parent (`kya.known_parent`). Sill TAP is a grant below the desk (`kya.grant_fresh`). Climb TAP is a climb after mint (`kya.capability_subset`). Pair TAP is a second live hop (`kya.unique_live`). Sub-hire TAP is a wider nested slip (`mandate.child_tighter`). An exact nested grant still mints. A tighter nested grant still mints. Ghost parent stays `kya.known_parent`. A dead parent stays `kya.parent_fresh` first. A grant below the desk stays `kya.grant_fresh` first. An agent over-grant stays `kya.capability_subset` first.

- [x] A TAP (`pnpm demo joist`) funds an $800 hire, refuses `kya.attest` with `parentId` and `maxAutonomy` above the parent hop as `kya.nest_tighter` without writing a hop (a dead parent hop, a grant below the desk, and a nested slip still allow), then an exact nested grant still mints, a tighter nested grant still mints, and that funded work still releases.
- [x] New first-deny: `kya.nest_tighter`. Catalog 103 → 104. Protocol stays 0.96.0.

### 186. A grant wider than the incoming hop is not a handshake

`kya.attest` in another principal's name listed a hop. DESIGN claimed nesting sits under the parent and hire uses the leaf ceiling; a human intermediary with a live incoming hop could mint `maxAutonomy` above that hop without `parentId`. `kya.required` is false for a human attest, so `kya.capability_subset` never consults the incoming grant. Joist TAP only binds `parentId`. That allow at mint was a lie: a hop in the founder's name is not a promotion. Completing funded work is legal. Well TAP is a same-max human chain (`kya.delegation_depth`). Joist TAP is a nested grant wider than its parent (`kya.nest_tighter`). Sill TAP is a grant below the desk (`kya.grant_fresh`). Climb TAP is a climb after mint (`kya.capability_subset`). Name TAP is whose name a handshake is in (`kya.party`). An exact path grant still mints. A tighter path grant still mints. Speaker granting in their own name is not this deny. Ghost principal stays `identity.known`. A nested grant wider than its parent stays `kya.nest_tighter` first. A grant below the desk stays `kya.grant_fresh` first. An agent over-grant stays `kya.capability_subset` first.

- [x] A TAP (`pnpm demo stud`) funds an $800 hire, refuses `kya.attest` in the founder's name with `maxAutonomy` above the speaker's live incoming hop as `kya.path_tighter` without writing a hop (a nested parent hop, a grant below the desk, and a climb after mint still allow), then an exact path grant still mints, a tighter path grant still mints, and that funded work still releases.
- [x] New first-deny: `kya.path_tighter`. Catalog 104 → 105. Protocol stays 0.96.0.

### 187. An orphan hop is not a handshake

`kya.attest` in another principal's name listed a hop. Stud TAP binds width only when a live incoming path exists; `kya.party` allows any human or treasury to attest in anyone's name. A human with no live path from that principal could mint a hop in the founder's name. Later attesting the speaker under the founder would put a wider leaf on the path — the same promotion Stud closed, sequenced. That allow at mint was a lie: a stud with no plate is not a handshake. Completing funded work is legal. Stud TAP is a grant wider than the incoming hop (`kya.path_tighter`). Joist TAP is a nested grant wider than its parent (`kya.nest_tighter`). Name TAP is whose name a handshake is in (`kya.party`). Well TAP is a same-max human chain (`kya.delegation_depth`). An exact path grant after a live plate still mints. A tighter path grant still mints. Speaker granting in their own name is not this deny. Ghost principal stays `identity.known`. An agent filling in another principal's id stays `kya.party` first. A grant wider than a live incoming hop stays `kya.path_tighter` first. A grant below the desk stays `kya.grant_fresh` first. A dead parentId stays `kya.parent_fresh` first.

- [x] A TAP (`pnpm demo plate`) funds an $800 hire, refuses `kya.attest` in the founder's name with no live incoming hop as `kya.path_live` without writing a hop (a grant wider than the incoming hop, a nested parent hop, and whose name a handshake is in still allow), then an exact path grant still mints, a tighter path grant still mints, and that funded work still releases.
- [x] New first-deny: `kya.path_live`. Catalog 105 → 106. Protocol stays 0.96.0.

### 188. A USDC header under a USD plate is not a nested slip

`mandate.issue_intent` nested under a parent listed a child. `mandate.child_tighter` compares numeric max/floor, lists, recurrence, window, and reference — not currencies. `mandate.currency_fresh` only aligns lid vs coffer on the same slip. A nested USDC range under a USD parent still minted. Hire of USDC research is blocked by `market.sku_currency`; USD hire against a USDC child is `payment.currency_match`. That allow at mint was a lie: a mixed nested slip is not a nested slip. Completing funded work is legal. Clash TAP is a mixed envelope at mint (`mandate.currency_fresh`). Sub-hire TAP is a wider nested slip (`mandate.child_tighter`). Ink TAP is cart vs hire (`payment.currency_match`). Matching USD still mints. Matching USDC still mints. Nested clash stays `mandate.currency_fresh` first. A wider nested child stays `mandate.child_tighter` first. Ghost parent stays `mandate.known_parent` first. Dead parent stays `mandate.parent_fresh` first. A closed hatch stays `mandate.lid_fresh` first.

- [x] A TAP (`pnpm demo header`) funds an $800 hire, refuses `mandate.issue_intent` nested under a parent in a different currency as `mandate.child_currency` without writing a slip (a mixed envelope, a wider nested slip, and hire-time currency still allow), then matching USD still mints, matching USDC still mints, and that funded work still releases.
- [x] New first-deny: `mandate.child_currency`. Catalog 106 → 107. Protocol stays 0.96.0.

### 189. A conversion that pays nothing is not an FX window

`market.quote` of an FX SKU listed a window. `fxPayout(from, rateE6) = floor(from * rateE6 / 1e6)`. A 1-cent quote at the low band (980000) pays 0 USDC. `mm.spread_bound` allows (the rate is in band). `mm.inventory` allows (need ≥ 0). Settle would take the vendor's 1¢ USD and post 0 USDC. Amount 0 at par also pays 0. That allow at mint was a lie: a conversion that pays nothing is not an FX window. Completing funded work is legal. Band TAP is a 200bps miss (`mm.spread_bound`). Born TAP is a dead window (`market.fx_fresh`). Swap TAP is a swapped pair (`market.fx_pair`). Pane TAP is a missing window (`market.fx_window`). Hall TAP is a ghost RFQ (`market.known_rfq`). A two-cent window at the low band still mints. A one-cent window at par still mints. Off-band plus zero payout stays `mm.spread_bound` first. Dead window plus zero payout stays `market.fx_fresh` first. Swapped pair plus zero payout stays `market.fx_pair` first. Missing window stays `market.fx_window` first. Ghost RFQ stays `market.known_rfq` first. A research quote with no `fx` is not this deny.

- [x] A TAP (`pnpm demo pip`) funds an $800 hire, refuses `market.quote` of an FX window whose floor payout is 0 as `market.payout_fresh` without writing a quote (a dead window, a swapped pair, and a 200bps band miss still allow), then a two-cent window at the low band still mints, a one-cent window at par still mints, that two-cent window still converts, and that funded work still releases.
- [x] New first-deny: `market.payout_fresh`. Catalog 107 → 108. Protocol stays 0.96.0.

### 190. A vendor's conversion is not a market-maker window

`market.quote` of an FX SKU listed a window. `data_vendor` and `compute_vendor` may `market.quote` (research). `mm.spread_bound` only runs when `actor.role === "market_maker"`. Settle journals against the market maker's USD/USDC books, regardless of who quoted. An FX RFQ that invites a vendor (or is open) let that vendor mint an in-band FX window; settle drained MM inventory at a rate the MM never offered. Room TAP (`market.invited_seller`) only binds when the vendor is not invited. Band TAP is an MM off-band rate. Pip TAP is a 0 floor payout. Maker TAP is settle with no MM (`mm.known`) — quoting FX with no maker on the pit is not this deny. That allow at mint was a lie: a vendor's conversion is not a market-maker window. Completing funded work is legal. Uninvited vendor stays `market.invited_seller` first. MM off-band stays `mm.spread_bound` first. Vendor 0-payout stays `market.payout_fresh` first. Dead window stays `market.fx_fresh` first. Swapped pair stays `market.fx_pair` first. Missing window stays `market.fx_window` first. Ghost RFQ stays `market.known_rfq` first. A research quote with no `fx` is not this deny.

- [x] A TAP (`pnpm demo quoin`) funds an $800 hire, refuses `market.quote` of an in-band FX window by a vendor while a market maker sits as `market.fx_party` without writing a quote (a closed guest list, a 200bps band miss, and a conversion that pays nothing still allow), then the market maker still mints an in-band window, a par window still mints, that in-band window still converts, and that funded work still releases.
- [x] New first-deny: `market.fx_party`. Catalog 108 → 109. Protocol stays 0.96.0.

### 191. An empty pit does not waive the band

`market.quote` of an FX SKU listed a window. `mm.spread_bound` only runs when `actor.role === "market_maker"`. Quoin TAP (`market.fx_party`) only binds when a maker already sits. Maker TAP lets a vendor mint an in-band FX window when the pit is empty; settle is `mm.known` until a maker sits, then that window converts. A vendor quoting 80000 @ 500000 (half price, payout 40000 > 0) with no maker still minted. After a maker sat, settle drained MM USDC at a rate the maker never offered and that sits outside 980000–1020000. That allow at mint was a lie: an empty pit does not waive the band. Completing funded work is legal. Band TAP is a maker's own off-band quote (`mm.spread_bound`). Quoin TAP is a vendor conversion while a maker sits (`market.fx_party`). Pip TAP is a 0 floor payout (`market.payout_fresh`). Maker TAP's legal path is an in-band vendor mint. Uninvited vendor stays `market.invited_seller` first. MM off-band stays `mm.spread_bound` first. Vendor off-band while a maker sits stays `market.fx_party` first. Vendor 0-payout stays `market.payout_fresh` first. Dead window stays `market.fx_fresh` first. Swapped pair stays `market.fx_pair` first. Missing window stays `market.fx_window` first. Ghost RFQ stays `market.known_rfq` first. An in-band guest quote with no maker still mints.

- [x] A TAP (`pnpm demo ashlar`) funds an $800 hire, refuses `market.quote` of an off-band FX window with no maker as `market.rate_fresh` without writing a quote (a 200bps miss by the maker, a vendor conversion while a maker sits, and a conversion that pays nothing still allow), then the market maker still mints an in-band window after sitting, a par window still mints, that in-band window still converts, and that funded work still releases.
- [x] New first-deny: `market.rate_fresh`. Catalog 109 → 110. Protocol stays 0.96.0.

### 192. A nested hop under another principal is not a nested handshake

`kya.attest` with a live `parentId` listed a nested hop. `kya.nest_tighter` only compares ceilings. `kya.party` allows a human or treasury to attest in their own name. Path walking is principal-scoped (`kya.path` filters `principalId`), and revoke cascade is principal-scoped. A second human (or treasury) could hang `parentId` on the founder's desk hop while minting a hop in their own name. Inspect shows a nested handshake; the graph does not walk or cascade that claim. That allow at mint was a lie: a nested hop under another principal is not a nested handshake. Completing funded work is legal. Joist TAP is a nested grant wider than its parent (`kya.nest_tighter`). Nest TAP is a dead parent hop (`kya.parent_fresh`). Graft TAP is a missing hop parent (`kya.known_parent`). Plate TAP is an orphan hop (`kya.path_live`). Name TAP is whose name a handshake is in (`kya.party`). Sill TAP is a grant below the desk (`kya.grant_fresh`). An exact same-principal nested grant still mints. A tighter same-principal nested grant still mints. Speaker granting in their own name without `parentId` is not this deny. Wider plus foreign parent stays `kya.nest_tighter` first. Dead parent stays `kya.parent_fresh` first. Ghost parent stays `kya.known_parent` first. An orphan hop stays `kya.path_live` first. An agent filling in another principal's id stays `kya.party` first.

- [x] A TAP (`pnpm demo corbel`) funds an $800 hire, refuses `kya.attest` with `parentId` whose principal is not the nested hop's principal as `kya.nest_party` without writing a hop (a nested grant wider than its parent, a dead parent hop, and whose name a handshake is in still allow), then an exact same-principal nested grant still mints, a tighter same-principal nested grant still mints, and that funded work still releases.
- [x] New first-deny: `kya.nest_party`. Catalog 110 → 111. Protocol stays 0.96.0.

### 193. Someone else's checkout is not yours to fill

`mandate.issue_cart` listed a checkout. `hire.unique_cart` only binds when the hire already has a cart. `mandate.cart_party` only binds dump (`revoke_cart`). `mandate.payment_party` only binds spike (`revoke_payment`). Desk B could mint a matching cart on desk A's accepted hire, occupying `hire.unique_cart`, then mint a payment occupying `mandate.unique_payment`. Dump TAP is tearing an unused cart. Spike TAP is tearing an unused payment. Filling is the inverse verb. That allow at mint was a lie: someone else's checkout is not yours to fill. Completing funded work is legal. Ghost hire stays `hire.known`. Ghost cart stays `mandate.known_cart`. A cheaper cart stays `hire.cart_matches`. A second cart stays `hire.unique_cart`. A second payment stays `mandate.unique_payment`. Dump stays `mandate.cart_party`. Spike stays `mandate.payment_party`. Buyer still fills its own checkout. Human/treasury still fill.

- [x] A TAP (`pnpm demo trolley`) funds an $800 hire, refuses `mandate.issue_cart` of a live unused hire by a second procurement desk as `mandate.checkout_party` without writing a cart (a missing cart, dumping someone else's cart, and a second cart still allow), then refuses `mandate.issue_payment` of the buyer's cart as `mandate.checkout_party` without writing a payment, then the buyer still fills its own checkout, and that funded work still releases.
- [x] New first-deny: `mandate.checkout_party`. Catalog 111 → 112. Protocol stays 0.96.0.

### 194. Someone else's room is not yours to hire from

`hire.create` listed a hire. `hire.party` only binds accept/deliver/require/refund/release/void. `mandate.subject_is_actor` only binds fund/submit/subscribe. `market.rfq_party` only binds close. Desk B could `hire.create` on desk A's live unused quote (with desk B's own slip), occupying `hire.quote_unspent`. Fold TAP is tearing a bid. Shut TAP is tearing the room. Hiring is the inverse verb. That allow at mint was a lie: someone else's room is not yours to hire from. Completing funded work is legal. Ghost quote stays `market.known_rfq`. A spent quote stays `hire.quote_unspent`. A shut room stays `market.not_expired`. An FX window stays `hire.not_fx`. Buyer still hires its own quote. Human/treasury still hire.

- [x] A TAP (`pnpm demo poach`) funds an $800 hire, refuses `hire.create` of a live unused quote by a second procurement desk as `hire.room_party` without writing a hire (a missing room, a spent quote, and shutting someone else's room still allow), then the buyer still hires its own quote, and that funded work still releases.
- [x] New first-deny: `hire.room_party`. Catalog 112 → 113. Protocol stays 0.96.0.

### 195. Someone else's unused slip is not yours to hire against

`hire.create` listed a hire. `mandate.subject_is_actor` only binds fund/submit/subscribe. `mandate.party` only binds revoke. `hire.room_party` only binds the RFQ buyer. Desk B could `hire.create` in its own room against desk A's live unused intent, occupying the quote and binding the slip. Rip TAP is tearing the slip. Poach TAP is hiring from someone else's room. Wearing is the inverse verb. That allow at mint was a lie: someone else's unused slip is not yours to hire against. Completing funded work is legal. Ghost intent stays `mandate.known_intent`. A ripped unused slip stays `mandate.not_expired`. A foreign room stays `hire.room_party`. Named subject still hires. Human/treasury still hire.

- [x] A TAP (`pnpm demo guise`) funds an $800 hire, refuses `hire.create` against a live unused intent by a second procurement desk as `hire.slip_party` without writing a hire (a missing slip, a ripped slip, and hiring from someone else's room still allow), then the named subject still hires against its own unused slip, and that funded work still releases.
- [x] New first-deny: `hire.slip_party`. Catalog 113 → 114. Protocol stays 0.96.0.

### 196. Someone else's parent slip is not yours to nest under

`mandate.issue_intent` with `parentId` listed a nested child. `mandate.child_tighter` only compares envelopes. `ladder.min_level` only binds L3. `mandate.party` only binds revoke. An L4 second desk could hang a tighter child under the research desk's live unused parent, then hire against that child and drain `parentSpent`. Grade TAP is a junior nested mint. Header TAP is mixed nested currency. Sub-hire TAP is the parent subject nesting. That allow at mint was a lie: someone else's parent slip is not yours to nest under. Completing funded work is legal. Ghost parent stays `mandate.known_parent`. A dead parent stays `mandate.parent_fresh`. A wider nested child stays `mandate.child_tighter`. A junior nested mint stays `ladder.min_level`. Parent subject still nests. Human/treasury still nest.

- [x] A TAP (`pnpm demo cuckoo`) funds an $800 hire, refuses `mandate.issue_intent` nested under another desk's live unused parent by a second procurement desk as `mandate.child_party` without writing a child (a missing parent, a dead parent, a wider nested slip, and a junior nested mint still allow), then the parent subject still nests a tighter child, and that funded work still releases.
- [x] New first-deny: `mandate.child_party`. Catalog 114 → 115. Protocol stays 0.96.0.

### 197. Someone else's name is not a root slip to mint

`mandate.issue_intent` without `parentId` listed a root slip. `mandate.child_party` only binds nested `parentId`. `ladder.min_level` only binds L3. An L4 second desk could mint a root in another desk's or the founder's name, then that subject could hire against an unbound checkbook no human wrote. Cuckoo TAP is a nested foreign child. Warrant TAP is a self-root. Sub-hire TAP is the parent subject nesting. That allow at mint was a lie: someone else's name is not a root slip to mint. Completing funded work is legal. Ghost subject stays `identity.known`. Nested foreign stays `mandate.child_party`. A junior foreign root stays `ladder.min_level`. A vendor root stays `actor.role_capability`. Named subject still mints a self-root. Human/treasury still mint roots for a desk.

- [x] A TAP (`pnpm demo forge`) funds an $800 hire, refuses `mandate.issue_intent` without `parentId` naming another desk by a second procurement desk as `mandate.root_party` without writing an extra root (a missing subject, a nested child, a junior mint, and a vendor verb still allow), then the named subject still mints a self-root, and that funded work still releases.
- [x] New first-deny: `mandate.root_party`. Catalog 115 → 116. Protocol stays 0.96.0.

### 198. Someone else's conversion window is not yours to settle

`market.fx_settle` listed a conversion. `market.fx_party` only binds minting FX while a maker sits. `market.party` only binds withdraw. `mm.known` only binds a missing maker. `ledger.known_account` only binds a missing dest book. A second data vendor could settle another vendor's live unused FX window after a maker sits, converting the speaker's books and consuming the quote so the seller cannot convert. A maker wash-settling that window is the same refuse. Completing funded work is legal. Maker TAP is settle with no MM (`mm.known`). Wallet TAP is a missing dest book (`ledger.known_account`). Paper TAP is a research quote (`market.fx_quote`). Quoin TAP is minting FX while a maker sits (`market.fx_party`). Fold TAP is tearing a bid (`market.party`). Named seller still converts its own window. A maker's quoted window still converts for a non-maker with books.

- [x] A TAP (`pnpm demo snare`) funds an $800 hire, refuses `market.fx_settle` of another vendor's unused conversion window by a second data vendor as `market.settle_party` without consuming the window (a missing maker, a missing quote, a missing dest book, and a vendor verb still allow), then the named seller still converts its own window, a maker window still converts, and that funded work still releases.
- [x] New first-deny: `market.settle_party`. Catalog 116 → 117. Protocol stays 0.96.0.

### 199. A maker's quote is a window, not a good

`market.quote` listed a maker's quote by SKU-blind role capability. `actor.role_capability` gave `market_maker` the `market.quote` verb but not `hire.accept` or `hire.deliver`. DESIGN says makers quote/sell FX only. So a maker could quote the listed research good, a desk could `hire.create` against it — consuming the quote and occupying the hire — and no verb could ever advance that hire: accept and deliver are role-denied, fund of an unaccepted hire is `hire.state`, the desk's only exit is `hire.void`. That allow at quote was a lie: a maker's quote is a window, not a good. Pane TAP is a windowless FX quote (`market.fx_window`). Quoin TAP is a vendor minting FX while a maker sits (`market.fx_party`). Vendors still quote goods. Makers still quote FX windows, and those windows still convert. Completing funded work is legal. A ghost room stays `market.known_rfq`. A shut room stays `market.not_expired`. An uninvited maker stays `market.invited_seller`.

- [x] A TAP (`pnpm demo hawk`) funds an $800 hire, refuses `market.quote` of the listed research good by a market maker as `mm.fx_only` without writing a quote (a ghost room, a shut room, an uninvited maker, and a windowless FX quote still allow first-deny elsewhere), then the research vendor still quotes the good, the maker still quotes an FX window, that window still converts, and that funded work still releases.
- [x] New first-deny: `mm.fx_only`. Catalog 117 → 118. Protocol stays 0.96.0.

### 200. A tombstone is not a second tombstone

`kya.revoke` of an already-revoked handshake was an allow that mutated nothing and still wrote a `KYA_REVOKE` notary line with zero subjects. `DelegationGraph.revoke` skips revoked hops, so a second revoke by id tombstoned nothing, blocked nothing new, and yet the audit book said a revoke happened after yes. Same for a pair-wide revoke of an already-blocked pair with nothing left to tombstone, and for a revoke naming neither a handshake nor a delegate. The catalog's own precedents deny every other double kill: a second `mandate.revoke` is `mandate.not_expired`, a no-op freeze is `identity.freeze_state`. Seal TAP is a ghost handshake (`kya.known_attestation`). Name TAP is whose name a handshake is in (`kya.party`). A first pair-wide revoke still blocks implicit grants even with no explicit hop. Revoking an expired unrevoked hop still tombstones — it still occupies `kya.unique_live`. Re-attest, then revoke, still writes a fresh tombstone.

- [x] A TAP (`pnpm demo tomb`) funds an $800 hire, writes a first tombstone, refuses the second revoke by id, the pair-wide revoke of the blocked pair, and the bare revoke as `kya.revoke_state` (a ghost handshake stays `kya.known_attestation`, a ghost agent stays `identity.known`, someone else's name stays `kya.party`; no `KYA_REVOKE` line written), then the founder still re-attests and revokes the fresh hop, a first pair-wide revoke of a never-attested pair still blocks, and that funded work still releases.
- [x] New first-deny: `kya.revoke_state`. Catalog 118 → 119. Protocol stays 0.96.0.

### 201. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays. Do not re-TAP tomb/grave/crypt/hawk/peddle/tout/snare/gin/wire/forge/fake/dummy/cuckoo/brood/changeling/guise/mask/cloak/poach/raid/snatch/trolley/basket/buggy/corbel/springer/haunch/ashlar/voussoir/impost/quoin/pier/plinth/pip/tick/basis/header/cripple/king/plate/sole/shoe/stud/noggin/dwang/joist/strut/brace/sill/ledge/lintel/eave/ridge/gable/hatch/flap/cork/clash/jolt/snag/coffer/vault/pouch/gulf/rift/span/week/tide/cycle/spike/ditch/junk/dump/chuck/toss/shut/clap/gavel/rip/fold/void/lock/cite/well.

- [ ] Next turn: if a listed face is missing from the bus, or a current allow is a lie, patch it. If not, take a missing demonstrated economic object rather than a website.

## Hard constraints (every turn)

Tests + `pnpm demo` + `pnpm demo night-watch` + `pnpm demo sub-hire` + `pnpm demo clearing` + `pnpm demo refund` + `pnpm demo replay` + `pnpm demo nonce` + `pnpm demo deny` + `pnpm demo recurrence` + `pnpm demo calendar` + `pnpm demo slot` + `pnpm demo daily` + `pnpm demo cart` + `pnpm demo velocity` + `pnpm demo door` + `pnpm demo match` + `pnpm demo room` + `pnpm demo conversion` + `pnpm demo pair` + `pnpm demo band` + `pnpm demo nest` + `pnpm demo heir` + `pnpm demo stock` + `pnpm demo purse` + `pnpm demo seat` + `pnpm demo cover` + `pnpm demo mint` + `pnpm demo payee` + `pnpm demo climb` + `pnpm demo born` + `pnpm demo reach` + `pnpm demo year` + `pnpm demo fuse` + `pnpm demo sku` + `pnpm demo priced` + `pnpm demo party` + `pnpm demo cash` + `pnpm demo stale` + `pnpm demo chain` + `pnpm demo arrow` + `pnpm demo wallet` + `pnpm demo name` + `pnpm demo pane` + `pnpm demo subject` + `pnpm demo paper` + `pnpm demo mix` + `pnpm demo rung` + `pnpm demo grade` + `pnpm demo cradle` + `pnpm demo ceiling` + `pnpm demo lapse` + `pnpm demo pause` + `pnpm demo mirror` + `pnpm demo warrant` + `pnpm demo vacant` + `pnpm demo badge` + `pnpm demo lid` + `pnpm demo bare` + `pnpm demo shelf` + `pnpm demo hall` + `pnpm demo writ` + `pnpm demo crate` + `pnpm demo pact` + `pnpm demo root` + `pnpm demo docket` + `pnpm demo graft` + `pnpm demo seal` + `pnpm demo guest` + `pnpm demo dust` + `pnpm demo thaw` + `pnpm demo twin` + `pnpm demo fence` + `pnpm demo mute` + `pnpm demo nil` + `pnpm demo spark` + `pnpm demo wilt` + `pnpm demo maker` + `pnpm demo ink` + `pnpm demo brim` + `pnpm demo swap` + `pnpm demo sour` + `pnpm demo cut` + `pnpm demo ice` + `pnpm demo rail` + `pnpm demo pen` + `pnpm demo well` + `pnpm demo cite` + `pnpm demo lock` + `pnpm demo void` + `pnpm demo fold` + `pnpm demo rip` + `pnpm demo shut` + `pnpm demo dump` + `pnpm demo spike` + `pnpm demo week` + `pnpm demo gulf` + `pnpm demo coffer` + `pnpm demo clash` + `pnpm demo hatch` + `pnpm demo eave` + `pnpm demo sill` + `pnpm demo joist` + `pnpm demo stud` + `pnpm demo plate` + `pnpm demo header` + `pnpm demo pip` + `pnpm demo quoin` + `pnpm demo ashlar` + `pnpm demo corbel` + `pnpm demo trolley` + `pnpm demo poach` + `pnpm demo guise` + `pnpm demo cuckoo` + `pnpm demo forge` + `pnpm demo snare` + `pnpm demo hawk` + `pnpm demo tomb`. Commit, push, open a new PR off `main`. Short high-level update. Keep the iterate timer alive; do not remove it.
