import { readFileSync } from "node:fs";
import type { JournalEntry, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { BRIM_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface SafeBalanceScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface SafeBalanceReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadSafeBalance(path: string): SafeBalanceScenario {
  return JSON.parse(readFileSync(path, "utf8")) as SafeBalanceScenario;
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

/** Restore still applies historical journals without the post() gate so old worlds boot. A new post does not. */
function fillDestCeiling(rt: Runtime, name: string): void {
  const dest = rt.ledger.account(name);
  const equity = rt.ledger.account("system:equity");
  const already = rt.ledger.balance(dest.id);
  const extra: JournalEntry = {
    id: "jnl_01J6AETHEROVERFLOWSETUP00081" as JournalEntry["id"],
    timestamp: rt.clock.now(),
    description: "fixture: dest already at MAX_SAFE_INTEGER",
    lines: [
      { accountId: dest.id, debit: Number.MAX_SAFE_INTEGER - already, credit: 0 },
      { accountId: equity.id, debit: 0, credit: Number.MAX_SAFE_INTEGER - already },
    ],
  };
  rt.ledger.restore([...rt.ledger.accounts.values()], [...rt.ledger.entries, extra]);
  rt.journals.push(extra);
}

export function runSafeBalance(scenario: SafeBalanceScenario): SafeBalanceReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = BRIM_TLDR;
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

  const first = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "ieee rounding is not a mint",
    price: firstPrice,
    intentId,
  });
  const hired = must(first.attempt, "hire before brim");
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

  fillDestCeiling(rt, "desk:cash");
  const destBefore = rt.ledger.balanceByName("desk:cash").amount;
  const treasuryBefore = rt.ledger.balanceByName("treasury:cash").amount;
  const vendorBefore = rt.ledger.balanceByName("research-vendor:cash").amount;
  const journalsBefore = rt.ledger.entries.length;

  const sneak = rt.dispatch(
    cmd("ledger.transfer", treasury.id, {
      fromAccount: "treasury:cash",
      toAccount: "desk:cash",
      amount: { amount: 1, currency: "USD_SIM" },
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "ledger.safe_balance"),
    cashAllows: allowedRule(sneak, "ledger.sufficient"),
    mixAllows: allowedRule(sneak, "ledger.same_currency"),
    knownAllows: allowedRule(sneak, "ledger.known_account"),
    mintAllows: allowedRule(sneak, "ledger.operating_book"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    dest: rt.ledger.balanceByName("desk:cash").amount,
    treasury: rt.ledger.balanceByName("treasury:cash").amount,
    journals: rt.ledger.entries.length,
  };

  const penny = must(
    rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "research-vendor:cash",
        amount: { amount: 1, currency: "USD_SIM" },
      }),
    ),
    "penny after brim deny",
  );
  const afterPenny = {
    posted: penny.replayed !== true,
    vendor: rt.ledger.balanceByName("research-vendor:cash").amount,
    desk: rt.ledger.balanceByName("desk:cash").amount,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after brim deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after brim deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(hired.replayed !== true && fundedState === "funded", 1, "the first human still sits after an $800 hire funds", hireId),
    expect(
      afterSneak.denied &&
        afterSneak.cashAllows &&
        afterSneak.mixAllows &&
        afterSneak.knownAllows &&
        afterSneak.mintAllows &&
        afterSneak.roleAllows &&
        afterSneak.firstDeny === "ledger.safe_balance" &&
        afterSneak.dest === destBefore &&
        afterSneak.dest === Number.MAX_SAFE_INTEGER &&
        afterSneak.treasury === treasuryBefore &&
        afterSneak.journals === journalsBefore,
      2,
      "one more cent into a book at the integer ceiling is ledger.safe_balance — empty cash is not this deny, a missing dest is not this deny, a mixed journal is not this deny, a mint is not this deny",
      "treasury:cash → desk:cash",
    ),
    expect(
      afterPenny.posted && afterPenny.vendor === vendorBefore + 1 && afterPenny.desk === Number.MAX_SAFE_INTEGER,
      3,
      "a penny still posts to a book that can hold it — the ceiling did not occupy the rail",
      "treasury:cash → research-vendor:cash",
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the ceiling is refused", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
