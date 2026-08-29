import { readFileSync } from "node:fs";
import { hopStatus } from "@aether/kya";
import type { AgentId, MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { MIRROR_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface KyaNotSelfScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  grant: { maxAutonomy: number };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface KyaNotSelfReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadKyaNotSelf(path: string): KyaNotSelfScenario {
  return JSON.parse(readFileSync(path, "utf8")) as KyaNotSelfScenario;
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

export function runKyaNotSelf(scenario: KyaNotSelfScenario): KyaNotSelfReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = MIRROR_TLDR;
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
    spec: "a handshake is not a mirror",
    price,
    intentId,
  });
  const hired = must(live.attempt, "hire listed seller");
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
  const hopsBeforeSneak = liveHops(rt, founder.id, founder.id).length;
  const deskHopsBeforeSneak = liveHops(rt, founder.id, desk.id).length;
  const sizeBeforeSneak = rt.kya.attestations.size;

  const sneak = rt.dispatch(
    cmd("kya.attest", founder.id, {
      delegateId: founder.id,
      principalId: founder.id,
      maxAutonomy: scenario.grant.maxAutonomy,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "kya.not_self"),
    partyAllows: allowedRule(sneak, "kya.party"),
    pairAllows: allowedRule(sneak, "kya.unique_live"),
    climbAllows: allowedRule(sneak, "kya.capability_subset"),
    freshAllows: allowedRule(sneak, "kya.mint_fresh"),
    knownAllows: allowedRule(sneak, "identity.known"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    hops: liveHops(rt, founder.id, founder.id).length,
    deskHops: liveHops(rt, founder.id, desk.id).length,
    size: rt.kya.attestations.size,
  };

  const minted = must(
    rt.dispatch(
      cmd("kya.attest", founder.id, {
        delegateId: desk.id,
        maxAutonomy: scenario.grant.maxAutonomy,
      }),
    ),
    "founder still mints a real pair",
  );
  const deskHopId = (minted.data as { id: string }).id;

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after mirror deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after mirror deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        hopsBeforeSneak === 0 &&
        deskHopsBeforeSneak === 0 &&
        sizeBeforeSneak === 0,
      1,
      "a listed seller still funds a hire with no handshake written yet",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.partyAllows &&
        afterSneak.pairAllows &&
        afterSneak.climbAllows &&
        afterSneak.freshAllows &&
        afterSneak.knownAllows &&
        afterSneak.roleAllows &&
        afterSneak.firstDeny === "kya.not_self" &&
        afterSneak.hops === hopsBeforeSneak &&
        afterSneak.deskHops === deskHopsBeforeSneak &&
        afterSneak.size === sizeBeforeSneak,
      2,
      "attesting yourself is kya.not_self — not someone else's name, not a second hop, not a corpse mint",
    ),
    expect(
      minted.replayed !== true &&
        liveHops(rt, founder.id, desk.id).length === 1 &&
        liveHops(rt, founder.id, founder.id).length === 0,
      3,
      "the founder still mints a real pair — the deny did not write a mirror hop",
      deskHopId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the mirror refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
