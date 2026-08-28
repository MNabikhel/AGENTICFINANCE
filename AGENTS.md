# AGENTS.md — how another agent uses Aether

Aether is an economic runtime for software agents. Humans write permission. Agents hire and pay. A deterministic policy kernel says `allow`, `deny`, or `escalate`. An append-only audit log records every decision. There is no live bank or chain. Rail: `sim:aether-1`. Money: integer minor units (`USD_SIM`, `USDC_SIM`).

Pin `aether.protocol.1` (`GET /v1/protocol`, resource `aether://protocol`, tool `aether_protocol`). `liveMoney` is `false` until adapters exist. Current card: `0.50.0`.

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

1. Integer cents only. Safe integers only. Canonical JSON (sorted keys) is what is hashed. One cart is one currency.
2. Intent → Cart → Payment chain must verify on settle (`hire.fund`, `envelope.submit`).
3. 67 ordered policy rules always all run. Any deny wins. Else any escalate. Else allow.
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
17. Only catalog SKUs may be RFQ’d or hired (`market.catalog`). A listed SKU may only be priced in a currency the catalog names (`market.sku_currency`). Stale quotes/RFQs cannot be hired (`market.not_expired`).
18. `audit.query` reads notary lines for one subject. It does not mutate. Verify is a separate command.
19. Non-empty `invitedSellerIds` is a closed RFQ (`market.invited_seller`). Empty or omitted is open; any listed seller role may quote.
20. Missing required body fields, non-integer cents, an unsafe integer, a non-sim currency, mixed currencies in one cart, a cart line whose cents overflow, a listed enum miss (role, decision, issuer kind, clearing currency), an integer outside its schema range (ladder rung, autonomy), a listed field with the wrong JSON type (a number where a string id belongs, a string where an array belongs), a nested cart line / intent constraint missing its fields, an unknown constraint type, a listed constraint missing its value fields (an `amount_range` without `max`), or an FX window missing from/to/rateE6/validUntil are `command.malformed` (HTTP 400). That is syntax, not policy. The clock does not step. The notary does not write. `evaluate()` does not run.
21. `payment.agent_recurrence` binds. `max_occurrences` and the frequency gap are checked on `hire.create` and `hire.fund`. Completing a funded hire is not a new occurrence. A refund does not restore a slot. Child slips may not be more frequent than the parent.
22. A cart bound to a hire must match it (`hire.cart_matches`): same seller, same SKU, same integer cents. Escrow moves the hire price. A cheaper cart is not a discount. A hire takes one cart (`hire.unique_cart`). A second cart is not a pointer swap. A cart takes one payment (`mandate.unique_payment`). A second payment is not a second check.
23. `payment.execution_date` binds on new spends (`hire.create`, `hire.fund`). Completing a funded hire after `not_after` is legal. Child windows may not outlive the parent.
24. Quoting or hiring against an unknown RFQ or quote is `market.known_rfq`. It is not a missing SKU. SKU, expiry, and invite flags are only set once the room exists.
25. An FX quote is a one-shot window (`market.fx_quote`). Settling a missing quote, a non-FX quote, a spent quote, or a quote held by an open hire ticket is a policy deny, not a mutate throw after an allow. A retry of the same command still replays. The 200bps band (`mm.spread_bound`) binds the nested `fx.rateE6` that is stored and settled — a decoy top-level `rateE6` does not. This rail’s window is USD_SIM → USDC_SIM with the price in `from` (`market.fx_pair`). An FX object on a research SKU is not a dual-use quote.
26. A hire quote is used once (`hire.quote_unspent`). The same set is consumed by `hire.create` and `market.fx_settle`. A deny does not consume it. An escalate reserves it until the ticket is approved, rejected, or expired. A void or refund does not restore it. An FX window is not a hire (`hire.not_fx`). Settle it. A denied hire does not hold the window.
27. A hireId that is not in this world is `hire.known`. It is not a broken mandate chain. Policy denies; mutate does not throw after an allow.
28. An intentId that is not in this world is `mandate.known_intent`. It is not a missing handshake. A deny does not consume the quote.
29. A cartId that is not in this world is `mandate.known_cart`. It is not a broken payment chain. A cart that already has a payment is `mandate.unique_payment`. It is not a second check.
30. An approvalId that is not in this world is `approval.known`. It is not a late yes. Policy denies; mutate does not throw after an allow.
31. Accept, deliver, and payment-required belong to the seller. Refund and release belong to the buyer or treasury (`hire.party`). The other side of the table is a policy deny, not a mutate throw.
32. A parentId that is not in this world is `mandate.known_parent`. It is not a tighter child. Policy denies; mutate does not write a ghost parent.
33. An agentId that is not in this world is `identity.known`. Freeze, unfreeze, ladder, handshake (delegate *and* principal), revoke, cart merchant, and intent subject do not throw after an allow, and do not write a handshake or tombstone for nobody.
34. An illegal hire arrow is `hire.state`. Second accept, fund from offered, refund after deliver, release before deliver, and payment-required before deliver are policy denies, not a 409 or 402 after an allow. Refund is only from funded. Payment-required is only after deliver. The escrow table still throws if policy ever lies.
35. An illegal ladder climb is `ladder.legal`. Skipping rungs, omitting a gate, listing `kill_switch_tested` without actually freezing, or the wrong approver are policy denies, not a mutate throw. `any→L0` stays legal.
36. Attesting yourself is `kya.not_self`. A handshake is with another agent. The graph still throws if policy ever lies.
37. A KYA `parentId` that is not in this world is `kya.known_parent`. It is not a live nested handshake. Policy denies; mutate does not mint a hop under a ghost parent. This flag is not `mandate.known_parent`.
38. An account name that is not in this world is `ledger.known_account`. Treasury cannot allocate through a missing book. A named balance of a missing book is not a zero. An FX settle without a USDC book is a missing book, not a journal throw. Policy denies; mutate does not throw after an allow.
39. One journal is one currency (`ledger.same_currency`). USD_SIM and USDC_SIM do not mix in a transfer, and the stated amount must match the books. Escrow cannot lock USD cash into a USDC hire. Convert with `market.fx_settle`.
40. A transfer cannot overdraw the source book (`ledger.sufficient`). Neither can `hire.fund` or `market.fx_settle` (the vendor’s USD leg). Draining to zero is legal. Negative cash is not. Escrow cannot lock on empty operating cash. MM USDC inventory is `mm.inventory`.
41. A KYA `attestationId` that is not in this world (or that belongs to another principal) is `kya.known_attestation`. It is not a silent tombstone. Revoke by principal+delegate with no id still kills implicit grants. Policy denies; mutate does not write `KYA_REVOKE` for a ghost or foreign handshake.
42. Minting or tombstoning a handshake in someone else’s name is `kya.party`. You are the principal, or you are a human/treasury kill switch. An L4 desk cannot write a founder’s handshake by filling in the ids.
43. A reused register alias (or a second market maker sharing `market_maker:cash_usd`) is `identity.unique_key`. Two agents cannot share one operating book. Same-body retries still replay. Policy denies; mutate does not throw `account exists` after an allow.
44. A receiptId that is not in this world is `receipt.known`. It is not an empty success. Policy denies; mutate does not return nothing after an allow. Inspect of a miss still returns nothing.
45. Unfreezing someone who is not frozen, or freezing someone who is already frozen, is `identity.freeze_state`. A no-op freeze is not a notary line after yes. Ghost freeze stays `identity.known`. Freeze then unfreeze is still the kill-switch test.
46. A second live handshake for the same principal→delegate pair is `kya.unique_live`. One live hop per pair. Revoke, then attest again. A second live hop is not a tighter grant. The graph still throws if policy ever lies.
47. A hire takes one cart (`hire.unique_cart`). Binding a second cart to a live hire is a policy deny, not a silent pointer swap. Mutate does not throw `hire already has a cart` after an allow.
48. A cart takes one payment (`mandate.unique_payment`). Minting a second payment for the same cart is a policy deny, not a second check. Ghost cart stays `mandate.known_cart`. Mutate does not throw `cart already has a payment` after an allow.
49. A listed SKU priced in a currency the catalog does not name is `market.sku_currency`. Research is USD_SIM. Convert with `market.fx_settle`. Ghost SKU stays `market.known_sku`. Funding a USDC hire from USD cash is `ledger.same_currency`, not a mixed journal after yes.
50. An FX window that is not this rail’s USD_SIM → USDC_SIM pair, or whose price is not in `from`, is `market.fx_pair`. An FX object on a research SKU is not a dual-use quote. A swapped pair is not a silent journal of the books this rail actually posts. Ghost RFQ stays `market.known_rfq`. Spent window stays `market.fx_quote`.
51. Hiring an FX window as a good is `hire.not_fx`. Windows settle (`market.fx_settle`). A deny does not consume or reserve the window. Ghost quote stays `market.known_rfq`. Spent window stays `hire.quote_unspent` first. An FX SKU quoted without a window is still a good.

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
