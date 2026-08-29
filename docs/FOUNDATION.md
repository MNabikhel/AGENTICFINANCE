# Foundation backlog (10-day stretch)

Montaz is out until about **2026-09-07**. He asked for a planning phase, then autonomous building of the agent economic kernel — not the same inspect overlay again. This file is the queue. Check a box when tests + the TAP demos pass and the work is on the PR.

## What we are building

Aether is the missing layer above the 2026 payments stack: **permission → referee → hire → escrow → receipt → replay**. Other agents should be able to run an economy on this kernel without a website, a token, a live bank, or an LLM in `evaluate()`.

Public pin stays `aether.protocol.1` / `0.96.0` until the pin would otherwise lie. `PROTOCOL.hosted` stays false. `WORLD_VERSION` stays 1. Catalog stays 87 rules unless a new first-deny is required.

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

`mandate.window_reach` already binds `mandate.issue_intent` when `not_before` is at or after the slip's seven-day exp. Completing funded work is legal. Calendar TAP is `payment.execution_date` on hire. A closed calendar at mint stays `mandate.window_fresh`.

- [x] A TAP (`pnpm demo reach`) funds an $800 hire on a live slip, refuses `mandate.issue_intent` whose window opens after the slip dies as `mandate.window_reach` without writing a slip (a closed calendar still allows), then a reachable future still mints and that funded work still releases.
- [x] No new policy rule unless a current allow is a calendar that never overlaps the slip, or a current deny traps funded work.

### 56. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [x] CommandType stays 1:1 with MCP. OpenAPI lists command aliases and the TAP demos the discovery card names. GET `/v1/agents/{id}` and GET `/v1/approvals/{id}` are inspect, not command faces — do not grind them. A handshake that outlives one year was policy, not a TAP.

### 57. A handshake cannot outlive one year

`kya.mint_window` already binds `kya.attest` when `expiresAt` is after now + one year. Completing funded work is legal. Pair TAP is `kya.unique_live`. A corpse mint stays `kya.mint_fresh`. Omit `expiresAt` is the one-year ceiling.

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

`market.fx_window` already binds `market.quote` when a listed FX SKU has no `fx` window. Completing funded work is legal. Conversion TAP is hiring the window (`hire.not_fx`). Born TAP is a corpse mint (`market.fx_fresh`). Pair TAP is a swapped pair (`market.fx_pair`). Shelf TAP is a ghost SKU.

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

`approval.pending` already binds resolve when the ticket is expired or already resolved. Completing funded work is legal. Velocity TAP is a hot hour (`velocity.window`). Deny TAP is a cached no. Replay TAP is a retry of an allow. A stale pause whose held command would not allow stays `approval.replay`.

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

`approval.known` already binds `approval.resolve` when the ticket is not in this world. Completing funded work is legal. Pause TAP is a dead ticket (`approval.pending`). Replay TAP is a retry of an allow (`approval.replay`). Velocity TAP is a hot hour (`velocity.window`). Root TAP is a ghost parent (`mandate.known_parent`).

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

### 128. Next: only if the pin would lie

If an allow, a listed HTTP/MCP face, or the protocol card would lie, patch it. Do not mint 0.97 unless the pin would otherwise lie. Do not grind inspect overlays.

- [ ] Next turn: if a listed face is missing from the bus, or a current allow is a lie, patch it. If not, take a missing demonstrated economic object rather than a website.

## Hard constraints (every turn)

Tests + `pnpm demo` + `pnpm demo night-watch` + `pnpm demo sub-hire` + `pnpm demo clearing` + `pnpm demo refund` + `pnpm demo replay` + `pnpm demo nonce` + `pnpm demo deny` + `pnpm demo recurrence` + `pnpm demo calendar` + `pnpm demo slot` + `pnpm demo daily` + `pnpm demo cart` + `pnpm demo velocity` + `pnpm demo door` + `pnpm demo match` + `pnpm demo room` + `pnpm demo conversion` + `pnpm demo pair` + `pnpm demo band` + `pnpm demo nest` + `pnpm demo heir` + `pnpm demo stock` + `pnpm demo purse` + `pnpm demo seat` + `pnpm demo cover` + `pnpm demo mint` + `pnpm demo payee` + `pnpm demo climb` + `pnpm demo born` + `pnpm demo reach` + `pnpm demo year` + `pnpm demo fuse` + `pnpm demo sku` + `pnpm demo priced` + `pnpm demo party` + `pnpm demo cash` + `pnpm demo stale` + `pnpm demo chain` + `pnpm demo arrow` + `pnpm demo wallet` + `pnpm demo name` + `pnpm demo pane` + `pnpm demo subject` + `pnpm demo paper` + `pnpm demo mix` + `pnpm demo rung` + `pnpm demo grade` + `pnpm demo cradle` + `pnpm demo ceiling` + `pnpm demo lapse` + `pnpm demo pause` + `pnpm demo mirror` + `pnpm demo warrant` + `pnpm demo vacant` + `pnpm demo badge` + `pnpm demo lid` + `pnpm demo bare` + `pnpm demo shelf` + `pnpm demo hall` + `pnpm demo writ` + `pnpm demo crate` + `pnpm demo pact` + `pnpm demo root` + `pnpm demo docket` + `pnpm demo graft` + `pnpm demo seal`. Commit, push, update PR #4 (`cursor/aether-economic-runtime-d9b6`). Short high-level update. Keep the iterate timer alive; do not remove it.
