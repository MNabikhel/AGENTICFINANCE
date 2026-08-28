# AGENTS.md — how another agent uses Aether

Aether is an economic runtime for software agents. Humans write permission. Agents hire and pay. A deterministic policy kernel says `allow`, `deny`, or `escalate`. An append-only audit log records every decision. There is no live bank or chain. Rail: `sim:aether-1`. Money: integer minor units (`USD_SIM`, `USDC_SIM`).

Pin `aether.protocol.1` (`GET /v1/protocol`, resource `aether://protocol`, tool `aether_protocol`). `liveMoney` is `false` until adapters exist. Current card: `0.35.0`.

Do not put an LLM in `evaluate()`. Do not skip rungs. L5 is not god mode.

## There is no finish date

This is a kernel. You extend it. Public protocol and live money are different switches.

- **Public (now):** other agents speak MCP/HTTP, pin the spec, run a durable sim (`AETHER_DATA_DIR`). The GitHub repo being public is a human visibility switch, not a runtime switch.
- **Live money (later):** adapters on these objects (x402 / MPP / AP2 / TAP) plus credentials that never enter `evaluate()`. Until then `instrument.sim_only` denies anything else.

## Speak to it

```
pnpm mcp                 # stdio MCP (Content-Length JSON-RPC)
POST /v1/*               # same commands over HTTP
GET  /v1/protocol        # pin-able card
AETHER_DATA_DIR=./data pnpm mcp   # durable world.json + audit.jsonl
```

Every mutating verb is a `Command`: `{ type, actorId, body, idempotencyKey? }`. HTTP, CLI, and MCP construct that object and call `Runtime.dispatch`. Policy runs first. Deny never mutates. A deny includes a typed `remediation` (`kind` is for machines). Money-moving allows are replayed by key so a retry cannot double-spend. Denies are never cached.

MCP tools map 1:1 onto `CommandType` plus:

- `aether_snapshot` / resource `aether://snapshot`
- `aether_get` `{ id }` — one hire, mandate, agent, receipt, ticket, quote… by id or alias. Also `GET /v1/objects/:id`.
- `aether_protocol` / resource `aether://protocol`
- `aether://commands` — JSON Schema for every command body
- `aether_market_catalog` / `GET /v1/catalog` — SKUs that may be hired
- `aether_audit_query` / `GET /v1/audit?subject=` — notary lines for one id
- `aether_reset` (wipes `AETHER_DATA_DIR` if set)
- `aether_demo_sprint` | `aether_demo_night_watch` | `aether_demo_sub_hire`

`tools/list` inputSchema lists the body fields the kernel reads. Do not guess.

Pass `actor` as a runtime alias (`ops-human`, `desk`, `scout`) after register.

## Invariants the kernel will enforce

1. Integer cents only. Canonical JSON (sorted keys) is what is hashed.
2. Intent → Cart → Payment chain must verify on settle (`hire.fund`, `envelope.submit`).
3. 57 ordered policy rules always all run. Any deny wins. Else any escalate. Else allow.
4. KYA: spend requires a live path from the intent issuer (or implicit supervisor). Revoke is a tombstone; implicit grants die with it. Depth ≤ 3.
5. Sub-intents (`parentId`) must be tighter than the parent. Child spend counts against the parent budget.
6. Budget and daily circuit are consumed at **fund**, not again at deliver/submit.
7. Freeze sets L0. Unfreeze restores the prior rung. `any → L0` is always legal. Skipping rungs is `ladder.legal`, not a mutate throw after an allow. Listing L5 gate names is not the freeze test.
8. Auditor can `audit.verify` and freeze. Auditor cannot spend.
9. Receipt.reference === sha256(JCS(payment mandate)).
10. Durable boot: `world.json` and `audit.jsonl` must agree on length. Mismatch is a refuse, not a guess.
11. `clearing.settle_window` archives net exposure. It is not a second payment. Money already moved at escrow.
12. Idempotency: same key (or auto-hash of a money-moving command) + prior **allow/escalate** = replay, no second mutation, no extra clock step, no extra audit. **Denies are not cached.** Unfreeze / new intent / circuit reset must be retryable with the same body. Approval replay (`thresholdWaived`) bypasses the lookup so the books can actually change.
13. `PolicyDecision.remediation.kind` is a machine enum (`issue_intent`, `wait_approval`, `attest_kya`, `unfreeze_actor`, `unfreeze_principal`, `reset_circuit`, `role_forbidden`, `none`). Do not parse English `hint`.
14. `hire.refund` is legal only from `funded` (not after deliver/release) — that is `hire.state`. It reverses escrow, restores `spentByIntent` along the parent chain, and reverse-records clearing. The daily circuit stays sticky.
15. `SIM_RAIL.live === false`. Live adapters implement that shape. They do not enter `evaluate()`.
16. Approval tickets expire (`approval.pending`). Resolving an expired or already-resolved ticket is a policy deny, not a late yes. The original command may be retried (new ticket) if it is still legal.
17. Only catalog SKUs may be RFQ’d or hired (`market.catalog`). Stale quotes/RFQs cannot be hired (`market.not_expired`).
18. `audit.query` reads notary lines for one subject. It does not mutate. Verify is a separate command.
19. Non-empty `invitedSellerIds` is a closed RFQ (`market.invited_seller`). Empty or omitted is open; any listed seller role may quote.
20. Missing required body fields, non-integer cents, a non-sim currency, a listed enum miss (role, decision, issuer kind, clearing currency), or an integer outside its schema range (ladder rung, autonomy) are `command.malformed` (HTTP 400). That is syntax, not policy. The clock does not step. The notary does not write. `evaluate()` does not run.
21. `payment.agent_recurrence` binds. `max_occurrences` and the frequency gap are checked on `hire.create` and `hire.fund`. Completing a funded hire is not a new occurrence. A refund does not restore a slot. Child slips may not be more frequent than the parent.
22. A cart bound to a hire must match it (`hire.cart_matches`): same seller, same SKU, same integer cents. Escrow moves the hire price. A cheaper cart is not a discount.
23. `payment.execution_date` binds on new spends (`hire.create`, `hire.fund`). Completing a funded hire after `not_after` is legal. Child windows may not outlive the parent.
24. Quoting or hiring against an unknown RFQ or quote is `market.known_rfq`. It is not a missing SKU. SKU, expiry, and invite flags are only set once the room exists.
25. An FX quote is a one-shot window (`market.fx_quote`). Settling a missing quote, a non-FX quote, a spent quote, or a quote held by an open hire ticket is a policy deny, not a mutate throw after an allow. A retry of the same command still replays.
26. A hire quote is used once (`hire.quote_unspent`). The same set is consumed by `hire.create` and `market.fx_settle`. A deny does not consume it. An escalate reserves it until the ticket is approved, rejected, or expired. A void or refund does not restore it.
27. A hireId that is not in this world is `hire.known`. It is not a broken mandate chain. Policy denies; mutate does not throw after an allow.
28. An intentId that is not in this world is `mandate.known_intent`. It is not a missing handshake. A deny does not consume the quote.
29. A cartId that is not in this world is `mandate.known_cart`. It is not a broken payment chain.
30. An approvalId that is not in this world is `approval.known`. It is not a late yes. Policy denies; mutate does not throw after an allow.
31. Accept, deliver, and payment-required belong to the seller. Refund and release belong to the buyer or treasury (`hire.party`). The other side of the table is a policy deny, not a mutate throw.
32. A parentId that is not in this world is `mandate.known_parent`. It is not a tighter child. Policy denies; mutate does not write a ghost parent.
33. An agentId that is not in this world is `identity.known`. Freeze, unfreeze, ladder, handshake (delegate *and* principal), revoke, cart merchant, and intent subject do not throw after an allow, and do not write a handshake or tombstone for nobody.
34. An illegal hire arrow is `hire.state`. Second accept, fund from offered, refund after deliver, release before deliver, and payment-required before deliver are policy denies, not a 409 or 402 after an allow. Refund is only from funded. Payment-required is only after deliver. The escrow table still throws if policy ever lies.
35. An illegal ladder climb is `ladder.legal`. Skipping rungs, omitting a gate, listing `kill_switch_tested` without actually freezing, or the wrong approver are policy denies, not a mutate throw. `any→L0` stays legal.
36. Attesting yourself is `kya.not_self`. A handshake is with another agent. The graph still throws if policy ever lies.
37. A KYA `parentId` that is not in this world is `kya.known_parent`. It is not a live nested handshake. Policy denies; mutate does not mint a hop under a ghost parent. This flag is not `mandate.known_parent`.
38. An account name that is not in this world is `ledger.known_account`. Treasury cannot allocate through a missing book. A named balance of a missing book is not a zero. An FX settle without a USDC book is a missing book, not a journal throw. Policy denies; mutate does not throw after an allow.
39. One journal is one currency (`ledger.same_currency`). USD_SIM and USDC_SIM do not mix in a transfer, and the stated amount must match the books. Convert with `market.fx_settle`.
40. A transfer cannot overdraw the source book (`ledger.sufficient`). Neither can `hire.fund` or `market.fx_settle` (the vendor’s USD leg). Draining to zero is legal. Negative cash is not. Escrow cannot lock on empty operating cash. MM USDC inventory is `mm.inventory`.
41. A KYA `attestationId` that is not in this world (or that belongs to another principal) is `kya.known_attestation`. It is not a silent tombstone. Revoke by principal+delegate with no id still kills implicit grants. Policy denies; mutate does not write `KYA_REVOKE` for a ghost or foreign handshake.

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
