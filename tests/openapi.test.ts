import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const spec = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../packages/aether-openapi/openapi.yaml"),
  "utf8",
);

describe("OpenAPI honesty", () => {
  it("advertises 200 for command allows, not 201 Created", () => {
    expect(spec).not.toMatch(/"201":/);
    expect(spec).toContain("Command bus allow, not HTTP 201 Created");
  });

  it("advertises 422 for hire.state and nonce reuse, not 409", () => {
    expect(spec).not.toMatch(/"409":/);
    expect(spec).toContain("Illegal hire transition is hire.state, not HTTP 409");
    expect(spec).toContain("Nonce reuse is idempotency.nonce, not HTTP 409");
  });

  it("says a host subscription whose slip died is expired", () => {
    expect(spec).toContain("A host subscription includes derived live | expired");
    expect(spec).toContain("A row whose slip died is expired, not live enrollment");
  });

  it("lists POST /v1/commands and the missing hire/FX/transfer aliases", () => {
    expect(spec).toContain("/v1/commands:");
    expect(spec).toContain("operationId: commandDispatch");
    expect(spec).toContain("/v1/hires/{id}/deliver:");
    expect(spec).toContain("/v1/hires/{id}/release:");
    expect(spec).toContain("/v1/fx/settle:");
    expect(spec).toContain("/v1/ledger/transfers:");
  });

  it("lists every HTTP TAP the discovery card names", () => {
    expect(spec).toContain("/v1/demo/sprint-procurement:");
    expect(spec).toContain("/v1/demo/night-watch:");
    expect(spec).toContain("/v1/demo/sub-hire:");
    expect(spec).toContain("/v1/demo/clearing:");
    expect(spec).toContain("not a second payment");
    expect(spec).toContain("/v1/demo/refund:");
    expect(spec).toContain("quote stays spent");
    expect(spec).toContain("/v1/demo/replay:");
    expect(spec).toContain("not a second spend");
    expect(spec).toContain("/v1/demo/nonce:");
    expect(spec).toContain("payment nonce is one-shot");
    expect(spec).toContain("/v1/demo/deny:");
    expect(spec).toContain("never a cached success");
    expect(spec).toContain("/v1/demo/recurrence:");
    expect(spec).toContain("one-slot cadence");
    expect(spec).toContain("/v1/demo/calendar:");
    expect(spec).toContain("closed calendar");
    expect(spec).toContain("/v1/demo/slot:");
    expect(spec).toContain("does not restore a cadence slot");
    expect(spec).toContain("/v1/demo/daily:");
    expect(spec).toContain("gap, not a burst");
    expect(spec).toContain("/v1/demo/cart:");
    expect(spec).toContain("not a field on fund");
    expect(spec).toContain("/v1/demo/velocity:");
    expect(spec).toContain("not a freeze on funded work");
    expect(spec).toContain("/v1/demo/door:");
    expect(spec).toContain("not a hosted checkout");
    expect(spec).toContain("/v1/demo/match:");
    expect(spec).toContain("not a discount");
    expect(spec).toContain("/v1/demo/room:");
    expect(spec).toContain("not a bulletin board");
    expect(spec).toContain("/v1/demo/conversion:");
    expect(spec).toContain("not a hire");
    expect(spec).toContain("/v1/demo/pair:");
    expect(spec).toContain("not a tighter grant");
    expect(spec).toContain("/v1/demo/band:");
    expect(spec).toContain("not decoration");
    expect(spec).toContain("/v1/demo/nest:");
    expect(spec).toContain("does not outlive its parent");
    expect(spec).toContain("/v1/demo/heir:");
    expect(spec).toContain("not a parent");
    expect(spec).toContain("/v1/demo/stock:");
    expect(spec).toContain("not a missing maker");
    expect(spec).toContain("/v1/demo/purse:");
    expect(spec).toContain("not an item cap");
    expect(spec).toContain("/v1/demo/seat:");
    expect(spec).toContain("one row");
    expect(spec).toContain("/v1/demo/cover:");
    expect(spec).toContain("not a child's leftover");
    expect(spec).toContain("/v1/demo/mint:");
    expect(spec).toContain("not a mint");
    expect(spec).toContain("/v1/demo/payee:");
    expect(spec).toContain("not any registered vendor");
    expect(spec).toContain("/v1/demo/climb:");
    expect(spec).toContain("not a wider handshake");
    expect(spec).toContain("/v1/demo/born:");
    expect(spec).toContain("cannot be born dead");
    expect(spec).toContain("/v1/demo/reach:");
    expect(spec).toContain("opens after the slip dies");
    expect(spec).toContain("/v1/demo/year:");
    expect(spec).toContain("cannot outlive one year");
    expect(spec).toContain("/v1/demo/fuse:");
    expect(spec).toContain("not a freeze on funded work");
    expect(spec).toContain("/v1/demo/sku:");
    expect(spec).toContain("not any catalog good");
    expect(spec).toContain("/v1/demo/priced:");
    expect(spec).toContain("only priced in a currency the catalog names");
    expect(spec).toContain("/v1/demo/party:");
    expect(spec).toContain("not a party");
    expect(spec).toContain("/v1/demo/cash:");
    expect(spec).toContain("not a negative book");
    expect(spec).toContain("/v1/demo/stale:");
    expect(spec).toContain("not a hire");
    expect(spec).toContain("/v1/demo/chain:");
    expect(spec).toContain("not a check");
    expect(spec).toContain("/v1/demo/arrow:");
    expect(spec).toContain("not a payout");
    expect(spec).toContain("/v1/demo/wallet:");
    expect(spec).toContain("not a USDC wallet");
    expect(spec).toContain("/v1/demo/name:");
    expect(spec).toContain("not a handshake");
    expect(spec).toContain("/v1/demo/pane:");
    expect(spec).toContain("not a good");
    expect(spec).toContain("/v1/demo/subject:");
    expect(spec).toContain("not yours to spend");
    expect(spec).toContain("/v1/demo/paper:");
    expect(spec).toContain("not a conversion window");
    expect(spec).toContain("/v1/demo/mix:");
    expect(spec).toContain("not a conversion");
    expect(spec).toContain("/v1/demo/rung:");
    expect(spec).toContain("not a promotion");
    expect(spec).toContain("/v1/demo/grade:");
    expect(spec).toContain("not a nested-slip mint");
  });

  it("lists HTTP aliases the bus actually serves", () => {
    expect(spec).toContain("/v1/kya/attest:");
    expect(spec).toContain("/v1/kya/revoke:");
    expect(spec).toContain("/v1/kya:");
    expect(spec).toContain("/v1/circuit/reset:");
    expect(spec).toContain("/v1/agents/{id}/freeze:");
    expect(spec).toContain("/v1/agents/{id}/unfreeze:");
    expect(spec).toContain("/.well-known/agent-card.json:");
    expect(spec).toContain("/v1/clearing/windows:");
    expect(spec).toContain("An iss_ issuer is a genesis catalog row");
  });
});
