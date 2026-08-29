import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId, ReceiptId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { NIL_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface ReceiptKnownScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  sneakReceiptId: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface ReceiptKnownReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadReceiptKnown(path: string): ReceiptKnownScenario {
  return JSON.parse(readFileSync(path, "utf8")) as ReceiptKnownScenario;
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

export function runReceiptKnown(scenario: ReceiptKnownScenario): ReceiptKnownReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = NIL_TLDR;
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

  const live = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "a missing receipt still pays",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire before ghost receipt");
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
  const receiptsBeforeSneak = rt.receipts.size;

  const sneak = rt.dispatch(
    cmd("receipt.get", founder.id, { receiptId: scenario.sneakReceiptId as ReceiptId }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "receipt.known"),
    speakerAllows: allowedRule(sneak, "actor.known"),
    targetAllows: allowedRule(sneak, "identity.known"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    scopeAllows: allowedRule(sneak, "actor.system_scope"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    receipts: rt.receipts.size,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after ghost receipt deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after ghost receipt deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";
  const liveReceipt = [...rt.receipts.values()][0];
  const liveRead = liveReceipt
    ? rt.dispatch(cmd("receipt.get", founder.id, { receiptId: liveReceipt.id }))
    : undefined;

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && receiptsBeforeSneak === 0,
      1,
      "the first human still sits after an $800 hire funds",
      founder.id,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.speakerAllows &&
        afterSneak.targetAllows &&
        afterSneak.roleAllows &&
        afterSneak.scopeAllows &&
        afterSneak.firstDeny === "receipt.known" &&
        afterSneak.receipts === 0,
      2,
      "fetching a missing receipt is receipt.known — a missing speaker is not this deny, a missing named target is not this deny",
      scenario.sneakReceiptId,
    ),
    expect(
      released &&
        rt.hires.get(hireId)?.state === "released" &&
        liveRead?.ok === true,
      3,
      "that funded work still releases after the missing receipt is refused, and the live receipt still fetches",
      hireId,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
