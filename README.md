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
pnpm mcp                  # stdio MCP — this is the agent face
AETHER_DATA_DIR=./data pnpm mcp   # same, but the economy survives restart
```

**Sprint Procurement:** seven agents, a $5,000 per-item cap, an $800 data buy that is allowed, a $6,400 compute buy that is refused, a new slip plus treasury sign-off, receipts bound to payment hashes, a 0.2% FX window, and an auditor who cannot spend.

**Night Watch:** a founder shakes hands with an overnight agent (Know Your Agent), climbs it to L5 after testing the freeze, lets it buy $200 and $6,000 without waking treasury, stops a $9,000 overpay, blows a sticky daily fuse, freezes the founder (the agent still cannot spend), then revokes the handshake. L5 is not god mode.

**Sub-hire:** a desk at L4 issues a tighter child slip to a scout. The scout hires a vendor for $800. A $2,500 hire is refused by the child cap. Spend counts against the parent budget. Revoking the desk→scout handshake stops the scout without deleting it.

There is no finish date. Public protocol (`aether.protocol.1` v0.27.0, `liveMoney: false`) is what other agents pin. Live bank/chain rails are adapters on these objects, later. A durable world (`AETHER_DATA_DIR`) is what you host. Retries of money-moving commands replay; a deny comes with a typed next step; funded escrow can be unwound. Fetch one object with `aether_get` / `GET /v1/objects/:id`. Command bodies are in `schemas/commands.schema.json` and required fields are enforced at dispatch. Money is integer cents at the bus, not later. The SKU catalog is what may be hired; stale quotes cannot; an RFQ invite list is binding; a missing RFQ is a missing room, not a missing SKU; a quote settles or hires once; an open approval holds the quote; a missing hire is a missing contract, not a broken chain; a missing intent is a missing slip, not a missing handshake; a missing cart is a missing cart, not a broken chain; a missing ticket is a missing ticket, not a late yes; accept and deliver belong to the seller; a missing parent is a missing parent, not a tighter child; a missing agent is a missing agent, not a freeze; an illegal hire arrow is a refuse, not a 409 after yes; payment-required is only after deliver; a skipped rung is a refuse, not a 409 after yes; you cannot attest yourself; a missing KYA parent is a missing parent, not a live nested handshake; recurrence frequency is not decoration; a cart must equal the hire it pays; a closed calendar window does not freeze funded work.

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
| `packages/aether-policy` | Referee. 49 ordered rules. No LLM. No I/O. |
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
