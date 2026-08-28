import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeRequired, encodeResponse } from "@aether/envelope";
import { Runtime, cmd, type DispatchResult } from "@aether/runtime";
import { loadScenario, runSprintProcurement } from "@aether/sprint";
import { loadNightWatch, runNightWatch } from "@aether/night-watch";
import { loadSubHire, runSubHire } from "@aether/sub-hire";
import { PROTOCOL, type AgentId, type CommandType } from "@aether/types";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../public");
const fixture = join(process.cwd(), "fixtures/demo/sprint-procurement/scenario.json");
const nightWatchFixture = join(process.cwd(), "fixtures/demo/night-watch/scenario.json");
const subHireFixture = join(process.cwd(), "fixtures/demo/sub-hire/scenario.json");

let runtime = boot();
let lastDemo: unknown = null;

function boot(): Runtime {
  const dir = process.env.AETHER_DATA_DIR;
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESIS0000000001",
    dailyLimit: 10_000_000,
    ...(dir && dir.length > 0 ? { dataDir: dir } : {}),
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, payment-signature, payment-required",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    ...headers,
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function actorOf(body: Record<string, unknown>): AgentId | "system" {
  return runtime.speakerOf(body);
}

function dispatchJson(type: CommandType, reqBody: Record<string, unknown>): DispatchResult {
  const { actorId: _a, actor: _b, idempotencyKey, ...body } = reqBody;
  const key = typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : undefined;
  return runtime.dispatch(cmd(type, actorOf(reqBody), body, key));
}

function handleDispatch(res: ServerResponse, type: CommandType, reqBody: Record<string, unknown>, extra?: (r: DispatchResult) => Record<string, string> | undefined) {
  const result = dispatchJson(type, reqBody);
  const headers = extra?.(result);
  if (!result.ok) {
    json(res, result.error.error.status, { ...result.error.error, decision: result.error.decision }, headers);
    return;
  }
  const status = type === "envelope.require" ? 402 : result.value.kind === "escalated" ? 202 : 200;
  json(res, status, result.value, headers);
}

export function start(port = Number(process.env.PORT ?? 8787)) {
  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) return json(res, 400, { error: "bad request" });
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type, payment-signature",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        });
        res.end();
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const path = url.pathname;

      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        const file = join(publicDir, "index.html");
        const html = existsSync(file) ? readFileSync(file, "utf8") : "<h1>Aether</h1>";
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && path === "/favicon.svg") {
        const file = join(publicDir, "favicon.svg");
        if (existsSync(file)) {
          res.writeHead(200, { "content-type": "image/svg+xml" });
          res.end(readFileSync(file));
          return;
        }
      }
      if (req.method === "GET" && path === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "GET" && path === "/v1/snapshot") {
        json(res, 200, runtime.snapshotState());
        return;
      }
      if (req.method === "GET" && path === "/v1/protocol") {
        json(res, 200, runtime.protocolCard());
        return;
      }
      if (req.method === "GET" && path === "/.well-known/aether.json") {
        json(res, 200, runtime.protocolCard());
        return;
      }
      if (req.method === "GET" && path === "/v1/catalog") {
        const listed = runtime.dispatch(cmd("market.catalog", "system", {}));
        if (!listed.ok) {
          json(res, listed.error.error.status, { ...listed.error.error, decision: listed.error.decision });
          return;
        }
        json(res, 200, listed.value.data);
        return;
      }
      if (req.method === "GET" && path === "/v1/audit") {
        const q: Record<string, unknown> = {};
        const subject = url.searchParams.get("subject") ?? url.searchParams.get("subjectId");
        const action = url.searchParams.get("action");
        const limit = url.searchParams.get("limit");
        if (subject) q.subjectId = subject;
        if (action) q.action = action;
        if (limit) q.limit = Number(limit);
        handleDispatch(res, "audit.query", { ...q, actor: "system" });
        return;
      }
      if (req.method === "GET" && path === "/v1/commands") {
        const spec = join(process.cwd(), "schemas/commands.schema.json");
        json(res, 200, JSON.parse(readFileSync(spec, "utf8")));
        return;
      }
      const objectGet = path.match(/^\/v1\/objects\/([^/]+)$/);
      if (req.method === "GET" && objectGet) {
        const found = runtime.inspect(decodeURIComponent(objectGet[1]!));
        if (!found) {
          json(res, 404, { title: "not found", id: objectGet[1] });
          return;
        }
        json(res, 200, found);
        return;
      }
      const hireGet = path.match(/^\/v1\/hires\/([^/]+)$/);
      if (req.method === "GET" && hireGet) {
        const found = runtime.inspect(hireGet[1]!);
        if (!found || found.type !== "hire") {
          json(res, 404, { title: "not found", id: hireGet[1] });
          return;
        }
        json(res, 200, found.value);
        return;
      }
      const agentGet = path.match(/^\/v1\/agents\/([^/]+)$/);
      if (req.method === "GET" && agentGet) {
        const found = runtime.inspect(decodeURIComponent(agentGet[1]!));
        if (!found || found.type !== "agent") {
          json(res, 404, { title: "not found", id: agentGet[1] });
          return;
        }
        json(res, 200, found.value);
        return;
      }
      const approvalGet = path.match(/^\/v1\/approvals\/([^/]+)$/);
      if (req.method === "GET" && approvalGet) {
        const found = runtime.inspect(approvalGet[1]!);
        if (!found || found.type !== "approval") {
          json(res, 404, { title: "not found", id: approvalGet[1] });
          return;
        }
        json(res, 200, found.value);
        return;
      }
      if (req.method === "GET" && path === "/v1/kya") {
        json(res, 200, runtime.kyaSnapshot());
        return;
      }
      if (req.method === "GET" && (path === "/.well-known/agent-card.json" || path === "/.well-known/agent.json")) {
        json(res, 200, {
          protocolVersion: PROTOCOL.version,
          name: "Aether Economic Runtime",
          description: "Policy, mandate, hire, escrow, settlement, and audit for software agents. Simulated rail sim:aether-1.",
          url: "http://127.0.0.1:8787",
          capabilities: { streaming: false, pushNotifications: false },
          skills: [
            { id: "protocol", name: "Host card", description: "GET /v1/protocol and GET /.well-known/aether.json — pin aether.protocol.1. liveMoney false. evaluateLlm false. hosted false." },
            { id: "commands", name: "Command bus", description: "GET /v1/commands — JSON Schema for every CommandType. Same commands as MCP." },
            { id: "sprint-procurement", name: "Sprint Procurement TAP", description: "POST /v1/demo/sprint-procurement — conformance, not a storefront" },
            { id: "night-watch", name: "Night Watch TAP", description: "POST /v1/demo/night-watch — standing mandate, KYA, circuit breaker" },
            { id: "sub-hire", name: "Sub-hire TAP", description: "POST /v1/demo/sub-hire — L4 nested slips, parent budget, child handshake" },
          ],
          defaultInputModes: ["application/json"],
          defaultOutputModes: ["application/json"],
        });
        return;
      }
      if (req.method === "GET" && path === "/v1/story") {
        json(res, 200, { tldr: runtime.snapshotState().tldr, analog: runtime.snapshotState().analog, story: runtime.story });
        return;
      }
      if (req.method === "GET" && path === "/v1/demo/last") {
        json(res, 200, lastDemo ?? { ok: false, detail: "run POST /v1/demo/sprint-procurement" });
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/sprint-procurement") {
        const report = runSprintProcurement(loadScenario(fixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "sprint-procurement" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/night-watch") {
        const report = runNightWatch(loadNightWatch(nightWatchFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "night-watch" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/sub-hire") {
        const report = runSubHire(loadSubHire(subHireFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "sub-hire" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/reset") {
        runtime = boot();
        lastDemo = null;
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && path === "/openapi.json") {
        const spec = join(process.cwd(), "packages/aether-openapi/openapi.yaml");
        json(res, 200, { format: "yaml", path: spec, note: "see packages/aether-openapi/openapi.yaml" });
        return;
      }
      if (req.method === "GET" && path === "/v1/audit/verify") {
        json(res, 200, runtime.audit.verify());
        return;
      }

      const bodyText = req.method === "POST" ? await readBody(req) : "{}";
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};

      const routes: Record<string, CommandType> = {
        "/v1/identities": "identity.register",
        "/v1/kya/attest": "kya.attest",
        "/v1/kya/revoke": "kya.revoke",
        "/v1/circuit/reset": "circuit.reset",
        "/v1/mandates/intent": "mandate.issue_intent",
        "/v1/mandates/cart": "mandate.issue_cart",
        "/v1/mandates/payment": "mandate.issue_payment",
        "/v1/rfqs": "market.rfq",
        "/v1/quotes": "market.quote",
        "/v1/hires": "hire.create",
        "/v1/payments/require": "envelope.require",
        "/v1/payments/submit": "envelope.submit",
        "/v1/audit/verify": "audit.verify",
        "/v1/audit/query": "audit.query",
        "/v1/catalog": "market.catalog",
        "/v1/host/card": "host.card",
        "/v1/host/subscribe": "host.subscribe",
        "/v1/clearing/windows": "clearing.settle_window",
      };

      if (req.method === "POST" && routes[path]) {
        const type = routes[path]!;
        handleDispatch(res, type, body, (r) => {
          if (!r.ok) return undefined;
          if (type === "envelope.require") {
            return { "PAYMENT-REQUIRED": encodeRequired(r.value.data as never) };
          }
          if (type === "envelope.submit") {
            const settlement = (r.value.data as { settlement?: Parameters<typeof encodeResponse>[0] }).settlement;
            return settlement ? { "PAYMENT-RESPONSE": encodeResponse(settlement) } : undefined;
          }
          return undefined;
        });
        return;
      }

      const hireAccept = path.match(/^\/v1\/hires\/([^/]+)\/accept$/);
      if (req.method === "POST" && hireAccept) {
        handleDispatch(res, "hire.accept", { ...body, hireId: hireAccept[1] });
        return;
      }
      const hireFund = path.match(/^\/v1\/hires\/([^/]+)\/fund$/);
      if (req.method === "POST" && hireFund) {
        handleDispatch(res, "hire.fund", { ...body, hireId: hireFund[1] });
        return;
      }
      const hireRefund = path.match(/^\/v1\/hires\/([^/]+)\/refund$/);
      if (req.method === "POST" && hireRefund) {
        handleDispatch(res, "hire.refund", { ...body, hireId: hireRefund[1] });
        return;
      }
      const approval = path.match(/^\/v1\/approvals\/([^/]+)\/resolve$/);
      if (req.method === "POST" && approval) {
        handleDispatch(res, "approval.resolve", { ...body, approvalId: approval[1] });
        return;
      }
      const autonomy = path.match(/^\/v1\/agents\/([^/]+)\/autonomy$/);
      if (req.method === "POST" && autonomy) {
        handleDispatch(res, "ladder.set", { ...body, agentId: autonomy[1] });
        return;
      }
      const freeze = path.match(/^\/v1\/agents\/([^/]+)\/freeze$/);
      if (req.method === "POST" && freeze) {
        handleDispatch(res, "identity.freeze", { ...body, agentId: freeze[1] });
        return;
      }
      const unfreeze = path.match(/^\/v1\/agents\/([^/]+)\/unfreeze$/);
      if (req.method === "POST" && unfreeze) {
        handleDispatch(res, "identity.unfreeze", { ...body, agentId: unfreeze[1] });
        return;
      }
      const account = path.match(/^\/v1\/accounts\/([^/]+)$/);
      if (req.method === "GET" && account) {
        handleDispatch(res, "ledger.balances", { name: decodeURIComponent(account[1]!), actor: "ops-human" });
        return;
      }
      const receipt = path.match(/^\/v1\/receipts\/([^/]+)$/);
      if (req.method === "GET" && receipt) {
        handleDispatch(res, "receipt.get", { receiptId: receipt[1], actor: "ops-human" });
        return;
      }

      json(res, 404, { title: "not found", path });
    } catch (e) {
      json(res, 500, { title: "internal", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Aether control room http://127.0.0.1:${port}`);
  });
  return server;
}

start();
