import { readFileSync } from "node:fs";
import { PROTOCOL, type MandateConstraint, type MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { WARRANT_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface HostAuthorityScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  sneak: { task: string };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface HostAuthorityReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadHostAuthority(path: string): HostAuthorityScenario {
  return JSON.parse(readFileSync(path, "utf8")) as HostAuthorityScenario;
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

export function runHostAuthority(scenario: HostAuthorityScenario): HostAuthorityReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
    hosted: true,
  });
  rt.tldr = WARRANT_TLDR;
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
    { key: "scout", displayName: "Scout", role: "procurement", autonomyLevel: 4 },
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
  const scout = rt.alias("scout");
  const vendor = rt.alias("research-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const price = scenario.quotes.hire!;

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
    "desk intent",
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
    spec: "an agent-issued slip is not host authority",
    price,
    intentId,
  });
  const hired = must(live.attempt, "hire without a subscribe row");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: price.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const sizeBeforeSneak = rt.subscriptions.size;

  const sneakIntent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", scout.id, {
        subjectId: scout.id,
        task: scenario.sneak.task,
        constraints: [{ type: "payment.amount_range", currency: "USD_SIM", max: 100 }],
      }),
    ),
    "agent-issued slip",
  );
  const sneakIntentId = (sneakIntent.data as { payload: { id: MandateId } }).payload.id;
  const sneak = rt.dispatch(cmd("host.subscribe", scout.id, { intentId: sneakIntentId }));
  const afterSneak = {
    denied: deniedRule(sneak, "host.human_authority"),
    hostedAllows: allowedRule(sneak, "host.not_hosted"),
    knownAllows: allowedRule(sneak, "mandate.known_intent"),
    freshAllows: allowedRule(sneak, "mandate.not_expired"),
    subjectAllows: allowedRule(sneak, "mandate.subject_is_actor"),
    seatAllows: allowedRule(sneak, "host.unique_subscriber"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    size: rt.subscriptions.size,
    funded: rt.hires.get(hireId)?.state,
    publicPin: PROTOCOL.hosted,
    hostedCard: rt.protocolCard().hosted,
  };

  const seated = must(rt.dispatch(cmd("host.subscribe", desk.id, { intentId })), "human-issued seat");
  const rowId = (seated.data as { id: string }).id;
  const afterSeat = {
    size: rt.subscriptions.size,
    rowId,
    subscriber: [...rt.subscriptions.values()][0]?.subscriberId,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after warrant deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after warrant deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        sizeBeforeSneak === 0 &&
        afterSneak.publicPin === false &&
        afterSneak.hostedCard === true,
      1,
      "spend is not gated on a subscribe row — PROTOCOL.hosted stays false",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.hostedAllows &&
        afterSneak.knownAllows &&
        afterSneak.freshAllows &&
        afterSneak.subjectAllows &&
        afterSneak.seatAllows &&
        afterSneak.firstDeny === "host.human_authority" &&
        afterSneak.size === sizeBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "subscribe on an agent-issued slip is host.human_authority — not a missing seat, not the public kernel",
      sneakIntentId,
    ),
    expect(
      seated.replayed !== true &&
        afterSeat.rowId.startsWith("hsb_") &&
        afterSeat.size === 1 &&
        afterSeat.subscriber === desk.id,
      3,
      "a human-issued slip still seats — the deny did not occupy the row",
      rowId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the warrant refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
