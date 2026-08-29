import { readFileSync } from "node:fs";
import { hopStatus } from "@aether/kya";
import type { AgentId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { SPARK_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface KyaMintFreshScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  grant: { maxAutonomy: number };
  deadExpiresAt: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface KyaMintFreshReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadKyaMintFresh(path: string): KyaMintFreshScenario {
  return JSON.parse(readFileSync(path, "utf8")) as KyaMintFreshScenario;
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

function liveHops(rt: Runtime, principalId: AgentId, delegateId: AgentId) {
  const now = rt.clock.now();
  return [...rt.kya.attestations.values()].filter(
    (a) => a.principalId === principalId && a.delegateId === delegateId && hopStatus(a, now) === "live",
  );
}

export function runKyaMintFresh(scenario: KyaMintFreshScenario): KyaMintFreshReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = SPARK_TLDR;
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
    spec: "a handshake cannot be born dead",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire before corpse mint");
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
  const hopsBeforeSneak = liveHops(rt, founder.id, desk.id).length;
  const sizeBeforeSneak = rt.kya.attestations.size;

  const sneak = rt.dispatch(
    cmd("kya.attest", founder.id, {
      delegateId: desk.id,
      maxAutonomy: scenario.grant.maxAutonomy,
      expiresAt: scenario.deadExpiresAt,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "kya.mint_fresh"),
    windowAllows: allowedRule(sneak, "kya.mint_window"),
    pairAllows: allowedRule(sneak, "kya.unique_live"),
    selfAllows: allowedRule(sneak, "kya.not_self"),
    knownAllows: allowedRule(sneak, "identity.known"),
    partyAllows: allowedRule(sneak, "kya.party"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    hops: liveHops(rt, founder.id, desk.id).length,
    size: rt.kya.attestations.size,
  };

  const reached = must(
    rt.dispatch(
      cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: scenario.grant.maxAutonomy }),
    ),
    "one-year desk hop",
  );
  const deskHopId = (reached.data as { id: string }).id;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after spark deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after spark deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && hopsBeforeSneak === 0 && sizeBeforeSneak === 0,
      1,
      "the first human still sits after an $800 hire funds with no handshake yet",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.windowAllows &&
        afterSneak.pairAllows &&
        afterSneak.selfAllows &&
        afterSneak.knownAllows &&
        afterSneak.partyAllows &&
        afterSneak.firstDeny === "kya.mint_fresh" &&
        afterSneak.hops === hopsBeforeSneak &&
        afterSneak.size === 0,
      2,
      "a handshake born expired is kya.mint_fresh — a century mint is not this deny, a second live hop is not this deny",
      scenario.deadExpiresAt,
    ),
    expect(
      reached.replayed !== true && liveHops(rt, founder.id, desk.id).length === 1,
      3,
      "a one-year hop still mints — the deny did not occupy the pair",
      deskHopId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the corpse mint is refused", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
