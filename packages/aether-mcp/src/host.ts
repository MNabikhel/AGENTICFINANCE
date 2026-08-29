/**
 * MCP host. One persistent Runtime. Every tool is either a CommandType
 * or a demo/control verb. Other agents should speak this, not the HTML room.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime, admitInvoice, admitSpeaker, cmd, parseHostedMonthly, speakerKeyOf, type DispatchResult } from "@aether/runtime";
import { loadScenario, runSprintProcurement } from "@aether/sprint";
import { loadNightWatch, runNightWatch } from "@aether/night-watch";
import { loadSubHire, runSubHire } from "@aether/sub-hire";
import { loadClearingWindow, runClearingWindow } from "@aether/clearing-window";
import { loadRefund, runRefund } from "@aether/refund";
import { loadReplay, runReplay } from "@aether/replay";
import { loadNonce, runNonce } from "@aether/envelope-nonce";
import { loadDenyCache, runDenyCache } from "@aether/deny-cache";
import { loadRecurrence, runRecurrence } from "@aether/recurrence-cadence";
import { loadCalendar, runCalendar } from "@aether/execution-window";
import { loadSlot, runSlot } from "@aether/cadence-slot";
import { loadDaily, runDaily } from "@aether/daily-gap";
import { loadCartOccupancy, runCartOccupancy } from "@aether/cart-occupancy";
import { loadVelocity, runVelocity } from "@aether/hot-hour";
import { loadDoor, runDoor } from "@aether/operator-door";
import { loadCartMatch, runCartMatch } from "@aether/cart-match";
import { loadClosedRoom, runClosedRoom } from "@aether/closed-room";
import { loadConversion, runConversion } from "@aether/fx-not-hire";
import { loadUniqueLive, runUniqueLive } from "@aether/unique-live";
import { loadSpreadBound, runSpreadBound } from "@aether/spread-bound";
import { loadParentFresh, runParentFresh } from "@aether/parent-fresh";
import { loadMandateParent, runMandateParent } from "@aether/mandate-parent";
import { loadMmInventory, runMmInventory } from "@aether/mm-inventory";
import { loadPaymentBudget, runPaymentBudget } from "@aether/payment-budget";
import { loadHostUnique, runHostUnique } from "@aether/host-unique";
import { loadParentBudget, runParentBudget } from "@aether/payment-parent";
import { loadOperatingBook, runOperatingBook } from "@aether/operating-book";
import { loadPaymentPayees, runPaymentPayees } from "@aether/payment-payees";
import { loadCapabilitySubset, runCapabilitySubset } from "@aether/capability-subset";
import { loadFxFresh, runFxFresh } from "@aether/fx-fresh";
import { loadWindowReach, runWindowReach } from "@aether/window-reach";
import { loadKyaWindow, runKyaWindow } from "@aether/kya-window";
import { loadCircuitDaily, runCircuitDaily } from "@aether/circuit-daily";
import { loadPaymentSkus, runPaymentSkus } from "@aether/payment-skus";
import { loadSkuCurrency, runSkuCurrency } from "@aether/sku-currency";
import { loadHireParty, runHireParty } from "@aether/hire-party";
import { loadLedgerSufficient, runLedgerSufficient } from "@aether/ledger-sufficient";
import { loadNotExpired, runNotExpired } from "@aether/not-expired";
import { loadChainIntegrity, runChainIntegrity } from "@aether/chain-integrity";
import { loadHireState, runHireState } from "@aether/hire-state";
import { loadLedgerKnown, runLedgerKnown } from "@aether/ledger-known";
import { loadKyaParty, runKyaParty } from "@aether/kya-party";
import { loadFxWindow, runFxWindow } from "@aether/fx-window";
import { loadIntentSubject, runIntentSubject } from "@aether/intent-subject";
import { loadFxQuote, runFxQuote } from "@aether/fx-quote";
import { loadSameCurrency, runSameCurrency } from "@aether/same-currency";
import { loadLadderLegal, runLadderLegal } from "@aether/ladder-legal";
import { loadMinLevel, runMinLevel } from "@aether/min-level";
import { loadBirthRung, runBirthRung } from "@aether/birth-rung";
import { loadMaxAutonomy, runMaxAutonomy } from "@aether/max-autonomy";
import { loadAttestationFresh, runAttestationFresh } from "@aether/attestation-fresh";
import { loadApprovalPending, runApprovalPending } from "@aether/approval-pending";
import { loadKyaNotSelf, runKyaNotSelf } from "@aether/kya-not-self";
import { loadHostAuthority, runHostAuthority } from "@aether/host-authority";
import { loadOccurrenceFresh, runOccurrenceFresh } from "@aether/occurrence-fresh";
import { loadRoleCapability, runRoleCapability } from "@aether/role-capability";
import { loadAmountRange, runAmountRange } from "@aether/amount-range";
import { loadEscrowRequired, runEscrowRequired } from "@aether/escrow-required";
import { loadKnownSku, runKnownSku } from "@aether/known-sku";
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

const DEMO_TOOLS = new Set([
  "aether_demo_sprint",
  "aether_demo_night_watch",
  "aether_demo_sub_hire",
  "aether_demo_clearing",
  "aether_demo_refund",
  "aether_demo_replay",
  "aether_demo_nonce",
  "aether_demo_deny",
  "aether_demo_recurrence",
  "aether_demo_calendar",
  "aether_demo_slot",
  "aether_demo_daily",
  "aether_demo_cart",
  "aether_demo_velocity",
  "aether_demo_door",
  "aether_demo_match",
  "aether_demo_room",
  "aether_demo_conversion",
  "aether_demo_pair",
  "aether_demo_band",
  "aether_demo_nest",
  "aether_demo_heir",
  "aether_demo_stock",
  "aether_demo_purse",
  "aether_demo_seat",
  "aether_demo_cover",
  "aether_demo_mint",
  "aether_demo_payee",
  "aether_demo_climb",
  "aether_demo_born",
  "aether_demo_reach",
  "aether_demo_year",
  "aether_demo_fuse",
  "aether_demo_sku",
  "aether_demo_priced",
  "aether_demo_party",
  "aether_demo_cash",
  "aether_demo_stale",
  "aether_demo_chain",
  "aether_demo_arrow",
  "aether_demo_wallet",
  "aether_demo_name",
  "aether_demo_pane",
  "aether_demo_subject",
  "aether_demo_paper",
  "aether_demo_mix",
  "aether_demo_rung",
  "aether_demo_grade",
  "aether_demo_cradle",
  "aether_demo_ceiling",
  "aether_demo_lapse",
  "aether_demo_pause",
  "aether_demo_mirror",
  "aether_demo_warrant",
  "aether_demo_vacant",
  "aether_demo_badge",
  "aether_demo_lid",
  "aether_demo_bare",
  "aether_demo_shelf",
]);

const ACTOR_PROPERTIES = {
  actor: { type: "string", description: "Runtime alias after register (ops-human, desk, scout), aid_, or system. Unknown names are missing speakers, not system. Omit to bootstrap. On a hosted operator a named speaker must also pass speakerProof." },
  actorId: { type: "string" },
  speakerProof: {
    type: "string",
    description: "Hosted operator only. Ed25519 signature (base64url) of the canonical command. Public kernel ignores it.",
  },
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
  const hosted = hostedOpt();
  const hostedMonthly = parseHostedMonthly(process.env.AETHER_HOSTED_MONTHLY);
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESISMCP00000001",
    dailyLimit: 10_000_000,
    ...(dir ? { dataDir: dir } : {}),
    ...hosted,
    ...("hosted" in hosted && hosted.hosted === true && hostedMonthly !== undefined ? { hostedMonthly } : {}),
  });
}

function mcpResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function serializeDispatch(r: DispatchResult, rt: Runtime, type?: CommandType) {
  if (!r.ok) {
    return {
      ok: false,
      verdict: r.error.decision?.verdict ?? "malformed",
      error: r.error.error,
      deny: r.error.decision?.trace.filter((t) => t.verdict !== "allow") ?? [],
      remediation: r.error.decision?.remediation ?? null,
    };
  }
  let data = r.value.data;
  if (type === "identity.register" && rt.hosted) {
    const agent = data as { id: string };
    const speakerKey = speakerKeyOf(rt, agent.id as AgentId);
    if (speakerKey) data = { ...agent, speakerKey };
  }
  return {
    ok: true,
    kind: r.value.kind,
    verdict: r.value.decision.verdict,
    data,
    ticket: r.value.ticket ?? null,
    replayed: r.value.replayed === true,
    remediation: r.value.decision.remediation ?? null,
  };
}

export class AetherMcp {
  runtime: Runtime;

  constructor(opts?: { runtime?: Runtime }) {
    this.runtime = opts?.runtime ?? boot();
  }

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
            description: "Read-only runtime snapshot: agents, mandates, carts, payments, hires, KYA, clearing, audit head. Intents include derived live | expired | funded (a child whose parent died is expired). Carts include derived live | expired | bound. Payments include derived live | expired | funded (a payment whose parent cart died is expired). Hires include derived live | expired | funded (an offered hire whose slip died is expired). RFQs include derived live | expired. Quotes include derived live | expired | spent | held (a hire quote in a dead room is expired). Host subscriptions include derived live | expired (a row whose slip died is expired).",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "aether_get",
            description: "Fetch one object by id or alias (hid_, mid_, aid_, rid_, apd_, rfq_, qte_, dlg_, iss_, hsb_, acct_, inv_, or cash account name). A hid_ hire includes derived status (live | expired | funded). Funded is escrow-moved occupancy and wins over expired. Expired includes a dead intent and a dead parent intent even when the child's exp still lives. An apd_ ticket includes derived pending | expired | stale. Stale is a pause whose held command would not allow; approve is still approval.replay; reject still releases the quote. Time-expired wins. The store stays pending. A qte_ quote includes derived status (live | expired | spent | held). Expired includes a lapsed FX validUntil and, for a hire quote, a dead parent RFQ. An FX quote is a window on the quote, not the room. A rfq_ room includes derived status (live | expired). A mid_ intent includes derived status (live | expired | funded). Funded is escrow-moved occupancy against this slip and wins over expired. Expired includes a dead parent intent even when this child's exp still lives. A child hire does not occupy the parent. A mid_ cart includes derived status (live | expired | bound). Bound is unique_payment occupancy and wins over expired. A mid_ payment includes derived status (live | expired | funded). Funded is escrow-moved occupancy and wins over expired. Expired includes a dead parent cart even when this check's exp still lives. A dlg_ hop includes derived status (live | expired | revoked) and pins an iss_ issuer object. An iss_ issuer is shape-only (adapter shape, live false). Credentials never enter evaluate(). An hsb_ host subscription includes derived status (live | expired). Expired includes a dead intent and a dead parent intent. Unique_subscriber still occupies. Spend is not gated on the row. An inv_ invoice includes derived status (current | lapsed).",
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
            name: "aether_host_invoice",
            description: "Record that a human paid this hosted operator off-band (invoice or Stripe). Not a Command. Not a spend gate. Public kernel refuses. Named speaker must sign.",
            inputSchema: {
              type: "object",
              properties: {
                ...ACTOR_PROPERTIES,
                method: { type: "string", description: "invoice or stripe" },
                reference: { type: "string" },
              },
              required: ["method"],
            },
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
              text: JSON.stringify(this.runtime.discoveryCard()),
            },
          ],
        };
      }
      if (uri === "aether://commands") {
        return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(commandBodies) }] };
      }
      const objectUri = uri?.match(
        /^aether:\/\/(?:object|hire|intent|receipt|approval|agent|quote|rfq|delegation|subscription|invoice|cart|payment)\/(.+)$/,
      );
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
    if (name === "aether_demo_clearing") {
      const report = runClearingWindow(loadClearingWindow("fixtures/demo/clearing-window/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_refund") {
      const report = runRefund(loadRefund("fixtures/demo/refund/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_replay") {
      const report = runReplay(loadReplay("fixtures/demo/replay/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_nonce") {
      const report = runNonce(loadNonce("fixtures/demo/nonce/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_deny") {
      const report = runDenyCache(loadDenyCache("fixtures/demo/deny-cache/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_recurrence") {
      const report = runRecurrence(loadRecurrence("fixtures/demo/recurrence/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_calendar") {
      const report = runCalendar(loadCalendar("fixtures/demo/calendar/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_slot") {
      const report = runSlot(loadSlot("fixtures/demo/slot/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_daily") {
      const report = runDaily(loadDaily("fixtures/demo/daily/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_cart") {
      const report = runCartOccupancy(loadCartOccupancy("fixtures/demo/cart/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_velocity") {
      const report = runVelocity(loadVelocity("fixtures/demo/velocity/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_door") {
      const report = runDoor(loadDoor("fixtures/demo/door/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_match") {
      const report = runCartMatch(loadCartMatch("fixtures/demo/match/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_room") {
      const report = runClosedRoom(loadClosedRoom("fixtures/demo/room/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_conversion") {
      const report = runConversion(loadConversion("fixtures/demo/conversion/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_pair") {
      const report = runUniqueLive(loadUniqueLive("fixtures/demo/pair/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_band") {
      const report = runSpreadBound(loadSpreadBound("fixtures/demo/band/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_nest") {
      const report = runParentFresh(loadParentFresh("fixtures/demo/nest/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_heir") {
      const report = runMandateParent(loadMandateParent("fixtures/demo/heir/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_stock") {
      const report = runMmInventory(loadMmInventory("fixtures/demo/stock/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_purse") {
      const report = runPaymentBudget(loadPaymentBudget("fixtures/demo/purse/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_seat") {
      const report = runHostUnique(loadHostUnique("fixtures/demo/seat/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_cover") {
      const report = runParentBudget(loadParentBudget("fixtures/demo/cover/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_mint") {
      const report = runOperatingBook(loadOperatingBook("fixtures/demo/mint/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_payee") {
      const report = runPaymentPayees(loadPaymentPayees("fixtures/demo/payee/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_climb") {
      const report = runCapabilitySubset(loadCapabilitySubset("fixtures/demo/climb/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_born") {
      const report = runFxFresh(loadFxFresh("fixtures/demo/born/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_reach") {
      const report = runWindowReach(loadWindowReach("fixtures/demo/reach/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_year") {
      const report = runKyaWindow(loadKyaWindow("fixtures/demo/year/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_fuse") {
      const report = runCircuitDaily(loadCircuitDaily("fixtures/demo/fuse/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_sku") {
      const report = runPaymentSkus(loadPaymentSkus("fixtures/demo/sku/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_priced") {
      const report = runSkuCurrency(loadSkuCurrency("fixtures/demo/priced/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_party") {
      const report = runHireParty(loadHireParty("fixtures/demo/party/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_cash") {
      const report = runLedgerSufficient(loadLedgerSufficient("fixtures/demo/cash/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_stale") {
      const report = runNotExpired(loadNotExpired("fixtures/demo/stale/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_chain") {
      const report = runChainIntegrity(loadChainIntegrity("fixtures/demo/chain/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_arrow") {
      const report = runHireState(loadHireState("fixtures/demo/arrow/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_wallet") {
      const report = runLedgerKnown(loadLedgerKnown("fixtures/demo/wallet/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_name") {
      const report = runKyaParty(loadKyaParty("fixtures/demo/name/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_pane") {
      const report = runFxWindow(loadFxWindow("fixtures/demo/pane/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_subject") {
      const report = runIntentSubject(loadIntentSubject("fixtures/demo/subject/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_paper") {
      const report = runFxQuote(loadFxQuote("fixtures/demo/paper/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_mix") {
      const report = runSameCurrency(loadSameCurrency("fixtures/demo/mix/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_rung") {
      const report = runLadderLegal(loadLadderLegal("fixtures/demo/rung/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_grade") {
      const report = runMinLevel(loadMinLevel("fixtures/demo/grade/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_cradle") {
      const report = runBirthRung(loadBirthRung("fixtures/demo/cradle/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_ceiling") {
      const report = runMaxAutonomy(loadMaxAutonomy("fixtures/demo/ceiling/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_lapse") {
      const report = runAttestationFresh(loadAttestationFresh("fixtures/demo/lapse/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_pause") {
      const report = runApprovalPending(loadApprovalPending("fixtures/demo/pause/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_mirror") {
      const report = runKyaNotSelf(loadKyaNotSelf("fixtures/demo/mirror/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_warrant") {
      const report = runHostAuthority(loadHostAuthority("fixtures/demo/warrant/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_vacant") {
      const report = runOccurrenceFresh(loadOccurrenceFresh("fixtures/demo/vacant/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_badge") {
      const report = runRoleCapability(loadRoleCapability("fixtures/demo/badge/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_lid") {
      const report = runAmountRange(loadAmountRange("fixtures/demo/lid/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_bare") {
      const report = runEscrowRequired(loadEscrowRequired("fixtures/demo/bare/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_demo_shelf") {
      const report = runKnownSku(loadKnownSku("fixtures/demo/shelf/scenario.json"));
      this.runtime = report.runtime;
      return { ok: report.ok, results: report.results, tldr: report.snapshot.tldr };
    }
    if (name === "aether_host_invoice") {
      const { actor, actorId, speakerProof, method, reference } = args;
      const invoiceBody: Record<string, unknown> = { method };
      if (typeof reference === "string" && reference.length > 0) invoiceBody.reference = reference;
      const admitted = admitInvoice(this.runtime, {
        actor,
        actorId,
        body: invoiceBody,
        ...(typeof speakerProof === "string" && speakerProof.length > 0 ? { proof: speakerProof } : {}),
      });
      if (!admitted.ok) {
        return { ok: false, error: admitted.error, remediation: null };
      }
      if (admitted.actorId === "system") {
        return { ok: false, error: { title: "Speaker proof required", status: 401 }, remediation: null };
      }
      const invoiced = this.runtime.recordHostInvoice(admitted.actorId, invoiceBody);
      if (!invoiced.ok) return { ok: false, error: invoiced.error, remediation: null };
      return { ok: true, data: invoiced.value };
    }
    const type = COMMAND_BY_TOOL.get(name);
    if (!type) throw new Error(`unknown tool ${name}`);
    const { actor, actorId, idempotencyKey, speakerProof, ...body } = args;
    const key = typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : undefined;
    const admitted = admitSpeaker(this.runtime, {
      type,
      actor,
      actorId,
      body,
      ...(key ? { idempotencyKey: key } : {}),
      ...(typeof speakerProof === "string" && speakerProof.length > 0 ? { proof: speakerProof } : {}),
    });
    if (!admitted.ok) {
      return { ok: false, error: admitted.error, remediation: null };
    }
    return serializeDispatch(
      this.runtime.dispatch(cmd(type, admitted.actorId, body, key)),
      this.runtime,
      type,
    );
  }
}

export { catalog as MCP_TOOL_CATALOG };
