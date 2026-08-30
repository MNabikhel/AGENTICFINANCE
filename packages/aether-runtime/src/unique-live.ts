import { readFileSync } from "node:fs";
import { hopStatus } from "@aether/kya";
import type { AgentId } from "@aether/types";
import { Runtime, cmd } from "./index.js";
import { PAIR_TLDR, analog } from "./story.js";
import { mustDispatch } from "./hire-flow.js";
import type { TapResult } from "./sprint-procurement.js";

export interface UniqueLiveScenario {
  id: string;
  clockStart: string;
  genesisNonce: string;
  opening: Record<string, { amount: number; currency: "USD_SIM" | "USDC_SIM" }>;
  circuit: { dailyLimit: number };
}

export interface UniqueLiveReport {
  ok: boolean;
  results: TapResult[];
  snapshot: ReturnType<Runtime["snapshotState"]>;
  runtime: Runtime;
}

export function loadUniqueLive(path: string): UniqueLiveScenario {
  return JSON.parse(readFileSync(path, "utf8")) as UniqueLiveScenario;
}

function expect(ok: boolean, id: number, name: string, detail?: string): TapResult {
  return detail ? { ok, id, name, detail } : { ok, id, name };
}

function deniedRule(attempt: ReturnType<Runtime["dispatch"]>, ruleId: string): boolean {
  if (attempt.ok) return false;
  return attempt.error.decision?.trace.some((t) => t.ruleId === ruleId && t.verdict === "deny") === true;
}

function liveHops(rt: Runtime, principalId: AgentId, delegateId: AgentId) {
  const now = rt.clock.now();
  return [...rt.kya.attestations.values()].filter(
    (a) => a.principalId === principalId && a.delegateId === delegateId && hopStatus(a, now) === "live",
  );
}

export function runUniqueLive(scenario: UniqueLiveScenario): UniqueLiveReport {
  const rt = new Runtime({
    startIso: scenario.clockStart,
    genesisNonce: scenario.genesisNonce,
    dailyLimit: scenario.circuit.dailyLimit,
  });
  rt.tldr = PAIR_TLDR;
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
    { key: "desk", displayName: "Desk", role: "procurement", autonomyLevel: 3 },
    { key: "scout", displayName: "Scout", role: "procurement", autonomyLevel: 3 },
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

  if (Object.keys(scenario.opening).length > 0) rt.seedOpening(scenario.opening);

  const desk = rt.alias("desk");
  const scout = rt.alias("scout");
  const auditor = rt.alias("auditor");

  const first = must(
    rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 4 })),
    "first hop",
  );
  const firstAllow = first.replayed !== true;
  const firstHop = first.data as { id: string; maxAutonomy: number; delegateId: string };

  const attestBefore = rt.audit.query({ action: "KYA_ATTEST", subjectId: desk.id }).matched;
  const liveBeforeSneak = liveHops(rt, founder.id, desk.id).length;
  const sneak = rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 2 }));
  const afterSneak = {
    denied: deniedRule(sneak, "kya.unique_live"),
    live: liveHops(rt, founder.id, desk.id).length,
    attests: rt.audit.query({ action: "KYA_ATTEST", subjectId: desk.id }).matched,
  };

  const other = must(
    rt.dispatch(cmd("kya.attest", founder.id, { delegateId: scout.id, maxAutonomy: 4 })),
    "other pair",
  );
  const otherHop = other.data as { id: string; delegateId: string };
  const afterOther = {
    desk: liveHops(rt, founder.id, desk.id).length,
    scout: liveHops(rt, founder.id, scout.id).length,
  };

  must(rt.dispatch(cmd("kya.revoke", founder.id, { delegateId: desk.id })), "revoke desk");
  const afterRevoke = {
    desk: liveHops(rt, founder.id, desk.id).length,
    scout: liveHops(rt, founder.id, scout.id).length,
  };

  const again = must(
    rt.dispatch(cmd("kya.attest", founder.id, { delegateId: desk.id, maxAutonomy: 3 })),
    "re-attest",
  );
  const againHop = again.data as { id: string; maxAutonomy: number };

  const verify = must(rt.dispatch(cmd("audit.verify", auditor.id, {})), "audit.verify");
  const snap = rt.snapshotState();

  const results: TapResult[] = [
    expect(
      firstAllow && firstHop.maxAutonomy === 4 && firstHop.delegateId === desk.id && liveBeforeSneak === 1,
      1,
      "first kya.attest allows — one live hop on the pair",
      firstHop.id,
    ),
    expect(
      afterSneak.denied && afterSneak.live === liveBeforeSneak && afterSneak.attests === attestBefore,
      2,
      "second live hop is kya.unique_live — not a tighter grant",
      desk.id,
    ),
    expect(
      otherHop.delegateId === scout.id && afterOther.desk === 1 && afterOther.scout === 1,
      3,
      "a hop to a different agent is a different pair",
      otherHop.id,
    ),
    expect(
      afterRevoke.desk === 0 &&
        afterRevoke.scout === 1 &&
        againHop.maxAutonomy === 3 &&
        liveHops(rt, founder.id, desk.id).length === 1 &&
        liveHops(rt, founder.id, scout.id).length === 1,
      4,
      "revoke, then attest again — that pair has one live hop",
      againHop.id,
    ),
    expect((verify.data as { ok: boolean }).ok === true && rt.audit.verify().ok, 5, "audit chain verifies"),
  ];

  return { ok: results.every((r) => r.ok), results, snapshot: snap, runtime: rt };
}
