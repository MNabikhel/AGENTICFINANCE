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
