#!/usr/bin/env node
import { resolve } from "node:path";
import { loadScenario, runSprintProcurement } from "@aether/sprint";
import { loadNightWatch, runNightWatch } from "@aether/night-watch";
import { loadSubHire, runSubHire } from "@aether/sub-hire";
import { loadClearingWindow, runClearingWindow } from "@aether/clearing-window";
import { loadRefund, runRefund } from "@aether/refund";
import { loadReplay, runReplay } from "@aether/replay";
import { loadNonce, runNonce } from "@aether/envelope-nonce";
import { loadDenyCache, runDenyCache } from "@aether/deny-cache";
import { loadRecurrence, runRecurrence } from "@aether/recurrence-cadence";
import { loadCalendar, runCalendar } from "@aether/execution-window";
import { loadSlot, runSlot } from "@aether/cadence-slot";
import { loadDaily, runDaily } from "@aether/daily-gap";
import { loadCartOccupancy, runCartOccupancy } from "@aether/cart-occupancy";

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

if (command === "demo" && (name === "refund" || name === "refund-unwind")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/refund/scenario.json");
  printReport(runRefund(loadRefund(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "replay" || name === "replay-once")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/replay/scenario.json");
  printReport(runReplay(loadReplay(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "nonce" || name === "envelope-nonce")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/nonce/scenario.json");
  printReport(runNonce(loadNonce(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "deny" || name === "deny-cache")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/deny-cache/scenario.json");
  printReport(runDenyCache(loadDenyCache(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "recurrence" || name === "cadence" || name === "recurrence-cadence")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/recurrence/scenario.json");
  printReport(runRecurrence(loadRecurrence(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "calendar" || name === "window" || name === "execution-window")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/calendar/scenario.json");
  printReport(runCalendar(loadCalendar(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "slot" || name === "cadence-slot")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/slot/scenario.json");
  printReport(runSlot(loadSlot(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "daily" || name === "daily-gap")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/daily/scenario.json");
  printReport(runDaily(loadDaily(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "cart" || name === "occupancy" || name === "unique-cart" || name === "cart-occupancy")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/cart/scenario.json");
  printReport(runCartOccupancy(loadCartOccupancy(fixture)));
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
  pnpm demo refund
  pnpm demo replay
  pnpm demo nonce
  pnpm demo deny
  pnpm demo recurrence
  pnpm demo calendar
  pnpm demo slot
  pnpm demo daily
  pnpm demo cart
  pnpm mcp`);
process.exit(command ? 1 : 0);
