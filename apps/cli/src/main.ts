#!/usr/bin/env node
import { resolve } from "node:path";
import { loadScenario, runSprintProcurement } from "@aether/sprint";

const [, , command, name] = process.argv;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

if (command === "demo" && (name === "sprint-procurement" || name === undefined)) {
  const fixture = resolve(process.cwd(), "fixtures/demo/sprint-procurement/scenario.json");
  const scenario = loadScenario(fixture);
  const report = runSprintProcurement(scenario);
  console.log("");
  console.log(report.snapshot.tldr);
  console.log("");
  for (const beat of report.snapshot.story) {
    console.log(`- ${beat.headline}`);
  }
  console.log("");
  for (const r of report.results) {
    const line = `${r.ok ? "ok" : "not ok"} ${r.id}  ${r.name}${r.detail ? ` (${r.detail})` : ""}`;
    console.log(line);
  }
  console.log(`# audit length ${report.snapshot.audit.length}`);
  console.log(`# rail ${report.snapshot.rail}`);
  if (!report.ok) fail("sprint-procurement assertions failed");
  process.exit(0);
}

if (command === "audit" && process.argv[3] === "verify") {
  fail("boot a runtime first: pnpm demo");
}

console.log(`aether ${command ?? ""}
usage:
  pnpm demo
  pnpm aether demo sprint-procurement`);
process.exit(command ? 1 : 0);
