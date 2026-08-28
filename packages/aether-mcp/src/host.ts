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
import { PROTOCOL, type AgentId, type CommandType } from "@aether/types";

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

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "../tools.json"), "utf8")) as { tools: ToolDef[] };

const COMMAND_BY_TOOL = new Map(
  catalog.tools.filter((t) => t.commandType && !t.commandType.startsWith("demo.")).map((t) => [t.name, t.commandType as CommandType]),
);

const DEMO_TOOLS = new Set(["aether_demo_sprint", "aether_demo_night_watch", "aether_demo_sub_hire"]);

const ACTOR_SCHEMA = {
  type: "object",
  properties: {
    actor: { type: "string", description: "Runtime alias (ops-human, desk, scout) or aid_/system" },
    actorId: { type: "string" },
  },
  additionalProperties: true,
} as const;

function dataDir(): string | undefined {
  const dir = process.env.AETHER_DATA_DIR;
  return dir && dir.length > 0 ? dir : undefined;
}

function boot(): Runtime {
  const dir = dataDir();
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISMCP00000001",
    dailyLimit: 10_000_000,
    ...(dir ? { dataDir: dir } : {}),
  });
}

function mcpResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function serializeDispatch(r: DispatchResult) {
  if (!r.ok) {
    return {
      ok: false,
      verdict: r.error.decision.verdict,
      error: r.error.error,
      deny: r.error.decision.trace.filter((t) => t.verdict !== "allow"),
    };
  }
  return {
    ok: true,
    kind: r.value.kind,
    verdict: r.value.decision.verdict,
    data: r.value.data,
    ticket: r.value.ticket ?? null,
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
        serverInfo: { name: "aether", version: "0.1.0" },
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
            inputSchema: DEMO_TOOLS.has(t.name) ? { type: "object", properties: {} } : ACTOR_SCHEMA,
          })),
          {
            name: "aether_snapshot",
            description: "Read-only runtime snapshot: agents, mandates, hires, KYA, clearing, audit head.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "aether_protocol",
            description: "Pin-able protocol card. liveMoney is false until adapters exist.",
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
            uri: "aether://snapshot",
            name: "runtime snapshot",
            mimeType: "application/json",
          },
          {
            uri: "aether://agent-card",
            name: "runtime agent card",
            mimeType: "application/json",
          },
        ],
      };
    }
    if (method === "resources/read") {
      const uri = (params as { uri?: string })?.uri;
      if (uri === "aether://protocol") {
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
    const actor = this.actorOf(args);
    const { actor: _a, actorId: _b, ...body } = args;
    return serializeDispatch(this.runtime.dispatch(cmd(type, actor, body)));
  }

  private actorOf(args: Record<string, unknown>): AgentId | "system" {
    if (args.actorId === "system" || args.actor === "system") return "system";
    if (typeof args.actorId === "string") return args.actorId as AgentId;
    if (typeof args.actor === "string") {
      if (this.runtime.aliases.has(args.actor)) return this.runtime.aliases.get(args.actor)!;
      if (args.actor.startsWith("aid_")) return args.actor as AgentId;
    }
    return "system";
  }
}

export { catalog as MCP_TOOL_CATALOG };
