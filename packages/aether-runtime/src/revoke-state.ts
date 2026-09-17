import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { TOMB_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface RevokeStateScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  ghostAttestationId: string;
  ghostAgentId: string;
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface RevokeStateReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadRevokeState(path: string): RevokeStateScenario {
  return JSON.parse(readFileSync(path, "utf8")) as RevokeStateScenario;
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

export function runRevokeState(scenario: RevokeStateScenario): RevokeStateReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = TOMB_TLDR;
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
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 4 },
    { key: "scout", displayName: "Scout", role: "procurement", autonomyLevel: 3 },
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
  const hirePrice = scenario.quotes.hire!;

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
    spec: "a tombstone is not a second tombstone",
    price: hirePrice,
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
    unitAmount: hirePrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;

  const hop = must(
    rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, maxAutonomy: 3 })),
    "scout handshake",
  );
  const hopId = (hop.data as { id: string }).id;
  const first = must(
    rt.dispatch(cmd("kya.revoke", founder.id, { attestationId: hopId })),
    "first tombstone",
  );
  const firstCount = (first.data as { revoked: unknown[] }).revoked.length;
  const deadAt = rt.kya.attestations.get(hopId as never)?.revokedAt;
  const blockedBeforeSneak = rt.kya.blocked.size;
  const hopsBeforeSneak = rt.kya.attestations.size;
  const tombstoneLines = () => rt.audit.all().filter((r) => r.action === "KYA_REVOKE").length;
  const tombstonesBeforeSneak = tombstoneLines();

  const tomb = rt.dispatch(cmd("kya.revoke", founder.id, { attestationId: hopId }));
  const pairSneak = rt.dispatch(cmd("kya.revoke", founder.id, { delegateId: scout.id }));
  const bare = rt.dispatch(cmd("kya.revoke", founder.id, {}));
  const ghostAtt = rt.dispatch(
    cmd("kya.revoke", founder.id, { attestationId: scenario.ghostAttestationId }),
  );
  const ghostDel = rt.dispatch(cmd("kya.revoke", founder.id, { delegateId: scenario.ghostAgentId }));
  const foreign = rt.dispatch(
    cmd("kya.revoke", desk.id, { principalId: founder.id, delegateId: scout.id }),
  );

  const afterSneak = {
    denied: deniedRule(tomb, "kya.revoke_state"),
    firstDeny: tomb.ok ? undefined : tomb.error.decision?.remediation?.ruleId,
    knownAllows: allowedRule(tomb, "kya.known_attestation"),
    partyAllows: allowedRule(tomb, "kya.party"),
    identityAllows: allowedRule(tomb, "identity.known"),
    roleAllows: allowedRule(tomb, "actor.role_capability"),
    pairFirst: pairSneak.ok ? undefined : pairSneak.error.decision?.remediation?.ruleId,
    bareFirst: bare.ok ? undefined : bare.error.decision?.remediation?.ruleId,
    ghostAttFirst: ghostAtt.ok ? undefined : ghostAtt.error.decision?.remediation?.ruleId,
    ghostAttStateAllows: allowedRule(ghostAtt, "kya.revoke_state"),
    ghostDelFirst: ghostDel.ok ? undefined : ghostDel.error.decision?.remediation?.ruleId,
    ghostDelStateAllows: allowedRule(ghostDel, "kya.revoke_state"),
    foreignFirst: foreign.ok ? undefined : foreign.error.decision?.remediation?.ruleId,
    foreignStateDenies: deniedRule(foreign, "kya.revoke_state"),
    deadAtUnchanged: rt.kya.attestations.get(hopId as never)?.revokedAt === deadAt,
    blocked: rt.kya.blocked.size,
    hops: rt.kya.attestations.size,
    tombstones: tombstoneLines(),
    funded: rt.hires.get(hireId)?.state,
  };

  const reAttestAttempt = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, maxAutonomy: 3 }));
  const reAttest = must(reAttestAttempt, "re-attest scout after tombstone");
  const freshHopId = (reAttest.data as { id: string }).id;
  const freshAttempt = rt.dispatch(cmd("kya.revoke", founder.id, { delegateId: scout.id }));
  const fresh = must(freshAttempt, "fresh tombstone still writes");
  const freshCount = (fresh.data as { revoked: unknown[] }).revoked.length;
  const blockedBeforePair = rt.kya.blocked.size;
  const pairBlockAttempt = rt.dispatch(cmd("kya.revoke", founder.id, { delegateId: treasury.id }));
  const pairBlock = must(pairBlockAttempt, "first pair-wide revoke still blocks");
  const pairBlockCount = (pairBlock.data as { revoked: unknown[] }).revoked.length;

  const afterLegal = {
    freshAllows: allowedRule(freshAttempt, "kya.revoke_state"),
    pairAllows: allowedRule(pairBlockAttempt, "kya.revoke_state"),
    blockedGrew: rt.kya.blocked.size === blockedBeforePair + 1,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after tomb deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after tomb deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true &&
        fundedState === "funded" &&
        firstCount === 1 &&
        deadAt !== undefined &&
        hopsBeforeSneak === 1 &&
        blockedBeforeSneak === 1,
      1,
      "a listed seller still funds a hire, and a first tombstone still writes",
      hopId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.firstDeny === "kya.revoke_state" &&
        afterSneak.knownAllows &&
        afterSneak.partyAllows &&
        afterSneak.identityAllows &&
        afterSneak.roleAllows &&
        afterSneak.pairFirst === "kya.revoke_state" &&
        afterSneak.bareFirst === "kya.revoke_state" &&
        afterSneak.ghostAttFirst === "kya.known_attestation" &&
        afterSneak.ghostAttStateAllows &&
        afterSneak.ghostDelFirst === "identity.known" &&
        afterSneak.ghostDelStateAllows &&
        afterSneak.foreignFirst === "kya.party" &&
        afterSneak.foreignStateDenies &&
        afterSneak.deadAtUnchanged &&
        afterSneak.blocked === blockedBeforeSneak &&
        afterSneak.hops === hopsBeforeSneak &&
        afterSneak.tombstones === tombstonesBeforeSneak &&
        afterSneak.funded === "funded",
      2,
      "a second tombstone is kya.revoke_state — not a ghost handshake, not a ghost agent, not someone else's name, not a first pair-wide revoke",
    ),
    expect(
      reAttest.replayed !== true &&
        freshHopId !== hopId &&
        freshCount === 1 &&
        pairBlockCount === 0 &&
        afterLegal.freshAllows &&
        afterLegal.pairAllows &&
        afterLegal.blockedGrew,
      3,
      "the founder still re-attested and revoked the fresh hop, and a first pair-wide revoke still blocked",
      freshHopId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the tomb refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
