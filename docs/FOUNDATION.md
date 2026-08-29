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

- [ ] Next turn: if a listed face is missing from the bus, or a current allow is a lie, patch it. If not, take a missing demonstrated economic object rather than a website.

## Hard constraints (every turn)

Tests + `pnpm demo` + `pnpm demo night-watch` + `pnpm demo sub-hire` + `pnpm demo clearing` + `pnpm demo refund` + `pnpm demo replay` + `pnpm demo nonce` + `pnpm demo deny` + `pnpm demo recurrence` + `pnpm demo calendar` + `pnpm demo slot` + `pnpm demo daily` + `pnpm demo cart` + `pnpm demo velocity` + `pnpm demo door` + `pnpm demo match` + `pnpm demo room` + `pnpm demo conversion` + `pnpm demo pair` + `pnpm demo band`. Commit, push, update PR #4 (`cursor/aether-economic-runtime-d9b6`). Short high-level update. Keep the iterate timer alive; do not remove it.
