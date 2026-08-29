import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { RIP_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface MandatePartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface MandatePartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadMandateParty(path: string): MandatePartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as MandatePartyScenario;
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

function revokeLines(rt: Runtime): number {
  return rt.audit.all().filter((e) => e.action === "MANDATE_REVOKE").length;
}

export function runMandateParty(scenario: MandatePartyScenario): MandatePartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = RIP_TLDR;
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
  const livePrice = scenario.quotes.live!;

  const payees: MandateConstraint = {
    type: "payment.allowed_payees",
    allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
  };
  const constraints = [...scenario.intent.constraints, payees];

  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.intent.task,
        constraints,
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
    spec: "someone else's unused slip is not yours to tear",
    price: firstPrice,
    intentId,
  });
  const hired = must(live.attempt, "hire before a stolen rip");
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

  const unused = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "a live unused slip still on the table",
        constraints,
      }),
    ),
    "unused slip",
  );
  const unusedId = (unused.data as { payload: { id: MandateId } }).payload.id;
  const beforeRip = revokeLines(rt);
  const liveBeforeSneak = rt.intentView(rt.intents.get(unusedId)!).status;

  const sneak = rt.dispatch(cmd("mandate.revoke", desk.id, { intentId: unusedId }));
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.party"),
    knownAllows: allowedRule(sneak, "mandate.known_intent"),
    freshAllows: allowedRule(sneak, "mandate.not_expired"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    status: rt.intentView(rt.intents.get(unusedId)!).status,
    rips: revokeLines(rt),
  };

  const ghost = rt.dispatch(
    cmd("mandate.revoke", desk.id, { intentId: "mid_01J6AETHERGHOSTINTENT00001" }),
  );

  const ripped = must(rt.dispatch(cmd("mandate.revoke", founder.id, { intentId: unusedId })), "founder rips own slip");
  const afterRip = rt.intentView(rt.intents.get(unusedId)!);

  const second = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "hiring a ripped unused slip",
    price: livePrice,
  });
  const reuse = rt.dispatch(cmd("hire.create", desk.id, { quoteId: second.quoteId, intentId: unusedId }));

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after rip TAP");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after rip TAP",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && liveBeforeSneak === "live",
      1,
      "the first human still sits after an $800 hire funds",
      founder.id,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownAllows &&
        afterSneak.freshAllows &&
        afterSneak.roleAllows &&
        afterSneak.firstDeny === "mandate.party" &&
        afterSneak.status === "live" &&
        afterSneak.rips === beforeRip,
      2,
      "a desk ripping the founder's unused slip is mandate.party",
      afterSneak.firstDeny,
    ),
    expect(
      deniedRule(ghost, "mandate.known_intent") &&
        allowedRule(ghost, "mandate.party") &&
        ripped.replayed !== true &&
        afterRip.status === "revoked" &&
        !("status" in (rt.intents.get(unusedId) ?? {})) &&
        deniedRule(reuse, "mandate.not_expired") &&
        allowedRule(reuse, "mandate.known_intent") &&
        !rt.revokedIntents.has(intentId),
      3,
      "the founder still rips its own unused slip; hiring that ripped slip is mandate.not_expired",
      reuse.ok ? undefined : reuse.error.decision?.remediation?.ruleId,
    ),
    expect(released && rt.hires.get(hireId)?.state === "released", 4, "that funded work still released"),
  ];

  return {
    ok: results.every((r) => r.ok),
    results,
    snapshot: snap,
    runtime: rt,
  };
}
