import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { PRICED_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface SkuCurrencyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  sneak: { amount: number; currency: "USDC_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface SkuCurrencyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadSkuCurrency(path: string): SkuCurrencyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as SkuCurrencyScenario;
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

export function runSkuCurrency(scenario: SkuCurrencyScenario): SkuCurrencyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = PRICED_TLDR;
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
  const legalPrice = scenario.quotes.legal!;

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

  const rfq = must(
    rt.dispatch(
      cmd("market.rfq", desk.id, {
        sku: "research.brief",
        spec: "a listed SKU is only priced in a currency the catalog names",
        invitedSellerIds: [vendor.id],
      }),
    ),
    "rfq",
  );
  const rfqId = (rfq.data as { id: string }).id;
  const quotesBeforeSneak = rt.quotes.size;

  const sneak = rt.dispatch(
    cmd("market.quote", vendor.id, {
      rfqId,
      price: { amount: scenario.sneak.amount, currency: scenario.sneak.currency },
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "market.sku_currency"),
    knownAllows: allowedRule(sneak, "market.known_sku"),
    rfqAllows: allowedRule(sneak, "market.known_rfq"),
    pairAllows: allowedRule(sneak, "market.fx_pair"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    quotes: rt.quotes.size,
  };

  const quoted = must(
    rt.dispatch(
      cmd("market.quote", vendor.id, {
        rfqId,
        price: legalPrice,
      }),
    ),
    "usd quote",
  );
  const quoteId = (quoted.data as { id: string }).id;

  const hired = must(rt.dispatch(cmd("hire.create", desk.id, { quoteId, intentId })), "hire listed currency");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: legalPrice.amount,
  });
  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after priced deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after priced deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      afterSneak.denied &&
        afterSneak.knownAllows &&
        afterSneak.rfqAllows &&
        afterSneak.pairAllows &&
        afterSneak.firstDeny === "market.sku_currency" &&
        afterSneak.quotes === quotesBeforeSneak,
      1,
      "USDC on a USD-only SKU is market.sku_currency — not a missing SKU, not a missing room, not an FX pair",
      rfqId,
    ),
    expect(
      quoted.replayed !== true && rt.quotes.size === 1,
      2,
      "a USD quote still writes — the deny did not occupy the room",
      quoteId,
    ),
    expect(released && rt.hires.size === 1, 3, "that funded work still releases after the currency refuses", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 4, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
