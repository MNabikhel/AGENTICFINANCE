import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { MINT_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface OperatingBookScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface OperatingBookReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadOperatingBook(path: string): OperatingBookScenario {
  return JSON.parse(readFileSync(path, "utf8")) as OperatingBookScenario;
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

export function runOperatingBook(scenario: OperatingBookScenario): OperatingBookReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = MINT_TLDR;
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

  const equityBefore = rt.ledger.balanceByName("system:equity").amount;
  const deskBeforeMint = rt.ledger.balanceByName("desk:cash").amount;
  const journalsBeforeMint = rt.journals.length;
  const mint = rt.dispatch(
    cmd("ledger.transfer", treasury.id, {
      fromAccount: "system:equity",
      toAccount: "desk:cash",
      amount: { amount: 1, currency: "USD_SIM" },
    }),
  );
  const afterMint = {
    denied: deniedRule(mint, "ledger.operating_book"),
    sufficientAllows: allowedRule(mint, "ledger.sufficient"),
    knownAllows: allowedRule(mint, "ledger.known_account"),
    firstDeny: mint.ok ? undefined : mint.error.decision?.remediation?.ruleId,
    equity: rt.ledger.balanceByName("system:equity").amount,
    desk: rt.ledger.balanceByName("desk:cash").amount,
    journals: rt.journals.length,
  };

  const live = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "operating cash still hires",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire after equity deny");
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
  const escrowName = `escrow:${hireId}`;
  const escrowBefore = rt.ledger.balanceByName(escrowName).amount;
  const treasuryBeforeLock = rt.ledger.balanceByName("treasury:cash").amount;
  const fundedState = rt.hires.get(hireId)?.state;

  const lock = rt.dispatch(
    cmd("ledger.transfer", treasury.id, {
      fromAccount: escrowName,
      toAccount: "treasury:cash",
      amount: { amount: firstPrice.amount, currency: "USD_SIM" },
    }),
  );
  const afterLock = {
    denied: deniedRule(lock, "ledger.operating_book"),
    sufficientAllows: allowedRule(lock, "ledger.sufficient"),
    firstDeny: lock.ok ? undefined : lock.error.decision?.remediation?.ruleId,
    escrow: rt.ledger.balanceByName(escrowName).amount,
    treasury: rt.ledger.balanceByName("treasury:cash").amount,
    hireState: rt.hires.get(hireId)?.state,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after operating-book deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after operating-book deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterMint.denied &&
        afterMint.sufficientAllows &&
        afterMint.knownAllows &&
        afterMint.firstDeny === "ledger.operating_book" &&
        afterMint.equity === equityBefore &&
        afterMint.desk === deskBeforeMint &&
        afterMint.journals === journalsBeforeMint,
      1,
      "transfer from equity is ledger.operating_book — not a mint",
      "system:equity",
    ),
    expect(
      hired.replayed !== true && fundedState === "funded" && escrowBefore === firstPrice.amount,
      2,
      "operating cash still funds a hire after the mint deny",
      hireId,
    ),
    expect(
      afterLock.denied &&
        afterLock.sufficientAllows &&
        afterLock.firstDeny === "ledger.operating_book" &&
        afterLock.escrow === escrowBefore &&
        afterLock.treasury === treasuryBeforeLock &&
        afterLock.hireState === "funded",
      3,
      "transfer from escrow is ledger.operating_book — not an allocation",
      escrowName,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the lock is refused", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
