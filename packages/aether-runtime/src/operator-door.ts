import { readFileSync } from "node:fs";
import { PROTOCOL, type MandateConstraint, type MandateId } from "@aether/types";
import { Runtime, admitSpeaker, cmd, signSpeaker } from "./index.js";
import { DOOR_TLDR, analog } from "./story.js";
import { mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface DoorScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  hostedNonce: string;
  hostedMonthly: number;
  circuit: { dailyLimit: number };
  intent: { task: string; constraints: MandateConstraint[] };
}

export interface DoorReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadDoor(path: string): DoorScenario {
  return JSON.parse(readFileSync(path, "utf8")) as DoorScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runDoor(scenario: DoorScenario): DoorReport {
  const publicRt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.hostedNonce,
    dailyLimit: scenario.circuit.dailyLimit,
    hosted: true,
    hostedMonthly: scenario.hostedMonthly,
  });
  rt.tldr = DOOR_TLDR;
  rt.analogDoc = analog();
  const must = mustDispatch;

  must(
    publicRt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    ),
    "public founder",
  );
  const publicFounder = publicRt.alias("ops-human");
  const publicIntent = must(
    publicRt.dispatch(
      cmd("mandate.issue_intent", publicFounder.id, {
        subjectId: publicFounder.id,
        task: scenario.intent.task,
        constraints: scenario.intent.constraints,
      }),
    ),
    "public intent",
  );
  const publicIntentId = (publicIntent.data as { payload: { id: MandateId } }).payload.id;
  const publicSub = publicRt.dispatch(cmd("host.subscribe", publicFounder.id, { intentId: publicIntentId }));
  const publicInvoice = publicRt.recordHostInvoice(publicFounder.id, { method: "invoice" });

  must(
    rt.dispatch(
      cmd("identity.register", "system", {
        key: "ops-human",
        displayName: "Founder",
        role: "human_operator",
        autonomyLevel: 0,
      }),
    ),
    "hosted founder",
  );
  const founder = rt.alias("ops-human");
  const kp = rt.identity.keys.get(founder.id);
  if (!kp) throw new Error("missing founder key");

  const intentBody = {
    subjectId: founder.id,
    task: scenario.intent.task,
    constraints: scenario.intent.constraints,
  };
  const unsigned = admitSpeaker(rt, {
    type: "mandate.issue_intent",
    actor: "ops-human",
    actorId: founder.id,
    body: intentBody,
  });
  const unpaid = admitSpeaker(rt, {
    type: "mandate.issue_intent",
    actorId: founder.id,
    body: intentBody,
    proof: signSpeaker(kp, { type: "mandate.issue_intent", actorId: founder.id, body: intentBody }),
  });

  const billed = rt.recordHostInvoice(founder.id, { method: "invoice" });
  const paid = admitSpeaker(rt, {
    type: "mandate.issue_intent",
    actorId: founder.id,
    body: intentBody,
    proof: signSpeaker(kp, { type: "mandate.issue_intent", actorId: founder.id, body: intentBody }),
  });
  const issued = must(rt.dispatch(cmd("mandate.issue_intent", founder.id, intentBody)), "hosted intent");
  const intentId = (issued.data as { payload: { id: MandateId } }).payload.id;
  const sub = must(rt.dispatch(cmd("host.subscribe", founder.id, { intentId })), "subscribe");
  const hireAttempt = rt.dispatch(cmd("hire.create", founder.id, { quoteId: "qte_ghost", intentId }));

  must(
    rt.dispatch(
      cmd("identity.register", founder.id, {
        key: "auditor",
        displayName: "Auditor",
        role: "auditor",
        autonomyLevel: 0,
      }),
    ),
    "auditor",
  );
  const auditor = rt.alias("auditor");
  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      PROTOCOL.hosted === false &&
        publicRt.protocolCard().hosted === false &&
        publicRt.protocolCard().pricing.hostedMonthly === null,
      1,
      "public pin stays unhosted",
    ),
    expect(
      deniedRule(publicSub, "host.not_hosted") && publicInvoice.ok === false,
      2,
      "public subscribe and invoice are host.not_hosted",
    ),
    expect(
      unsigned.ok === false && unsigned.error.status === 401 && unsigned.error.type.includes("speaker.proof"),
      3,
      "hosted unsigned named speaker is 401 speaker.proof",
    ),
    expect(
      unpaid.ok === false && unpaid.error.status === 402 && unpaid.error.type.includes("host.unpaid"),
      4,
      "hosted unpaid signed speaker is 402 host.unpaid",
    ),
    expect(
      billed.ok === true &&
        paid.ok === true &&
        (sub.data as { id: string }).id.startsWith("hsb_") &&
        rt.subscriptions.size === 1,
      5,
      "after invoice, subscribe records a row",
      (sub.data as { id: string }).id,
    ),
    expect(
      hireAttempt.ok === false &&
        hireAttempt.error.decision?.remediation?.ruleId !== "host.unique_subscriber" &&
        rt.subscriptions.size === 1,
      6,
      "spend is not gated on the subscribe row",
    ),
    expect(PROTOCOL.hosted === false && rt.protocolCard().hosted === true, 7, "PROTOCOL.hosted stays false"),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 8, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
