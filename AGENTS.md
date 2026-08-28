# AGENTS.md — how another agent uses Aether

Aether is an economic runtime for software agents. Humans write permission. Agents hire and pay. A deterministic policy kernel says `allow`, `deny`, or `escalate`. An append-only audit log records every decision. There is no live bank or chain. Rail: `sim:aether-1`. Money: integer minor units (`USD_SIM`, `USDC_SIM`).

Do not put an LLM in `evaluate()`. Do not skip rungs. L5 is not god mode.

## Speak to it

```
pnpm mcp                 # stdio MCP (Content-Length JSON-RPC)
POST /v1/*               # same commands over HTTP
POST /v1/demo/sub-hire   # nested-slip TAP on this runtime
```

Every mutating verb is a `Command`: `{ type, actorId, body }`. HTTP, CLI, and MCP construct that object and call `Runtime.dispatch`. Policy runs first. Deny never mutates.

MCP tools map 1:1 onto `CommandType` plus:

- `aether_snapshot` / resource `aether://snapshot`
- `aether_reset`
- `aether_demo_sprint` | `aether_demo_night_watch` | `aether_demo_sub_hire`

Pass `actor` as a runtime alias (`ops-human`, `desk`, `scout`) after register.

## Invariants the kernel will enforce

1. Integer cents only. Canonical JSON (sorted keys) is what is hashed.
2. Intent → Cart → Payment chain must verify on settle (`hire.fund`, `envelope.submit`).
3. 34 ordered policy rules always all run. Any deny wins. Else any escalate. Else allow.
4. KYA: spend requires a live path from the intent issuer (or implicit supervisor). Revoke is a tombstone; implicit grants die with it. Depth ≤ 3.
5. Sub-intents (`parentId`) must be tighter than the parent. Child spend counts against the parent budget.
6. Budget and daily circuit are consumed at **fund**, not again at deliver/submit.
7. Freeze sets L0. Unfreeze restores the prior rung. `any → L0` is always legal. Skipping rungs is not.
8. Auditor can `audit.verify` and freeze. Auditor cannot spend.
9. Receipt.reference === sha256(JCS(payment mandate)).

## Autonomy

| L | May |
|---|---|
| 0 | Draft. Human signs. |
| 1 | Prepare. Human confirms each cart. |
| 2 | Close a payment that still fits an open intent. |
| 3 | Hire a vendor against an existing intent. |
| 4 | Issue a **sub-intent** (smaller slip) to another agent. |
| 5 | Standing mandate. Skips per-tx humans. Does not skip caps, fuse, freeze, KYA, nonce. |

## What this is not

A trading bot. A storefront. A wallet. A copied AP2/x402 SDK. Live rails belong later as adapters on these objects.

## Proofs

```
pnpm test
pnpm demo
pnpm demo night-watch
pnpm demo sub-hire
```
