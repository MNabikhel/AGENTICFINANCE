import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { WRIT_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface KnownIntentScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  sneakIntentId: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface KnownIntentReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadKnownIntent(path: string): KnownIntentScenario {
  return JSON.parse(readFileSync(path, "utf8")) as KnownIntentScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

function allowedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  const decision = attempt.ok ? attempt.value.decision : attempt.error.decision;
  return decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "allow") === true;
}

export function runKnownIntent(scenario: KnownIntentScenario): KnownIntentReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = WRIT_TLDR;
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
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const firstPrice = scenario.quotes.first!;
  const sneakPrice = scenario.quotes.sneak!;

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

  const live = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a live slip still hires",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire from a live slip");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const hiresBeforeSneak = rt.hires.size;
  const quotesBeforeSneak = rt.quotes.size;

  const invited = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a ghost slip is not this quote",
    price: sneakPrice,
  });
  const sneak = rt.dispatch(
    cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId: scenario.sneakIntentId }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.known_intent"),
    chainAllows: allowedRule(sneak, "kya.chain_intact"),
    parentAllows: allowedRule(sneak, "kya.known_parent"),
    roomAllows: allowedRule(sneak, "market.known_rfq"),
    unspentAllows: allowedRule(sneak, "hire.quote_unspent"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    liveAllows: allowedRule(sneak, "actor.not_frozen"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    hires: rt.hires.size,
    quotes: rt.quotes.size,
    sneakUnspent: !rt.consumedQuotes.has(invited.quoteId),
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after ghost slip deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after ghost slip deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && hiresBeforeSneak === 1 && quotesBeforeSneak === 1,
      1,
      "a live slip still funds a hire",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.chainAllows &&
        afterSneak.parentAllows &&
        afterSneak.roomAllows &&
        afterSneak.unspentAllows &&
        afterSneak.roleAllows &&
        afterSneak.liveAllows &&
        afterSneak.firstDeny === "mandate.known_intent" &&
        afterSneak.hires === 1 &&
        afterSneak.quotes === 2 &&
        afterSneak.sneakUnspent,
      2,
      "hire on a ghost slip is mandate.known_intent — a missing handshake is not this deny",
      scenario.sneakIntentId,
    ),
    expect(released && rt.hires.get(hireId)?.state === "released", 3, "that funded work still releases after the ghost hire is refused", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
