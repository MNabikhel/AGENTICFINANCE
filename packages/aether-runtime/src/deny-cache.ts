import { readFileSync } from "node:fs";
import type { MandateConstraint } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { DENY_CACHE_TLDR, analog } from "./story.js";
import { inviteQuote, mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface DenyCacheScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface DenyCacheReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadDenyCache(path: string): DenyCacheScenario {
  return JSON.parse(readFileSync(path, "utf8")) as DenyCacheScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

export function runDenyCache(scenario: DenyCacheScenario): DenyCacheReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = DENY_CACHE_TLDR;
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

  const invited = inviteQuote(rt, {
    buyer: desk.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "brief after the freeze lifts",
    price: scenario.quotes.once!,
  });

  must(rt.dispatch(cmd("identity.freeze", founder.id, { agentId: desk.id })), "freeze desk");

  const frozen = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
  const auditAfterDeny = rt.audit.length;
  const decisionsAfterDeny = rt.decisions.length;

  const retry = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));

  must(rt.dispatch(cmd("identity.unfreeze", founder.id, { agentId: desk.id })), "unfreeze desk");

  const afterLift = rt.dispatch(cmd("hire.create", desk.id, { quoteId: invited.quoteId, intentId }));
  const hireId = afterLift.ok ? (afterLift.value.data as { id: string }).id : "";
  const liftedAllow = afterLift.ok === true && afterLift.value.replayed !== true && hireId.length > 0;

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(deniedRule(frozen, "actor.not_frozen"), 1, "frozen desk hire.create is actor.not_frozen"),
    expect(
      deniedRule(retry, "actor.not_frozen") &&
        retry.ok === false &&
        rt.audit.length > auditAfterDeny &&
        rt.decisions.length > decisionsAfterDeny,
      2,
      "retrying that deny is a new decision, not a cached leftover no",
      `${rt.audit.length - auditAfterDeny} audit lines`,
    ),
    expect(liftedAllow && rt.hires.size === 1, 3, "after unfreeze the same hire.create is an allow", hireId),
    expect(rt.consumedQuotes.has(invited.quoteId), 4, "a deny did not consume the quote; the later allow did"),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
