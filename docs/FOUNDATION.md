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

`idempotency.nonce` binds `envelope.submit`. A leftover `nonce` on a transfer is not a settled payment. The TAP demos submit once; they never show reuse.

- [ ] A TAP (`pnpm demo nonce`) completes a funded hire’s envelope, retries the same nonce, and shows `idempotency.nonce`. A leftover nonce on `ledger.transfer` is not that deny.
- [ ] No new policy rule unless a current allow is a second release.

## Hard constraints (every turn)

Tests + `pnpm demo` + `pnpm demo night-watch` + `pnpm demo sub-hire` + `pnpm demo clearing` + `pnpm demo refund` + `pnpm demo replay`. Commit, push, update PR #4 (`cursor/aether-economic-runtime-d9b6`). Short high-level update. Keep the iterate timer alive; do not remove it.
