import { readFileSync } from "node:fs";
import type { HireId, MandateConstraint } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { NONCE_TLDR, analog } from "./story.js";
import { completeHire, fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface NonceScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface NonceReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadNonce(path: string): NonceScenario {
  return JSON.parse(readFileSync(path, "utf8")) as NonceScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runNonce(scenario: NonceScenario): NonceReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = NONCE_TLDR;
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
  const intentId = (intent.data as { payload: { id: string } }).payload.id;

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

  const first = completeHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "first settle",
    price: scenario.quotes.first!,
    intentId,
    qty: 1,
    deliverable: { n: 1 },
  });
  const stolen = `nonce-${first.hireId}`;
  const vendorAfterFirst = rt.ledger.balance(vendor.accountId);
  const firstRow = rt.hires.get(first.hireId as HireId);

  const offered = offerHire(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "second settle",
    price: scenario.quotes.second!,
    intentId,
  });
  const created = must(offered.attempt, "second hire");
  const hireId = (created.data as { id: string }).id as HireId;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: scenario.quotes.second!.amount,
  });
  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 2 } })), "deliver");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  const beforeReuse = rt.hires.get(hireId)?.state;
  const reuse = rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: stolen }));
  const afterReuse = rt.hires.get(hireId)?.state;
  const vendorAfterReuse = rt.ledger.balance(vendor.accountId);

  const leftover = rt.dispatch(
    cmd("ledger.transfer", treasury.id, {
      fromAccount: "desk:cash",
      toAccount: "research-vendor:cash",
      amount: { amount: 1, currency: "USD_SIM" },
      nonce: stolen,
    }),
  );
  const leftoverNonceAllow =
    leftover.ok && leftover.value.decision.trace.some((t) => t.ruleId === "idempotency.nonce" && t.verdict === "allow");

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      firstRow?.state === "released" && vendorAfterFirst === scenario.quotes.first!.amount && rt.nonces.has(stolen),
      1,
      "first envelope submit settles and occupies the nonce",
      `${firstRow?.state}/${vendorAfterFirst}`,
    ),
    expect(
      deniedRule(reuse, "idempotency.nonce") && beforeReuse === "delivered" && afterReuse === "delivered",
      2,
      "reusing that nonce on a second hire is idempotency.nonce",
    ),
    expect(
      vendorAfterReuse === vendorAfterFirst,
      3,
      "the second escrow does not release",
      String(vendorAfterReuse),
    ),
    expect(leftoverNonceAllow && leftover.ok === true, 4, "a leftover nonce on a transfer is not idempotency.nonce"),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
