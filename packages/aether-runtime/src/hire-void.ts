import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { VOID_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface HireVoidScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface HireVoidReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadHireVoid(path: string): HireVoidScenario {
  return JSON.parse(readFileSync(path, "utf8")) as HireVoidScenario;
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

function voidLines(rt: Runtime): number {
  return rt.audit.all().filter((e) => e.action === "HIRE_TRANSITION" && (e.payload as { state?: string }).state === "void")
    .length;
}

export function runHireVoid(scenario: HireVoidScenario): HireVoidReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = VOID_TLDR;
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
    spec: "a void is not a refund",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire before a funded void");
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
  const funded = rt.hires.get(hireId);
  const escrowBefore = funded ? rt.ledger.balance(funded.escrowAccountId) : -1;
  const voidsBeforeSneak = voidLines(rt);

  const sneak = rt.dispatch(cmd("hire.void", desk.id, { hireId }));
  const afterSneak = {
    denied: deniedRule(sneak, "hire.state"),
    partyAllows: allowedRule(sneak, "hire.party"),
    knownAllows: allowedRule(sneak, "hire.known"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    state: rt.hires.get(hireId)?.state,
    escrow: funded ? rt.ledger.balance(funded.escrowAccountId) : -1,
    voids: voidLines(rt),
  };

  const sneakOffer = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "unfunded offer to tear up",
    price: sneakPrice,
    intentId,
  });
  const offered = must(sneakOffer.attempt, "unfunded offer");
  const offeredId = (offered.data as { id: string }).id;
  const offeredQuote = sneakOffer.quoteId;
  const torn = must(rt.dispatch(cmd("hire.void", desk.id, { hireId: offeredId })), "void unfunded offer");
  const reuse = rt.dispatch(
    cmd("hire.create", desk.id, { quoteId: offeredQuote, intentId }, "void-reuse"),
  );

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after void TAP");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after funded void refused",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && funded?.state === "funded" && escrowBefore === firstPrice.amount,
      1,
      "the first human still sits after an $800 hire funds",
      founder.id,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.partyAllows &&
        afterSneak.knownAllows &&
        afterSneak.firstDeny === "hire.state" &&
        afterSneak.state === "funded" &&
        afterSneak.escrow === escrowBefore &&
        afterSneak.voids === voidsBeforeSneak,
      2,
      "voiding funded escrow is hire.state — the party still allows; a missing hire is not this deny",
      hireId,
    ),
    expect(
      released &&
        rt.hires.get(offeredId)?.state === "void" &&
        (torn.data as { state: string }).state === "void" &&
        rt.consumedQuotes.has(offeredQuote) &&
        reuse.ok === false &&
        deniedRule(reuse, "hire.quote_unspent") &&
        (reuse.ok ? undefined : reuse.error.decision?.remediation?.ruleId) === "hire.quote_unspent",
      3,
      "that funded work still releases after the funded void is refused, and an unfunded offer still voids without restoring the quote",
      offeredId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
