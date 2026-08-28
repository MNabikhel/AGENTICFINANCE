import { readFileSync } from "node:fs";
import type { MandateConstraint, PolicyDecision } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { NIGHT_WATCH_TLDR, nightWatchAnalog } from "./story.js";
import { completeHire, finishHire, inviteQuote, mustDispatch, offerHire } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface NightWatchScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  agents: { key: string; role: string; autonomyLevel: number; displayName: string }[];
  circuit: { dailyLimit: number };
  allocation: { amount: number; currency: "USD_SIM" };
  intent: { task: string; constraints: MandateConstraint[] };
  quotes: Record<string, { amount: number; currency: "USD_SIM" }>;
}

export interface NightWatchReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadNightWatch(path: string): NightWatchScenario {
  return JSON.parse(readFileSync(path, "utf8")) as NightWatchScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

function decisionOf(attempt: ReturnType<Runtime["dispatch"]>): PolicyDecision {
  if (attempt.ok) return attempt.value.decision;
  if (!attempt.error.decision) throw new Error("malformed command in TAP (no policy decision)");
  return attempt.error.decision;
}

export function runNightWatch(scenario: NightWatchScenario): NightWatchReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = NIGHT_WATCH_TLDR;
  rt.analogDoc = nightWatchAnalog();
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

  for (const a of scenario.agents) {
    if (a.key === "ops-human") continue;
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

  const nightWatch = rt.alias("night-watch");
  const treasury = rt.alias("treasury");
  const vendor = rt.alias("research-vendor");
  const auditor = rt.alias("auditor");

  const attest = must(
    rt.dispatch(
      cmd("kya.attest", founder.id, {
        delegateId: nightWatch.id,
        principalId: founder.id,
        maxAutonomy: 5,
        issuerKind: "aether.self",
      }),
    ),
    "kya.attest",
  );

  const constraints: MandateConstraint[] = [
    ...scenario.intent.constraints,
    {
      type: "payment.allowed_payees",
      allowed: [{ id: vendor.id, name: vendor.displayName, website: "https://data_vendor.aether.test" }],
    },
  ];

  const intent = must(
    rt.dispatch(
      cmd("mandate.issue_intent", founder.id, {
        subjectId: nightWatch.id,
        task: scenario.intent.task,
        constraints,
      }),
    ),
    "standing intent",
  );
  const intentId = (intent.data as { payload: { id: string } }).payload.id;

  must(
    rt.dispatch(
      cmd("ledger.transfer", treasury.id, {
        fromAccount: "treasury:cash",
        toAccount: "night-watch:cash",
        amount: scenario.allocation,
      }),
    ),
    "allocate",
  );

  const climb = (to: number, gates: string[] = []) =>
    must(rt.dispatch(cmd("ladder.set", founder.id, { agentId: nightWatch.id, to, gates })), `ladder L${to}`);

  climb(1);
  climb(2, ["auditor_ack"]);
  climb(3, ["clean_audit_7d"]);
  climb(4);

  const prematureL5 = rt.dispatch(
    cmd("ladder.set", founder.id, {
      agentId: nightWatch.id,
      to: 5,
      gates: ["circuit_breaker_configured", "kill_switch_tested"],
    }),
  );

  const probe = inviteQuote(rt, {
    buyer: nightWatch.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "should fail while frozen",
    price: scenario.quotes.cheap!,
  });
  must(rt.dispatch(cmd("identity.freeze", founder.id, { agentId: nightWatch.id })), "freeze night-watch");
  const frozenHire = rt.dispatch(
    cmd("hire.create", nightWatch.id, { quoteId: probe.quoteId, intentId }),
  );
  must(rt.dispatch(cmd("identity.unfreeze", founder.id, { agentId: nightWatch.id })), "unfreeze night-watch");

  climb(5, ["circuit_breaker_configured", "kill_switch_tested"]);

  completeHire(rt, {
    buyer: nightWatch.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "overnight brief, cheap",
    price: scenario.quotes.cheap!,
    intentId,
    qty: 1,
    deliverable: { pages: 4 },
  });

  const bigOffer = offerHire(rt, {
    buyer: nightWatch.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "deep brief",
    price: scenario.quotes.big!,
    intentId,
  });
  const bigHire = mustDispatch(bigOffer.attempt, "big hire create");
  finishHire(rt, {
    hireId: (bigHire.data as { id: string }).id,
    buyer: nightWatch.id,
    seller: vendor.id,
    sku: "research.brief",
    intentId,
    qty: 1,
    unitAmount: scenario.quotes.big!.amount,
    deliverable: { pages: 80 },
  });

  const over = offerHire(rt, {
    buyer: nightWatch.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "too expensive",
    price: scenario.quotes.over!,
    intentId,
  });
  const fuseBlew = deniedRule(over.attempt, "circuit.daily") && rt.circuitTripped;

  const afterTrip = offerHire(rt, {
    buyer: nightWatch.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "still fused",
    price: scenario.quotes.cheap!,
    intentId,
  });
  const afterStuck = deniedRule(afterTrip.attempt, "circuit.daily");

  must(rt.dispatch(cmd("circuit.reset", treasury.id, {})), "circuit.reset");
  must(rt.dispatch(cmd("identity.freeze", treasury.id, { agentId: founder.id })), "freeze founder");

  const principalFrozen = offerHire(rt, {
    buyer: nightWatch.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "principal frozen",
    price: scenario.quotes.cheap!,
    intentId,
  });

  must(rt.dispatch(cmd("identity.unfreeze", treasury.id, { agentId: founder.id })), "unfreeze founder");
  must(
    rt.dispatch(cmd("kya.revoke", founder.id, { principalId: founder.id, delegateId: nightWatch.id })),
    "kya.revoke",
  );

  const revoked = offerHire(rt, {
    buyer: nightWatch.id,
    seller: vendor.id,
    sku: "research.brief",
    spec: "handshake revoked",
    price: scenario.quotes.cheap!,
    intentId,
  });

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const released = [...rt.hires.values()].filter((h) => h.state === "released");
  const auditorSpend = rt.dispatch(
    cmd("envelope.submit", auditor.id, { hireId: released[0]!.id, nonce: "auditor-should-fail" }),
  );

  const snap = rt.snapshotState();
  const l5 = rt.alias("night-watch");
  const bigDecision = decisionOf(bigOffer.attempt);
  const attestLive = (attest.data as { revokedAt?: string }).revokedAt === undefined;

  const results: TapResult[] = [
    expect(attestLive && snap.kya.edges.some((e) => e.status === "revoked"), 1, "KYA handshake issued then revoked"),
    expect(deniedRule(prematureL5, "ladder.legal"), 2, "L5 refused until kill switch is tested"),
    expect(deniedRule(frozenHire, "actor.not_frozen"), 3, "frozen agent cannot hire"),
    expect(l5.autonomyLevel === 5 && !l5.frozen, 4, "Night Watch reached L5 after freeze test"),
    expect(released.length === 2, 5, "cheap $200 and $6,000 hires released", String(released.length)),
    expect(
      bigDecision.verdict === "allow" &&
        bigDecision.trace.some((t) => t.ruleId === "approval.threshold" && t.message.includes("L5")),
      6,
      "L5 skips per-tx approval threshold on $6,000",
    ),
    expect(deniedRule(over.attempt, "payment.amount_range"), 7, "$9,000 denied by amount_range (L5 is not god mode)"),
    expect(fuseBlew, 8, "that overpay also blows the daily fuse"),
    expect(afterStuck, 9, "after trip, even $200 is refused"),
    expect(deniedRule(principalFrozen.attempt, "kya.principal_not_frozen"), 10, "frozen founder blocks delegate spend"),
    expect(deniedRule(revoked.attempt, "kya.chain_intact"), 11, "revoked handshake blocks spend"),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 12, "audit chain verifies"),
    expect(
      !auditorSpend.ok && auditorSpend.error.decision?.trace.some((t) => t.ruleId === "actor.role_capability") === true,
      13,
      "auditor cannot spend",
    ),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}