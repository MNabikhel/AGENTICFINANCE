#!/usr/bin/env node
import { resolve } from "node:path";
import { loadScenario, runSprintProcurement } from "@aether/sprint";
import { loadNightWatch, runNightWatch } from "@aether/night-watch";
import { loadSubHire, runSubHire } from "@aether/sub-hire";
import { loadClearingWindow, runClearingWindow } from "@aether/clearing-window";

const [, , command, name] = process.argv;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function printReport(report: { ok: boolean; results: { ok: boolean; id: number; name: string; detail?: string }[]; snapshot: { tldr: string; story: { headline: string }[]; audit: { length: number }; rail: string } }) {
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
  if (!report.ok) fail("demo assertions failed");
}

if (command === "demo" && (name === "sprint-procurement" || name === undefined)) {
  const fixture = resolve(process.cwd(), "fixtures/demo/sprint-procurement/scenario.json");
  printReport(runSprintProcurement(loadScenario(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "night-watch" || name === "standing-mandate")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/night-watch/scenario.json");
  printReport(runNightWatch(loadNightWatch(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "sub-hire" || name === "subhire")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/sub-hire/scenario.json");
  printReport(runSubHire(loadSubHire(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "clearing" || name === "clearing-window")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/clearing-window/scenario.json");
  printReport(runClearingWindow(loadClearingWindow(fixture)));
  process.exit(0);
}

if (command === "audit" && process.argv[3] === "verify") {
  fail("boot a runtime first: pnpm demo");
}

console.log(`aether ${command ?? ""}
usage:
  pnpm demo
  pnpm demo night-watch
  pnpm demo sub-hire
  pnpm demo clearing
  pnpm mcp`);
process.exit(command ? 1 : 0);
