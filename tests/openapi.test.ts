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
