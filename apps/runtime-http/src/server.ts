import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeRequired, encodeResponse } from "@aether/envelope";
import {
  Runtime,
  admitSpeaker,
  admitInvoice,
  cmd,
  parseHostedMonthly,
  speakerKeyOf,
  type DispatchResult,
} from "@aether/runtime";
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
import { loadKnownRfq, runKnownRfq } from "@aether/known-rfq";
import { loadKnownIntent, runKnownIntent } from "@aether/known-intent";
import { loadKnownCart, runKnownCart } from "@aether/known-cart";
import { loadKnownHire, runKnownHire } from "@aether/known-hire";
import { loadKnownParent, runKnownParent } from "@aether/known-parent";
import { loadKnownApproval, runKnownApproval } from "@aether/known-approval";
import { loadKyaKnownParent, runKyaKnownParent } from "@aether/kya-known-parent";
import { loadKnownAttestation, runKnownAttestation } from "@aether/known-attestation";
import { loadKnownInvitee, runKnownInvitee } from "@aether/known-invitee";
import { loadCartFresh, runCartFresh } from "@aether/cart-fresh";
import { loadFreezeState, runFreezeState } from "@aether/freeze-state";
import { loadUniqueKey, runUniqueKey } from "@aether/unique-key";
import { loadSystemScope, runSystemScope } from "@aether/system-scope";
import { loadActorKnown, runActorKnown } from "@aether/actor-known";
import { loadReceiptKnown, runReceiptKnown } from "@aether/receipt-known";
import { loadKyaMintFresh, runKyaMintFresh } from "@aether/kya-mint-fresh";
import { loadWindowFresh, runWindowFresh } from "@aether/window-fresh";
import { loadMmKnown, runMmKnown } from "@aether/mm-known";
import { loadCurrencyMatch, runCurrencyMatch } from "@aether/currency-match";
import { loadSafeBalance, runSafeBalance } from "@aether/safe-balance";
import { loadFxPair, runFxPair } from "@aether/fx-pair";
import { loadApprovalReplay, runApprovalReplay } from "@aether/approval-replay";
import { loadChainIntact, runChainIntact } from "@aether/chain-intact";
import { loadPrincipalNotFrozen, runPrincipalNotFrozen } from "@aether/principal-not-frozen";
import { loadAllowedInstruments, runAllowedInstruments } from "@aether/allowed-instruments";
import { loadHumanSignature, runHumanSignature } from "@aether/human-signature";
import { loadDelegationDepth, runDelegationDepth } from "@aether/delegation-depth";
import { loadPaymentReference, runPaymentReference } from "@aether/payment-reference";
import { loadIdentityParty, runIdentityParty } from "@aether/identity-party";
import { loadHireVoid, runHireVoid } from "@aether/hire-void";
import { loadMarketParty, runMarketParty } from "@aether/market-party";
import { loadMandateParty, runMandateParty } from "@aether/mandate-party";
import { loadRfqParty, runRfqParty } from "@aether/rfq-party";
import { loadCartParty, runCartParty } from "@aether/cart-party";
import { loadPaymentParty, runPaymentParty } from "@aether/payment-party";
import { type AgentId, type CommandType } from "@aether/types";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "../public");
const fixture = join(process.cwd(), "fixtures/demo/sprint-procurement/scenario.json");
const nightWatchFixture = join(process.cwd(), "fixtures/demo/night-watch/scenario.json");
const subHireFixture = join(process.cwd(), "fixtures/demo/sub-hire/scenario.json");
const clearingFixture = join(process.cwd(), "fixtures/demo/clearing-window/scenario.json");
const refundFixture = join(process.cwd(), "fixtures/demo/refund/scenario.json");
const replayFixture = join(process.cwd(), "fixtures/demo/replay/scenario.json");
const nonceFixture = join(process.cwd(), "fixtures/demo/nonce/scenario.json");
const denyCacheFixture = join(process.cwd(), "fixtures/demo/deny-cache/scenario.json");
const recurrenceFixture = join(process.cwd(), "fixtures/demo/recurrence/scenario.json");
const calendarFixture = join(process.cwd(), "fixtures/demo/calendar/scenario.json");
const slotFixture = join(process.cwd(), "fixtures/demo/slot/scenario.json");
const dailyFixture = join(process.cwd(), "fixtures/demo/daily/scenario.json");
const cartFixture = join(process.cwd(), "fixtures/demo/cart/scenario.json");
const velocityFixture = join(process.cwd(), "fixtures/demo/velocity/scenario.json");
const doorFixture = join(process.cwd(), "fixtures/demo/door/scenario.json");
const matchFixture = join(process.cwd(), "fixtures/demo/match/scenario.json");
const roomFixture = join(process.cwd(), "fixtures/demo/room/scenario.json");
const conversionFixture = join(process.cwd(), "fixtures/demo/conversion/scenario.json");
const pairFixture = join(process.cwd(), "fixtures/demo/pair/scenario.json");
const bandFixture = join(process.cwd(), "fixtures/demo/band/scenario.json");
const nestFixture = join(process.cwd(), "fixtures/demo/nest/scenario.json");
const heirFixture = join(process.cwd(), "fixtures/demo/heir/scenario.json");
const stockFixture = join(process.cwd(), "fixtures/demo/stock/scenario.json");
const purseFixture = join(process.cwd(), "fixtures/demo/purse/scenario.json");
const seatFixture = join(process.cwd(), "fixtures/demo/seat/scenario.json");
const coverFixture = join(process.cwd(), "fixtures/demo/cover/scenario.json");
const mintFixture = join(process.cwd(), "fixtures/demo/mint/scenario.json");
const payeeFixture = join(process.cwd(), "fixtures/demo/payee/scenario.json");
const climbFixture = join(process.cwd(), "fixtures/demo/climb/scenario.json");
const bornFixture = join(process.cwd(), "fixtures/demo/born/scenario.json");
const reachFixture = join(process.cwd(), "fixtures/demo/reach/scenario.json");
const yearFixture = join(process.cwd(), "fixtures/demo/year/scenario.json");
const fuseFixture = join(process.cwd(), "fixtures/demo/fuse/scenario.json");
const skuFixture = join(process.cwd(), "fixtures/demo/sku/scenario.json");
const pricedFixture = join(process.cwd(), "fixtures/demo/priced/scenario.json");
const partyFixture = join(process.cwd(), "fixtures/demo/party/scenario.json");
const cashFixture = join(process.cwd(), "fixtures/demo/cash/scenario.json");
const staleFixture = join(process.cwd(), "fixtures/demo/stale/scenario.json");
const chainFixture = join(process.cwd(), "fixtures/demo/chain/scenario.json");
const arrowFixture = join(process.cwd(), "fixtures/demo/arrow/scenario.json");
const walletFixture = join(process.cwd(), "fixtures/demo/wallet/scenario.json");
const nameFixture = join(process.cwd(), "fixtures/demo/name/scenario.json");
const paneFixture = join(process.cwd(), "fixtures/demo/pane/scenario.json");
const subjectFixture = join(process.cwd(), "fixtures/demo/subject/scenario.json");
const paperFixture = join(process.cwd(), "fixtures/demo/paper/scenario.json");
const mixFixture = join(process.cwd(), "fixtures/demo/mix/scenario.json");
const rungFixture = join(process.cwd(), "fixtures/demo/rung/scenario.json");
const gradeFixture = join(process.cwd(), "fixtures/demo/grade/scenario.json");
const cradleFixture = join(process.cwd(), "fixtures/demo/cradle/scenario.json");
const ceilingFixture = join(process.cwd(), "fixtures/demo/ceiling/scenario.json");
const lapseFixture = join(process.cwd(), "fixtures/demo/lapse/scenario.json");
const pauseFixture = join(process.cwd(), "fixtures/demo/pause/scenario.json");
const mirrorFixture = join(process.cwd(), "fixtures/demo/mirror/scenario.json");
const warrantFixture = join(process.cwd(), "fixtures/demo/warrant/scenario.json");
const vacantFixture = join(process.cwd(), "fixtures/demo/vacant/scenario.json");
const badgeFixture = join(process.cwd(), "fixtures/demo/badge/scenario.json");
const lidFixture = join(process.cwd(), "fixtures/demo/lid/scenario.json");
const bareFixture = join(process.cwd(), "fixtures/demo/bare/scenario.json");
const shelfFixture = join(process.cwd(), "fixtures/demo/shelf/scenario.json");
const hallFixture = join(process.cwd(), "fixtures/demo/hall/scenario.json");
const writFixture = join(process.cwd(), "fixtures/demo/writ/scenario.json");
const crateFixture = join(process.cwd(), "fixtures/demo/crate/scenario.json");
const pactFixture = join(process.cwd(), "fixtures/demo/pact/scenario.json");
const rootFixture = join(process.cwd(), "fixtures/demo/root/scenario.json");
const docketFixture = join(process.cwd(), "fixtures/demo/docket/scenario.json");
const graftFixture = join(process.cwd(), "fixtures/demo/graft/scenario.json");
const sealFixture = join(process.cwd(), "fixtures/demo/seal/scenario.json");
const guestFixture = join(process.cwd(), "fixtures/demo/guest/scenario.json");
const dustFixture = join(process.cwd(), "fixtures/demo/dust/scenario.json");
const thawFixture = join(process.cwd(), "fixtures/demo/thaw/scenario.json");
const twinFixture = join(process.cwd(), "fixtures/demo/twin/scenario.json");
const fenceFixture = join(process.cwd(), "fixtures/demo/fence/scenario.json");
const muteFixture = join(process.cwd(), "fixtures/demo/mute/scenario.json");
const nilFixture = join(process.cwd(), "fixtures/demo/nil/scenario.json");
const sparkFixture = join(process.cwd(), "fixtures/demo/spark/scenario.json");
const wiltFixture = join(process.cwd(), "fixtures/demo/wilt/scenario.json");
const makerFixture = join(process.cwd(), "fixtures/demo/maker/scenario.json");
const inkFixture = join(process.cwd(), "fixtures/demo/ink/scenario.json");
const brimFixture = join(process.cwd(), "fixtures/demo/brim/scenario.json");
const swapFixture = join(process.cwd(), "fixtures/demo/swap/scenario.json");
const sourFixture = join(process.cwd(), "fixtures/demo/sour/scenario.json");
const cutFixture = join(process.cwd(), "fixtures/demo/cut/scenario.json");
const iceFixture = join(process.cwd(), "fixtures/demo/ice/scenario.json");
const railFixture = join(process.cwd(), "fixtures/demo/rail/scenario.json");
const penFixture = join(process.cwd(), "fixtures/demo/pen/scenario.json");
const wellFixture = join(process.cwd(), "fixtures/demo/well/scenario.json");
const citeFixture = join(process.cwd(), "fixtures/demo/cite/scenario.json");
const lockFixture = join(process.cwd(), "fixtures/demo/lock/scenario.json");
const voidFixture = join(process.cwd(), "fixtures/demo/void/scenario.json");
const foldFixture = join(process.cwd(), "fixtures/demo/fold/scenario.json");
const ripFixture = join(process.cwd(), "fixtures/demo/rip/scenario.json");
const shutFixture = join(process.cwd(), "fixtures/demo/shut/scenario.json");
const dumpFixture = join(process.cwd(), "fixtures/demo/dump/scenario.json");
const spikeFixture = join(process.cwd(), "fixtures/demo/spike/scenario.json");

let runtime = boot();
let lastDemo: unknown = null;

function boot(): Runtime {
  const dir = process.env.AETHER_DATA_DIR;
  const hostedEnv = process.env.AETHER_HOSTED;
  const hosted =
    hostedEnv === "true" || hostedEnv === "1"
      ? true
      : hostedEnv === "false" || hostedEnv === "0"
        ? false
        : undefined;
  const hostedMonthly = parseHostedMonthly(process.env.AETHER_HOSTED_MONTHLY);
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESIS0000000001",
    dailyLimit: 10_000_000,
    ...(dir && dir.length > 0 ? { dataDir: dir } : {}),
    ...(hosted !== undefined ? { hosted } : {}),
    ...(hosted === true && hostedMonthly !== undefined ? { hostedMonthly } : {}),
  });
}

const commandSchemaPath = join(process.cwd(), "schemas/commands.schema.json");
const commandBodies = (
  JSON.parse(readFileSync(commandSchemaPath, "utf8")) as { commands: Record<string, unknown> }
).commands;

function isCommandType(v: unknown): v is CommandType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(commandBodies, v);
}

function json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, payment-signature, payment-required, aether-signature, aether-actor",
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

function proofOf(req: IncomingMessage, body: Record<string, unknown>): string | undefined {
  const header = req.headers["aether-signature"];
  if (typeof header === "string" && header.length > 0) return header;
  if (typeof body.speakerProof === "string" && body.speakerProof.length > 0) return body.speakerProof;
  return undefined;
}

function dispatchJson(type: CommandType, reqBody: Record<string, unknown>, actorId: AgentId | "system"): DispatchResult {
  const { actorId: _a, actor: _b, idempotencyKey, speakerProof: _p, type: _t, ...body } = reqBody;
  const key = typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : undefined;
  return runtime.dispatch(cmd(type, actorId, body, key));
}

function attachSpeakerKey(type: CommandType, result: DispatchResult): DispatchResult {
  if (type !== "identity.register" || !runtime.hosted || !result.ok) return result;
  const data = result.value.data as { id: string };
  const speakerKey = speakerKeyOf(runtime, data.id as AgentId);
  if (!speakerKey) return result;
  return { ok: true, value: { ...result.value, data: { ...data, speakerKey } } };
}

function paymentHeaders(type: CommandType): (r: DispatchResult) => Record<string, string> | undefined {
  return (r) => {
    if (!r.ok) return undefined;
    if (type === "envelope.require") {
      return { "PAYMENT-REQUIRED": encodeRequired(r.value.data as never) };
    }
    if (type === "envelope.submit") {
      const settlement = (r.value.data as { settlement?: Parameters<typeof encodeResponse>[0] }).settlement;
      return settlement ? { "PAYMENT-RESPONSE": encodeResponse(settlement) } : undefined;
    }
    return undefined;
  };
}

function handleDispatch(
  req: IncomingMessage,
  res: ServerResponse,
  type: CommandType,
  reqBody: Record<string, unknown>,
  extra?: (r: DispatchResult) => Record<string, string> | undefined,
) {
  const { actorId: _a, actor: _b, idempotencyKey, speakerProof: _p, type: _t, ...body } = reqBody;
  const key = typeof idempotencyKey === "string" && idempotencyKey.length > 0 ? idempotencyKey : undefined;
  const admitted = admitSpeaker(runtime, {
    type,
    actor: reqBody.actor,
    actorId: reqBody.actorId,
    body,
    ...(key ? { idempotencyKey: key } : {}),
    ...(proofOf(req, reqBody) ? { proof: proofOf(req, reqBody) } : {}),
  });
  if (!admitted.ok) {
    json(res, admitted.error.status, { ...admitted.error });
    return;
  }
  const result = attachSpeakerKey(type, dispatchJson(type, reqBody, admitted.actorId));
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
          "access-control-allow-headers": "content-type, payment-signature, aether-signature, aether-actor",
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
        handleDispatch(req, res, "audit.query", { ...q, actor: "system" });
        return;
      }
      if (req.method === "GET" && path === "/v1/audit/verify") {
        handleDispatch(req, res, "audit.verify", { actor: "system" });
        return;
      }
      if (req.method === "GET" && path === "/v1/commands") {
        json(res, 200, JSON.parse(readFileSync(commandSchemaPath, "utf8")));
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
        const host = req.headers.host;
        const base =
          typeof host === "string" && host.length > 0 ? `http://${host}` : "http://127.0.0.1:8787";
        json(res, 200, runtime.discoveryCard(base));
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
      if (req.method === "POST" && path === "/v1/demo/clearing") {
        const report = runClearingWindow(loadClearingWindow(clearingFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "clearing" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/refund") {
        const report = runRefund(loadRefund(refundFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "refund" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/replay") {
        const report = runReplay(loadReplay(replayFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "replay" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/nonce") {
        const report = runNonce(loadNonce(nonceFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "nonce" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/deny") {
        const report = runDenyCache(loadDenyCache(denyCacheFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "deny" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/recurrence") {
        const report = runRecurrence(loadRecurrence(recurrenceFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "recurrence" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/calendar") {
        const report = runCalendar(loadCalendar(calendarFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "calendar" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/slot") {
        const report = runSlot(loadSlot(slotFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "slot" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/daily") {
        const report = runDaily(loadDaily(dailyFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "daily" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/cart") {
        const report = runCartOccupancy(loadCartOccupancy(cartFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "cart" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/velocity") {
        const report = runVelocity(loadVelocity(velocityFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "velocity" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/door") {
        const report = runDoor(loadDoor(doorFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "door" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/match") {
        const report = runCartMatch(loadCartMatch(matchFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "match" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/room") {
        const report = runClosedRoom(loadClosedRoom(roomFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "room" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/conversion") {
        const report = runConversion(loadConversion(conversionFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "conversion" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/pair") {
        const report = runUniqueLive(loadUniqueLive(pairFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "pair" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/band") {
        const report = runSpreadBound(loadSpreadBound(bandFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "band" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/nest") {
        const report = runParentFresh(loadParentFresh(nestFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "nest" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/heir") {
        const report = runMandateParent(loadMandateParent(heirFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "heir" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/stock") {
        const report = runMmInventory(loadMmInventory(stockFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "stock" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/purse") {
        const report = runPaymentBudget(loadPaymentBudget(purseFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "purse" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/seat") {
        const report = runHostUnique(loadHostUnique(seatFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "seat" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/cover") {
        const report = runParentBudget(loadParentBudget(coverFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "cover" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/mint") {
        const report = runOperatingBook(loadOperatingBook(mintFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "mint" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/payee") {
        const report = runPaymentPayees(loadPaymentPayees(payeeFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "payee" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/climb") {
        const report = runCapabilitySubset(loadCapabilitySubset(climbFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "climb" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/born") {
        const report = runFxFresh(loadFxFresh(bornFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "born" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/reach") {
        const report = runWindowReach(loadWindowReach(reachFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "reach" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/year") {
        const report = runKyaWindow(loadKyaWindow(yearFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "year" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/fuse") {
        const report = runCircuitDaily(loadCircuitDaily(fuseFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "fuse" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/sku") {
        const report = runPaymentSkus(loadPaymentSkus(skuFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "sku" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/priced") {
        const report = runSkuCurrency(loadSkuCurrency(pricedFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "priced" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/party") {
        const report = runHireParty(loadHireParty(partyFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "party" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/cash") {
        const report = runLedgerSufficient(loadLedgerSufficient(cashFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "cash" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/stale") {
        const report = runNotExpired(loadNotExpired(staleFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "stale" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/chain") {
        const report = runChainIntegrity(loadChainIntegrity(chainFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "chain" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/arrow") {
        const report = runHireState(loadHireState(arrowFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "arrow" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/wallet") {
        const report = runLedgerKnown(loadLedgerKnown(walletFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "wallet" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/name") {
        const report = runKyaParty(loadKyaParty(nameFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "name" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/pane") {
        const report = runFxWindow(loadFxWindow(paneFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "pane" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/subject") {
        const report = runIntentSubject(loadIntentSubject(subjectFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "subject" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/paper") {
        const report = runFxQuote(loadFxQuote(paperFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "paper" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/mix") {
        const report = runSameCurrency(loadSameCurrency(mixFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "mix" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/rung") {
        const report = runLadderLegal(loadLadderLegal(rungFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "rung" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/grade") {
        const report = runMinLevel(loadMinLevel(gradeFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "grade" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/cradle") {
        const report = runBirthRung(loadBirthRung(cradleFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "cradle" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/ceiling") {
        const report = runMaxAutonomy(loadMaxAutonomy(ceilingFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "ceiling" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/lapse") {
        const report = runAttestationFresh(loadAttestationFresh(lapseFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "lapse" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/pause") {
        const report = runApprovalPending(loadApprovalPending(pauseFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "pause" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/mirror") {
        const report = runKyaNotSelf(loadKyaNotSelf(mirrorFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "mirror" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/warrant") {
        const report = runHostAuthority(loadHostAuthority(warrantFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "warrant" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/vacant") {
        const report = runOccurrenceFresh(loadOccurrenceFresh(vacantFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "vacant" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/badge") {
        const report = runRoleCapability(loadRoleCapability(badgeFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "badge" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/lid") {
        const report = runAmountRange(loadAmountRange(lidFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "lid" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/bare") {
        const report = runEscrowRequired(loadEscrowRequired(bareFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "bare" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/shelf") {
        const report = runKnownSku(loadKnownSku(shelfFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "shelf" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/hall") {
        const report = runKnownRfq(loadKnownRfq(hallFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "hall" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/writ") {
        const report = runKnownIntent(loadKnownIntent(writFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "writ" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/crate") {
        const report = runKnownCart(loadKnownCart(crateFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "crate" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/pact") {
        const report = runKnownHire(loadKnownHire(pactFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "pact" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/root") {
        const report = runKnownParent(loadKnownParent(rootFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "root" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/docket") {
        const report = runKnownApproval(loadKnownApproval(docketFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "docket" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/graft") {
        const report = runKyaKnownParent(loadKyaKnownParent(graftFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "graft" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/seal") {
        const report = runKnownAttestation(loadKnownAttestation(sealFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "seal" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/guest") {
        const report = runKnownInvitee(loadKnownInvitee(guestFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "guest" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/dust") {
        const report = runCartFresh(loadCartFresh(dustFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "dust" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/thaw") {
        const report = runFreezeState(loadFreezeState(thawFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "thaw" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/twin") {
        const report = runUniqueKey(loadUniqueKey(twinFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "twin" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/fence") {
        const report = runSystemScope(loadSystemScope(fenceFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "fence" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/mute") {
        const report = runActorKnown(loadActorKnown(muteFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "mute" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/nil") {
        const report = runReceiptKnown(loadReceiptKnown(nilFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "nil" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/spark") {
        const report = runKyaMintFresh(loadKyaMintFresh(sparkFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "spark" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/wilt") {
        const report = runWindowFresh(loadWindowFresh(wiltFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "wilt" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/maker") {
        const report = runMmKnown(loadMmKnown(makerFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "maker" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/ink") {
        const report = runCurrencyMatch(loadCurrencyMatch(inkFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "ink" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/brim") {
        const report = runSafeBalance(loadSafeBalance(brimFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "brim" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/swap") {
        const report = runFxPair(loadFxPair(swapFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "swap" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/sour") {
        const report = runApprovalReplay(loadApprovalReplay(sourFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "sour" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/cut") {
        const report = runChainIntact(loadChainIntact(cutFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "cut" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/ice") {
        const report = runPrincipalNotFrozen(loadPrincipalNotFrozen(iceFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "ice" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/rail") {
        const report = runAllowedInstruments(loadAllowedInstruments(railFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "rail" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/pen") {
        const report = runHumanSignature(loadHumanSignature(penFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "pen" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/well") {
        const report = runDelegationDepth(loadDelegationDepth(wellFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "well" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/cite") {
        const report = runPaymentReference(loadPaymentReference(citeFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "cite" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/lock") {
        const report = runIdentityParty(loadIdentityParty(lockFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "lock" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/void") {
        const report = runHireVoid(loadHireVoid(voidFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "void" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/fold") {
        const report = runMarketParty(loadMarketParty(foldFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "fold" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/rip") {
        const report = runMandateParty(loadMandateParty(ripFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "rip" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/shut") {
        const report = runRfqParty(loadRfqParty(shutFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "shut" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/dump") {
        const report = runCartParty(loadCartParty(dumpFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "dump" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/demo/spike") {
        const report = runPaymentParty(loadPaymentParty(spikeFixture));
        runtime = report.runtime;
        lastDemo = { ok: report.ok, results: report.results, snapshot: report.snapshot, demo: "spike" };
        json(res, report.ok ? 200 : 500, lastDemo);
        return;
      }
      if (req.method === "POST" && path === "/v1/reset") {
        runtime = boot();
        lastDemo = null;
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && (path === "/openapi.yaml" || path === "/openapi.json")) {
        const specPath = join(process.cwd(), "packages/aether-openapi/openapi.yaml");
        const document = readFileSync(specPath, "utf8");
        if (path === "/openapi.yaml") {
          res.writeHead(200, {
            "content-type": "application/yaml; charset=utf-8",
            "access-control-allow-origin": "*",
          });
          res.end(document);
          return;
        }
        json(res, 200, { format: "yaml", document });
        return;
      }

      const bodyText = req.method === "POST" ? await readBody(req) : "{}";
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};

      if (req.method === "POST" && path === "/v1/host/invoice") {
        const { actorId: _ia, actor: _ib, idempotencyKey: _ik, speakerProof: _ip, ...invoiceBody } = body;
        const admitted = admitInvoice(runtime, {
          actor: body.actor,
          actorId: body.actorId,
          body: invoiceBody,
          ...(proofOf(req, body) ? { proof: proofOf(req, body) } : {}),
        });
        if (!admitted.ok) {
          json(res, admitted.error.status, { ...admitted.error });
          return;
        }
        if (admitted.actorId === "system") {
          json(res, 401, { title: "Speaker proof required" });
          return;
        }
        const invoiced = runtime.recordHostInvoice(admitted.actorId, invoiceBody);
        if (!invoiced.ok) {
          json(res, invoiced.error.status, { ...invoiced.error });
          return;
        }
        json(res, 200, { kind: "allow", data: invoiced.value });
        return;
      }

      if (req.method === "POST" && path === "/v1/commands") {
        if (!isCommandType(body.type)) {
          json(res, 400, {
            type: "https://aether.dev/errors/command.malformed",
            title: "Malformed command",
            status: 400,
            detail: typeof body.type === "string" ? `unknown command type ${body.type}` : "missing command type",
            instance: "command.malformed",
          });
          return;
        }
        handleDispatch(req, res, body.type, body, paymentHeaders(body.type));
        return;
      }

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
        "/v1/fx/settle": "market.fx_settle",
        "/v1/ledger/transfers": "ledger.transfer",
      };

      if (req.method === "POST" && routes[path]) {
        const type = routes[path]!;
        handleDispatch(req, res, type, body, paymentHeaders(type));
        return;
      }

      const hireAccept = path.match(/^\/v1\/hires\/([^/]+)\/accept$/);
      if (req.method === "POST" && hireAccept) {
        handleDispatch(req, res, "hire.accept", { ...body, hireId: hireAccept[1] });
        return;
      }
      const hireFund = path.match(/^\/v1\/hires\/([^/]+)\/fund$/);
      if (req.method === "POST" && hireFund) {
        handleDispatch(req, res, "hire.fund", { ...body, hireId: hireFund[1] });
        return;
      }
      const hireDeliver = path.match(/^\/v1\/hires\/([^/]+)\/deliver$/);
      if (req.method === "POST" && hireDeliver) {
        handleDispatch(req, res, "hire.deliver", { ...body, hireId: hireDeliver[1] });
        return;
      }
      const hireRelease = path.match(/^\/v1\/hires\/([^/]+)\/release$/);
      if (req.method === "POST" && hireRelease) {
        handleDispatch(req, res, "hire.release", { ...body, hireId: hireRelease[1] });
        return;
      }
      const hireRefund = path.match(/^\/v1\/hires\/([^/]+)\/refund$/);
      if (req.method === "POST" && hireRefund) {
        handleDispatch(req, res, "hire.refund", { ...body, hireId: hireRefund[1] });
        return;
      }
      const hireVoid = path.match(/^\/v1\/hires\/([^/]+)\/void$/);
      if (req.method === "POST" && hireVoid) {
        handleDispatch(req, res, "hire.void", { ...body, hireId: hireVoid[1] });
        return;
      }
      const quoteWithdraw = path.match(/^\/v1\/quotes\/([^/]+)\/withdraw$/);
      if (req.method === "POST" && quoteWithdraw) {
        handleDispatch(req, res, "market.withdraw", { ...body, quoteId: quoteWithdraw[1] });
        return;
      }
      const rfqClose = path.match(/^\/v1\/rfqs\/([^/]+)\/close$/);
      if (req.method === "POST" && rfqClose) {
        handleDispatch(req, res, "market.close", { ...body, rfqId: rfqClose[1] });
        return;
      }
      const mandateRevoke = path.match(/^\/v1\/mandates\/([^/]+)\/revoke$/);
      if (req.method === "POST" && mandateRevoke) {
        handleDispatch(req, res, "mandate.revoke", { ...body, intentId: mandateRevoke[1] });
        return;
      }
      const cartDump = path.match(/^\/v1\/carts\/([^/]+)\/dump$/);
      if (req.method === "POST" && cartDump) {
        handleDispatch(req, res, "mandate.revoke_cart", { ...body, cartId: cartDump[1] });
        return;
      }
      const paymentSpike = path.match(/^\/v1\/checks\/([^/]+)\/spike$/);
      if (req.method === "POST" && paymentSpike) {
        handleDispatch(req, res, "mandate.revoke_payment", { ...body, paymentId: paymentSpike[1] });
        return;
      }
      const approval = path.match(/^\/v1\/approvals\/([^/]+)\/resolve$/);
      if (req.method === "POST" && approval) {
        handleDispatch(req, res, "approval.resolve", { ...body, approvalId: approval[1] });
        return;
      }
      const autonomy = path.match(/^\/v1\/agents\/([^/]+)\/autonomy$/);
      if (req.method === "POST" && autonomy) {
        handleDispatch(req, res, "ladder.set", { ...body, agentId: autonomy[1] });
        return;
      }
      const freeze = path.match(/^\/v1\/agents\/([^/]+)\/freeze$/);
      if (req.method === "POST" && freeze) {
        handleDispatch(req, res, "identity.freeze", { ...body, agentId: freeze[1] });
        return;
      }
      const unfreeze = path.match(/^\/v1\/agents\/([^/]+)\/unfreeze$/);
      if (req.method === "POST" && unfreeze) {
        handleDispatch(req, res, "identity.unfreeze", { ...body, agentId: unfreeze[1] });
        return;
      }
      const rotate = path.match(/^\/v1\/agents\/([^/]+)\/rotate$/);
      if (req.method === "POST" && rotate) {
        handleDispatch(req, res, "identity.rotate", { ...body, agentId: rotate[1] });
        return;
      }
      const account = path.match(/^\/v1\/accounts\/([^/]+)$/);
      if (req.method === "GET" && account) {
        handleDispatch(req, res, "ledger.balances", { name: decodeURIComponent(account[1]!), actor: "system" });
        return;
      }
      const receipt = path.match(/^\/v1\/receipts\/([^/]+)$/);
      if (req.method === "GET" && receipt) {
        handleDispatch(req, res, "receipt.get", { receiptId: receipt[1], actor: "system" });
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

if (!process.env.VITEST) start();
