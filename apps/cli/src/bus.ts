import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runtime, cmd, parseHostedMonthly } from "@aether/runtime";

export function bootCliRuntime(): Runtime {
  const dir = process.env.AETHER_DATA_DIR;
  const hostedEnv = process.env.AETHER_HOSTED;
  const hosted =
    hostedEnv === "true" || hostedEnv === "1"
      ? true
      : hostedEnv === "false" || hostedEnv === "0"
        ? false
        : undefined;
  const hostedMonthly = parseHostedMonthly(process.env.AETHER_HOSTED_MONTHLY);
  return new Runtime({
    startIso: "2026-08-28T00:00:00.000Z",
    genesisNonce: "01J6AETHERGENESIS0000000001",
    dailyLimit: 10_000_000,
    ...(dir && dir.length > 0 ? { dataDir: dir } : {}),
    ...(hosted !== undefined ? { hosted } : {}),
    ...(hosted === true && hostedMonthly !== undefined ? { hostedMonthly } : {}),
  });
}

export function cliAuditVerify(rt = bootCliRuntime()) {
  return rt.dispatch(cmd("audit.verify", "system", {}));
}

/** Dump in-memory journals to jsonl and ask whether that file rebuilds the same books. */
export function cliLedgerReplay(rt = bootCliRuntime()): boolean {
  const dir = mkdtempSync(join(tmpdir(), "aether-ledger-replay-"));
  const path = join(dir, "ledger.jsonl");
  try {
    for (const entry of rt.ledger.entries) {
      appendFileSync(path, `${JSON.stringify(entry)}\n`);
    }
    return rt.ledger.replayEqualsMemory(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
