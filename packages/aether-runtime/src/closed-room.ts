import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { ROOM_TLDR, analog } from "./story.js";
import { mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ClosedRoomScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface ClosedRoomReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadClosedRoom(path: string): ClosedRoomScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ClosedRoomScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runClosedRoom(scenario: ClosedRoomScenario): ClosedRoomReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = ROOM_TLDR;
  rt.analogDoc = analog();
  const must = mustDispatch;

  must(
    rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    ),
    "register founder",
  );
  const founder = rt.alias("ops-human");

  const roster = [
    { key: "treasury", displayName: "Treasury", role: "treasury", autonomyLevel: 3 },
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "research-vendor", displayName: "Research Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "other-vendor", displayName: "Other Vendor", role: "data_vendor", autonomyLevel: 2 },
    { key: "auditor", displayName: "Auditor", role: "auditor", autonomyLevel: 0 },
  ] as const;

  for (const a of roster) {
    must(
      rt.dispatch(
        cmd("identity.register", founder.id, {
          key: a.key,
          displayName: a.displayName,
          role: a.role,
          autonomyLevel: a.autonomyLevel,
        }),
      ),
      `register ${a.key}`,
    );
  }

  rt.seedOpening(scenario.opening);

  const desk = rt.alias("desk");
  const vendor = rt.alias("research-vendor");
  const other = rt.alias("other-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const price = scenario.quotes.once!;

  const payees: MandateConstraint = {
    type: "payment.allowed_payees",
    allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
  };

  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.intent.task,
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "intent",
  );
  const intentId = (intent.data as { payload: { id: MandateId } }).payload.id;

  must(
    rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "desk:cash",
        amount: scenario.allocation,
      }),
    ),
    "fund desk",
  );

  const closed = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "a named guest list is a closed room",
        invitedSellerIds: [vendor.id],
      }),
    ),
    "closed rfq",
  );
  const closedId = (closed.data as { id: string }).id;
  const quotesBeforeSneak = rt.quotes.size;

  const sneak = rt.dispatch(
    cmd("market.quote", other.id, {
      rfqId: closedId,
      price,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "market.invited_seller"),
    quotes: rt.quotes.size,
  };

  const invited = must(
    rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId: closedId,
        price,
      }),
    ),
    "invited quote",
  );
  const invitedQuoteId = (invited.data as { id: string }).id;

  const hired = must(
    rt.dispatch(cmd("hire.create", desk.id, { quoteId: invitedQuoteId, intentId })),
    "hire invited",
  );
  const hireId = (hired.data as { id: string }).id;
  const hiredAllow = hired.replayed !== true;

  const open = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "empty invite list is open",
        invitedSellerIds: [],
      }),
    ),
    "open rfq",
  );
  const openQuote = must(
    rt.dispatch(
      cmd("market.quote", other.id, {
        rfqId: (open.data as { id: string }).id,
        price,
      }),
    ),
    "open quote",
  );
  const openQuoteId = (openQuote.data as { id: string }).id;

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterSneak.denied && afterSneak.quotes === quotesBeforeSneak,
      1,
      "uninvited quote on a closed room is market.invited_seller",
      closedId,
    ),
    expect(
      hiredAllow && (hired.data as { sellerId: string }).sellerId === vendor.id && rt.hires.size === 1,
      2,
      "invited seller quotes and hire.create allows",
      hireId,
    ),
    expect(rt.consumedQuotes.has(invitedQuoteId) && !rt.consumedQuotes.has(openQuoteId), 3, "the deny did not consume a quote"),
    expect(
      (openQuote.data as { sellerId: string }).sellerId === other.id && rt.quotes.size === 2,
      4,
      "empty invite list is open — the outsider may quote",
      openQuoteId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
