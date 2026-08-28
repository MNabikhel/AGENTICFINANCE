/**
 * MCP host. One persistent Runtime. Every tool is either a CommandType
 * or a demo/control verb. Other agents should speak this, not the HTML room.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime, cmd, type DispatchResult } from "@aether/runtime";
import { loadScenario, runSprintProcurement } from "@aether/sprint";
import { loadNightWatch, runNightWatch } from "@aether/night-watch";
import { loadSubHire, runSubHire } from "@aether/sub-hire";
import { PROTOCOL, type CommandType } from "@aether/types";

export type JsonRpcId = string | number | null;

export interface JsonRpcReq {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export interface JsonRpcRes {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type ToolDef = {
  name: string;
  commandType?: string;
  description: string;
};

type JsonSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [k: string]: unknown;
};

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../tools.json"), "utf8")) as { tools: ToolDef[] };
const commandBodies = (
  JSON.parse(readFileSync(join(here, "../../../schemas/commands.schema.json"), "utf8")) as {
    commands: Record<string, JsonSchema>;
  }
).commands;

const COMMAND_BY_TOOL = new Map(
  catalog.tools.filter((t) => t.commandType && !t.commandType.startsWith("demo.")).map((t) => [t.name, t.commandType as CommandType]),
);

const DEMO_TOOLS = new Set(["aether_demo_sprint", "aether_demo_night_watch", "aether_demo_sub_hire"]);

const ACTOR_PROPERTIES = {
  actor: { type: "string", description: "Runtime alias after register (ops-human, desk, scout), aid_, or system. Unknown names are missing speakers, not system. Omit to bootstrap." },
  actorId: { type: "string" },
  idempotencyKey: {
    type: "string",
    description: "Stable key for money-moving retries. Denies are never cached. Same key + allow = replay, not a second spend.",
  },
} as const;

function inputSchemaFor(commandType: string): JsonSchema {
  const body = commandBodies[commandType] ?? { type: "object", properties: {} };
  const schema: JsonSchema = {
    type: "object",
    properties: { ...ACTOR_PROPERTIES, ...(body.properties ?? {}) },
    additionalProperties: true,
  };
  if (body.required && body.required.length > 0) schema.required = body.required;
  return schema;
}

function dataDir(): string | undefined {
  const dir = process.env.AETHER_DATA_DIR;
  return dir && dir.length > 0 ? dir : undefined;
}

function hostedOpt(): { hosted: boolean } | Record<string, never> {
  const v = process.env.AETHER_HOSTED;
  if (v === "true" || v === "1") return { hosted: true };
  if (v === "false" || v === "0") return { hosted: false };
  return {};
}

function boot(): Runtime {
  const dir = dataDir();
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISMCP00000001",
    dailyLimit: 10_000_000,
    ...(dir ? { dataDir: dir } : {}),
    ...hostedOpt(),
  });
}

function mcpResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function serializeDispatch(r: DispatchResult) {
  if (!r.ok) {
    return {
      ok: false,
      verdict: r.error.decision?.verdict ?? "malformed",
      error: r.error.error,
      deny: r.error.decision?.trace.filter((t) => t.verdict !== "allow") ?? [],
      remediation: r.error.decision?.remediation ?? null,
    };
  }
  return {
    ok: true,
    kind: r.value.kind,
    verdict: r.value.decision.verdict,
    data: r.value.data,
    ticket: r.value.ticket ?? null,
    replayed: r.value.replayed === true,
    remediation: r.value.decision.remediation ?? null,
  };
}

export class AetherMcp {
  runtime: Runtime = boot();

  reset(): void {
    this.runtime = boot();
  }

  handle(msg: JsonRpcReq): JsonRpcRes | null {
    if (msg.id === undefined || msg.id === null) {
      return null;
    }
    const id = msg.id;
    try {
      const result = this.dispatchMethod(msg.method ?? "", msg.params);
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: e instanceof Error ? e.message : String(e) },
      };
    }
  }

  private dispatchMethod(method: string, params: unknown): unknown {
    if (method === "initialize") {
      return {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "aether", version: PROTOCOL.version },
        capabilities: { tools: {}, resources: {} },
        instructions:
          "Aether is a rulebook for software that spends money on sim:aether-1. Dispatch commands with actor aliases. Policy is deterministic. No live rails. Read AGENTS.md.",
      };
    }
    if (method === "ping") return {};
    if (method.startsWith("notifications/")) return {};
    if (method === "tools/list") {
      return {
        tools: [
          ...catalog.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: DEMO_TOOLS.has(t.name)
              ? { type: "object", properties: {} }
              : t.commandType
                ? inputSchemaFor(t.commandType)
                : { type: "object", properties: {} },
          })),
          {
            name: "aether_snapshot",
            description: "Read-only runtime snapshot: agents, mandates, carts, payments, hires, KYA, clearing, audit head. Intents include derived live | expired | funded. Carts include derived live | expired | bound. Payments include derived live | expired | funded. RFQs include derived live | expired. Quotes include derived live | expired | spent | held (a hire quote in a dead room is expired).",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "aether_get",
            description: "Fetch one object by id or alias (hid_, mid_, aid_, rid_, apd_, rfq_, qte_, dlg_, acct_, or cash account name). A qte_ quote includes derived status (live | expired | spent | held). Expired includes a lapsed FX validUntil and, for a hire quote, a dead parent RFQ. An FX quote is a window on the quote, not the room. A rfq_ room includes derived status (live | expired). A mid_ intent includes derived status (live | expired | funded). Funded is escrow-moved occupancy against this slip and wins over expired. A mid_ cart includes derived status (live | expired | bound). Bound is unique_payment occupancy and wins over expired. A mid_ payment includes derived status (live | expired | funded). Funded is escrow-moved occupancy and wins over expired. A dlg_ hop includes derived status (live | expired | revoked).",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
          {
            name: "aether_protocol",
            description: "Pin-able protocol card. liveMoney is false until adapters exist. evaluateLlm is false. hosted is false on this public kernel.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "aether_reset",
            description: "Replace the in-process runtime with a fresh genesis. Destroys simulated state.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      };
    }
    if (method === "resources/list") {
      return {
        resources: [
          {
            uri: "aether://protocol",
            name: "protocol card",
            mimeType: "application/json",
          },
          {
            uri: "aether://host",
            name: "host card (same pin as protocol: pricing, capabilities, hosted)",
            mimeType: "application/json",
          },
          {
            uri: "aether://snapshot",
            name: "runtime snapshot",
            mimeType: "application/json",
          },
          {
            uri: "aether://agent-card",
            name: "runtime agent card",
            mimeType: "application/json",
          },
          {
            uri: "aether://commands",
            name: "command body schemas",
            mimeType: "application/json",
          },
        ],
      };
    }
    if (method === "resources/read") {
      const uri = (params as { uri?: string })?.uri;
      if (uri === "aether://protocol" || uri === "aether://host") {
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(this.runtime.protocolCard()) }] };
      }
      if (uri === "aether://snapshot") {
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(this.runtime.snapshotState()) }] };
      }
      if (uri === "aether://agent-card") {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                protocolVersion: PROTOCOL.version,
                name: "Aether Economic Runtime",
                description: "Policy, mandate, hire, escrow, settlement, KYA, audit. Rail sim:aether-1.",
                skills: catalog.tools.map((t) => ({ id: t.name, description: t.description })),
              }),
            },
          ],
        };
      }
      if (uri === "aether://commands") {
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(commandBodies) }] };
      }
      const objectUri = uri?.match(/^aether:\/\/(?:object|hire|intent|receipt|approval|agent)\/(.+)$/);
      if (objectUri?.[1]) {
        const found = this.runtime.inspect(decodeURIComponent(objectUri[1]));
        if (!found) throw new Error(`unknown object ${objectUri[1]}`);
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(found) }] };
      }
      throw new Error(`unknown resource ${uri}`);
    }
    if (method === "tools/call") {
      const p = params as { name?: string; arguments?: Record<string, unknown> };
      return mcpResult(this.callTool(p.name ?? "", p.arguments ?? {}));
    }
    throw new Error(`unknown method ${method}`);
  }

  callTool(name: string, args: Record<string, unknown>): unknown {
    if (name === "aether_snapshot") return this.runtime.snapshotState();
    if (name === "aether_protocol") return this.runtime.protocolCard();
    if (name === "aether_get") {
      const id = String(args.id ?? "");
      const found = this.runtime.inspect(id);
      if (!found) throw new Error(`unknown object ${id}`);
      return found;
    }
    if (name === "aether_reset") {
      const dir = dataDir();
      if (dir) {
        for (const f of ["world.json", "audit.jsonl", "world.json.tmp"]) {
          const p = join(dir, f);
          if (existsSync(p)) unlinkSync(p);
        }
      }
      this.reset();
      return { ok: true };
    }
    if (name === "aether_demo_sprint") {
      const report = runSprintProcurement(loadScenario("fixtures/demo/sprint-procurement/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_night_watch") {
      const report = runNightWatch(loadNightWatch("fixtures/demo/night-watch/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_sub_hire") {
      const report = runSubHire(loadSubHire("fixtures/demo/sub-hire/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    const type = COMMAND_BY_TOOL.get(name);
    if (!type) throw new Error(`unknown tool ${name}`);
    const actor = this.runtime.speakerOf(args);
    const { actor: _a, actorId: _b, idempotencyKey, ...body } = args;
    const key = typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : undefined;
    return serializeDispatch(this.runtime.dispatch(cmd(type, actor, body, key)));
  }
}

export { catalog as MCP_TOOL_CATALOG };
