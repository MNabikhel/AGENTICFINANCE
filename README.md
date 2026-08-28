# Aether — Agent Economic Runtime

**Thesis:** Aether is a machine-first economic runtime that lets software agents hire, pay, escalate, and settle against a deterministic policy engine — using an in-memory/file ledger today and AP2/x402-*shaped* envelopes tomorrow — without becoming a trading bot or a checkout clone.

This repo is a greenfield TypeScript specification plus the canonical types, hash-chain, and policy catalog. **Implement from [`DESIGN.md`](./DESIGN.md).** Types win if prose and code disagree.

## What is here

| Path | What it is |
|---|---|
| [`DESIGN.md`](./DESIGN.md) | Full implementation contract: architecture, types, 26 policy rules, Sprint Procurement demo, anti-goals |
| [`packages/aether-types`](./packages/aether-types) | Canonical TypeScript object model |
| [`packages/aether-kernel`](./packages/aether-kernel) | SHA-256, JCS subset, money, clock |
| [`packages/aether-audit`](./packages/aether-audit) | Hash-chained append-only audit log |
| [`packages/aether-policy`](./packages/aether-policy) | Ordered deterministic rule table |
| [`schemas/`](./schemas) | JSON Schema (draft 2020-12) |
| [`packages/aether-openapi/openapi.yaml`](./packages/aether-openapi/openapi.yaml) | HTTP face |
| [`packages/aether-mcp/tools.json`](./packages/aether-mcp/tools.json) | MCP tool face |
| [`fixtures/demo/sprint-procurement/`](./fixtures/demo/sprint-procurement) | Demo inputs + TAP assertions |

## What is not here (and must not be)

Live bank or chain credentials. An order book. A checkout UI. Copied AP2/x402 SDKs. An LLM inside `evaluate()`.

## Autonomy ladder

`L0` human-executes → `L1` human-approves → `L2` constrained-auto → `L3` budget-auto → `L4` delegated-hire → `L5` human-out-of-the-loop (kill switch + circuit breakers still bind).

## Simulated economy

Treasury, procurement, data vendor, compute vendor, market maker (dumb FX window, ±200 bps), auditor (cannot spend).

## Implementer start

```
1. aether-kernel
2. aether-types + schemas
3. aether-audit + aether-ledger
4. identity + ladder
5. mandate verifyChain
6. policy tests (one allow + one deny per ruleId)
7. escrow + market
8. envelope + settlement
9. runtime.dispatch
10. HTTP + MCP + `aether demo sprint-procurement`
```

Acceptance: the ten TAP assertions in the fixture must pass. See DESIGN.md §4.
