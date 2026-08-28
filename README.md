# Aether — Agent Economic Runtime

**Thesis:** Payments protocols move money. Aether decides whether money *should* move.

This repository is a machine-first economic operating system for software agents. It runs **today** on a simulated ledger (`sim:aether-1`) with no bank, card, or chain credentials. The object model is shaped to sit *above* AP2 (mandates), x402/MPP (HTTP settlement envelopes), ACP/UCP (checkout), and TAP/KYA (identity issuers) when those rails are ready.

It is not a trading bot, not a checkout clone, and not a wallet.

```
Human issues Intent (constraints)
        │
        ▼
 Agent RFQs vendors ──► Quotes
        │
        ▼
 Hire + Cart (merchant-bound) ──► PolicyEngine
        │                     deny → stop + structured trace
        │                     escalate → ApprovalTicket
        ▼                     allow
 PaymentMandate (hash-bound to cart)
        │
        ▼
 x402-shaped envelopes on sim:aether-1
        │
        ▼
 Balanced journal + escrow release
        │
        ▼
 Receipt.reference = sha256(payment)     audit.jsonl hash-chain += n
        │
        ▼
 Auditor verifies the chain and cannot spend
```

## Why this exists

2025–2026 produced a **layered payments stack**, not an economy:

| Layer | What it is | What it is not |
|---|---|---|
| AP2 / Verifiable Intent | Cryptographic *authorization* (mandates) | Settlement, credit, hiring, policy kernel |
| x402 / MPP | HTTP-native *settlement* | Consent, KYA graph, netting |
| ACP / UCP | Agent ↔ merchant *checkout* | Agent ↔ agent jobs, treasury, FX |
| TAP / Skyfire KYA / ERC-8004 | “Is this agent real?” | Capability envelopes + revocation graph |
| A2A / MCP | How agents talk and use tools | Money |

The missing layer is the one that still matters when agents actually run parts of the economy: **identity → mandate → policy decision → quote/match → escrow → settlement instruction → receipt → replayable audit**, with an autonomy ladder from human-in-the-loop to human-out-of-the-loop.

Read [`docs/THESIS.md`](docs/THESIS.md) for the market map. [`DESIGN.md`](DESIGN.md) is the implementation contract.

## Quick start

```bash
pnpm install
pnpm test
pnpm demo
pnpm dev          # control room at http://127.0.0.1:8787
```

`pnpm demo` runs **Sprint Procurement**: seven agents (ops human, treasury, procurement, data vendor, compute vendor, market maker, auditor) hire and pay each other, hit a hard `$5,000` amount-range wall, escalate a `$6,400` compute hire to treasury, settle with receipts bound to payment hashes, convert USD_SIM → USDC_SIM inside a 200 bps FX window, then prove the auditor cannot spend.

## Autonomy ladder

| Level | Meaning |
|---|---|
| L0 | Human executes. Agent drafts. |
| L1 | Human approves each cart. |
| L2 | Agent closes payments that satisfy an open intent. |
| L3 | Budget-auto. May hire vendors against an existing intent. |
| L4 | May issue sub-intents (delegate budget). |
| L5 | Standing mandate. Humans hold the kill switch and circuit breakers — not “god mode.” |

Skipping rungs is illegal. `any → L0` is always allowed (freeze / demote).

## Repository map

| Path | Role |
|---|---|
| `packages/aether-policy` | 26 ordered rules. Pure. No LLM. No I/O. |
| `packages/aether-runtime` | Command bus: snapshot → evaluate → audit → mutate |
| `packages/aether-audit` | Hash-chained append-only log (`aether-audit-v1`) |
| `packages/aether-ledger` | Double-entry, integer minor units |
| `packages/aether-mandate` | AP2-*shaped* Intent → Cart → Payment chain |
| `packages/aether-envelope` | x402-*shaped* PAYMENT-* headers |
| `apps/cli` | `pnpm demo` |
| `apps/runtime-http` | OpenAPI-ish HTTP + control room |
| `packages/aether-mcp` | MCP tool face of the same commands |
| `fixtures/demo/sprint-procurement` | TAP assertions |

Amounts are **integer minor units**. Never IEEE floats. Canonical JSON is an RFC 8785 subset; that bytestring is what we hash.

## What we will not add

Live rails in v0. An order book. A storefront. Copied AP2/x402 SDKs. An LLM inside `evaluate()`. Silent re-spend retries. Mutable history.

Adapters for real x402, MPP, AP2, TAP, and ACK belong in a later revision that keeps this kernel.

## License

Apache-2.0
