import { readFileSync } from "node:fs";
import type { MandateConstraint, MandateId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { FORGE_TLDR, analog } from "./story.js";
import { fundHire, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface RootPartyScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface RootPartyReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadRootParty(path: string): RootPartyScenario {
  return JSON.parse(readFileSync(path, "utf8")) as RootPartyScenario;
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

export function runRootParty(scenario: RootPartyScenario): RootPartyReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = FORGE_TLDR;
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
    { key: "other-desk", displayName: "Other Desk", role: "procurement", autonomyLevel: 4 },
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
  const otherDesk = rt.alias("other-desk");
  const scout = rt.alias("scout");
  const vendor = rt.alias("research-vendor");
  const treasury = rt.alias("treasury");
  const auditor = rt.alias("auditor");
  const firstPrice = scenario.quotes.first!;

  must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 4 })), "kya desk");
  must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: otherDesk.id, maxAutonomy: 4 })), "kya other");
  must(rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, maxAutonomy: 3 })), "kya scout");

  const payees: MandateConstraint = {
    type: "payment.allowed_payees",
    allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
  };

  const hireIntent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: scenario.intent.task,
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "hire intent",
  );
  const hireIntentId = (hireIntent.data as { payload: { id: MandateId } }).payload.id;

  const parent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: desk.id,
        task: "Someone else's name is not a root slip to mint.",
        constraints: [...scenario.intent.constraints, payees],
      }),
    ),
    "unused parent",
  );
  const parentId = (parent.data as { payload: { id: MandateId } }).payload.id;

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
    spec: "someone else's name is not a root slip to mint",
    price: firstPrice,
    intentId: hireIntentId,
  });
  const hired = must(live.attempt, "hire listed seller");
  const hireId = (hired.data as { id: string }).id;
  fundHire(rt, {
    hireId,
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId: hireIntentId,
    qty: 1,
    unitAmount: firstPrice.amount,
  });
  const fundedState = rt.hires.get(hireId)?.state;
  const intentsBeforeSneak = rt.intents.size;

  const childConstraints: MandateConstraint[] = [
    { type: "payment.amount_range", currency: "USD_SIM", max: 100000 },
    { type: "aether.allowed_skus", allowed: ["research.brief"] },
    payees,
  ];
  const rootConstraints: MandateConstraint[] = [...scenario.intent.constraints, payees];

  const nested = rt.dispatch(
    cmd("mandate.issue_intent", otherDesk.id, {
      subjectId: otherDesk.id,
      parentId,
      task: "a nested child is not this deny",
      constraints: childConstraints,
    }),
  );
  const junior = rt.dispatch(
    cmd("mandate.issue_intent", scout.id, {
      subjectId: desk.id,
      task: "a junior root is not this deny",
      constraints: rootConstraints,
    }),
  );
  const vendorRoot = rt.dispatch(
    cmd("mandate.issue_intent", vendor.id, {
      subjectId: desk.id,
      task: "a vendor root is not this deny",
      constraints: rootConstraints,
    }),
  );
  const ghost = rt.dispatch(
    cmd("mandate.issue_intent", otherDesk.id, {
      subjectId: "aid_01J6AETHERGHOSTSUBJECT00001",
      task: "a missing subject is not this deny",
      constraints: rootConstraints,
    }),
  );
  const sneak = rt.dispatch(
    cmd("mandate.issue_intent", otherDesk.id, {
      subjectId: desk.id,
      task: "forge",
      constraints: rootConstraints,
    }),
  );
  const afterSneak = {
    denied: deniedRule(sneak, "mandate.root_party"),
    knownAllows: allowedRule(sneak, "identity.known"),
    childAllows: allowedRule(sneak, "mandate.child_party"),
    roleAllows: allowedRule(sneak, "actor.role_capability"),
    minAllows: allowedRule(sneak, "ladder.min_level"),
    firstDeny: sneak.ok ? undefined : sneak.error.decision?.remediation?.ruleId,
    intents: rt.intents.size,
    funded: rt.hires.get(hireId)?.state,
    nestedFirst: nested.ok ? undefined : nested.error.decision?.remediation?.ruleId,
    nestedRootAllows: allowedRule(nested, "mandate.root_party"),
    nestedChildDenies: deniedRule(nested, "mandate.child_party"),
    juniorFirst: junior.ok ? undefined : junior.error.decision?.remediation?.ruleId,
    juniorRootDenies: deniedRule(junior, "mandate.root_party"),
    vendorFirst: vendorRoot.ok ? undefined : vendorRoot.error.decision?.remediation?.ruleId,
    vendorRootDenies: deniedRule(vendorRoot, "mandate.root_party"),
    ghostFirst: ghost.ok ? undefined : ghost.error.decision?.remediation?.ruleId,
    ghostRootAllows: allowedRule(ghost, "mandate.root_party"),
  };

  const legalAttempt = rt.dispatch(
    cmd("mandate.issue_intent", desk.id, {
      subjectId: desk.id,
      task: "the named subject still mints a root in their own name",
      constraints: rootConstraints,
    }),
  );
  const legal = must(legalAttempt, "subject root");
  const rootId = (legal.data as { payload: { id: MandateId } }).payload.id;
  const afterLegal = {
    rootAllows: allowedRule(legalAttempt, "mandate.root_party"),
    intents: rt.intents.size,
    parentId: (legal.data as { payload: { parentId?: string } }).payload.parentId,
  };

  must(rt.dispatch(cmd("hire.deliver", vendor.id, { hireId, deliverable: { n: 1 } })), "deliver after forge deny");
  must(rt.dispatch(cmd("envelope.require", vendor.id, { hireId })), "require");
  must(
    rt.dispatch(cmd("envelope.submit", desk.id, { hireId, nonce: `nonce-${hireId}` })),
    "submit after forge deny",
  );
  const released = rt.hires.get(hireId)?.state === "released";

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      hired.replayed !== true && fundedState === "funded" && parentId.startsWith("mid_") && intentsBeforeSneak >= 2,
      1,
      "a listed seller still funds a hire, and a human-issued root still sits on the research desk",
      hireIntentId,
    ),
    expect(
      afterSneak.denied &&
        afterSneak.knownAllows &&
        afterSneak.childAllows &&
        afterSneak.roleAllows &&
        afterSneak.minAllows &&
        afterSneak.firstDeny === "mandate.root_party" &&
        afterSneak.intents === intentsBeforeSneak &&
        afterSneak.funded === "funded" &&
        afterSneak.nestedFirst === "mandate.child_party" &&
        afterSneak.nestedRootAllows &&
        afterSneak.nestedChildDenies &&
        afterSneak.juniorFirst === "ladder.min_level" &&
        afterSneak.juniorRootDenies &&
        afterSneak.vendorFirst === "actor.role_capability" &&
        afterSneak.vendorRootDenies &&
        afterSneak.ghostFirst === "identity.known" &&
        afterSneak.ghostRootAllows,
      2,
      "minting a root slip in someone else's name is mandate.root_party — not a missing subject, not a nested child, not a junior mint, not a vendor verb",
    ),
    expect(
      legal.replayed !== true &&
        afterLegal.rootAllows &&
        afterLegal.intents === intentsBeforeSneak + 1 &&
        afterLegal.parentId === undefined &&
        rootId.startsWith("mid_"),
      3,
      "the named subject still minted a root in their own name — the deny did not occupy the desk",
      rootId,
    ),
    expect(released && rt.hires.size === 1, 4, "that funded work still releases after the forge refuse", hireId),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
