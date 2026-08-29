import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { BADGE_TLDR, analog } from "./story.js";
import { fundHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface RoleCapabilityScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface RoleCapabilityReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadRoleCapability(path: string): RoleCapabilityScenario {
  return JSON.parse(readFileSync(path, "utf8")) as RoleCapabilityScenario;
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

export function runRoleCapability(scenario: RoleCapabilityScenario): RoleCapabilityReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = BADGE_TLDR;
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
    spec: "a badge is not a shopping pass",
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
  const sizeBeforeSneak = rt.hires.size;

  const sneakQuote = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "an auditor cannot hire",
    price,
  });
  const sneak = rt.dispatch(cmd("hire.create", auditor.id, { quoteId: sneakQuote.quoteId, intentId }));
  const afterSneak = {
    denied: deniedRule(sneak, "actor.role_capability"),
    freezeAllows: allowedRule(sneak, "actor.not_frozen"),
    knownAllows: allowedRule(sneak, "actor.known"),
    systemAllows: allowedRule(sneak, "actor.system_scope"),
    quoteAllows: allowedRule(sneak, "hire.quote_unspent"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    size: rt.hires.size,
    funded: rt.hires.get(hireId)?.state,
    consumed: rt.consumedQuotes.has(sneakQuote.quoteId),
  };

  const verifyAttempt = rt.dispatch(cmd("audit.verify", auditor.id, {}));
  const verified = must(verifyAttempt, "auditor still verifies");
  const afterVerify = {
    roleAllows: allowedRule(verifyAttempt, "actor.role_capability"),
    ok: (verified.data as { ok: boolean }).ok === true,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after badge deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after badge deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && sizeBeforeSneak === 1,
      1,
      "a listed seller still funds a hire before the auditor tries to shop",
      hireId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.freezeAllows &&
        afterSneak.knownAllows &&
        afterSneak.systemAllows &&
        afterSneak.quoteAllows &&
        afterSneak.firstDeny === "actor.role_capability" &&
        afterSneak.size === sizeBeforeSneak &&
        afterSneak.funded === "funded" &&
        afterSneak.consumed === false,
      2,
      "an auditor hire.create is actor.role_capability — not a freeze, not a missing speaker, not a spent quote",
      sneakQuote.quoteId,
    ),
    expect(
      verified.replayed !== true && afterVerify.roleAllows && afterVerify.ok && rt.audit.verify().ok,
      3,
      "the auditor still verifies the notary — the deny did not freeze the role",
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the badge refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
