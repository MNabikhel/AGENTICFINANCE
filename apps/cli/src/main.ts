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
import { loadVelocity, runVelocity } from "@aether/hot-hour";
import { loadDoor, runDoor } from "@aether/operator-door";
import { loadCartMatch, runCartMatch } from "@aether/cart-match";
import { loadClosedRoom, runClosedRoom } from "@aether/closed-room";
import { loadConversion, runConversion } from "@aether/fx-not-hire";
import { loadUniqueLive, runUniqueLive } from "@aether/unique-live";
import { loadSpreadBound, runSpreadBound } from "@aether/spread-bound";
import { loadParentFresh, runParentFresh } from "@aether/parent-fresh";
import { loadMandateParent, runMandateParent } from "@aether/mandate-parent";
import { loadMmInventory, runMmInventory } from "@aether/mm-inventory";
import { loadPaymentBudget, runPaymentBudget } from "@aether/payment-budget";
import { loadHostUnique, runHostUnique } from "@aether/host-unique";
import { loadParentBudget, runParentBudget } from "@aether/payment-parent";
import { loadOperatingBook, runOperatingBook } from "@aether/operating-book";
import { loadPaymentPayees, runPaymentPayees } from "@aether/payment-payees";
import { loadCapabilitySubset, runCapabilitySubset } from "@aether/capability-subset";
import { loadFxFresh, runFxFresh } from "@aether/fx-fresh";
import { loadWindowReach, runWindowReach } from "@aether/window-reach";
import { loadKyaWindow, runKyaWindow } from "@aether/kya-window";
import { loadCircuitDaily, runCircuitDaily } from "@aether/circuit-daily";
import { loadPaymentSkus, runPaymentSkus } from "@aether/payment-skus";
import { loadSkuCurrency, runSkuCurrency } from "@aether/sku-currency";
import { loadHireParty, runHireParty } from "@aether/hire-party";
import { loadLedgerSufficient, runLedgerSufficient } from "@aether/ledger-sufficient";

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

if (command === "demo" && (name === "velocity" || name === "hour" || name === "hot-hour")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/velocity/scenario.json");
  printReport(runVelocity(loadVelocity(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "door" || name === "hosted-door" || name === "operator-door")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/door/scenario.json");
  printReport(runDoor(loadDoor(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "match" || name === "cart-match" || name === "hire-match")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/match/scenario.json");
  printReport(runCartMatch(loadCartMatch(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "room" || name === "invite" || name === "closed-room" || name === "invited-seller")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/room/scenario.json");
  printReport(runClosedRoom(loadClosedRoom(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "conversion" || name === "not-fx" || name === "fx-hire")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/conversion/scenario.json");
  printReport(runConversion(loadConversion(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "pair" || name === "hop" || name === "unique-live")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/pair/scenario.json");
  printReport(runUniqueLive(loadUniqueLive(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "band" || name === "spread" || name === "spread-bound")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/band/scenario.json");
  printReport(runSpreadBound(loadSpreadBound(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "nest" || name === "parent-fresh" || name === "lineage")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/nest/scenario.json");
  printReport(runParentFresh(loadParentFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "heir" || name === "child-slip" || name === "mandate-parent")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/heir/scenario.json");
  printReport(runMandateParent(loadMandateParent(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "stock" || name === "inventory" || name === "mm-inventory")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/stock/scenario.json");
  printReport(runMmInventory(loadMmInventory(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "purse" || name === "budget" || name === "payment-budget")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/purse/scenario.json");
  printReport(runPaymentBudget(loadPaymentBudget(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "seat" || name === "row" || name === "unique-subscriber")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/seat/scenario.json");
  printReport(runHostUnique(loadHostUnique(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "cover" || name === "roof" || name === "parent-budget")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/cover/scenario.json");
  printReport(runParentBudget(loadParentBudget(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "mint" || name === "lock" || name === "operating-book")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/mint/scenario.json");
  printReport(runOperatingBook(loadOperatingBook(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "payee" || name === "roster" || name === "allowed-payees")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/payee/scenario.json");
  printReport(runPaymentPayees(loadPaymentPayees(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "climb" || name === "grant" || name === "capability-subset")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/climb/scenario.json");
  printReport(runCapabilitySubset(loadCapabilitySubset(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "born" || name === "fx-fresh" || name === "dead-window")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/born/scenario.json");
  printReport(runFxFresh(loadFxFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "reach" || name === "horizon" || name === "window-reach")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/reach/scenario.json");
  printReport(runWindowReach(loadWindowReach(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "year" || name === "century" || name === "kya-window")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/year/scenario.json");
  printReport(runKyaWindow(loadKyaWindow(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "fuse" || name === "breaker" || name === "circuit-daily")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/fuse/scenario.json");
  printReport(runCircuitDaily(loadCircuitDaily(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "sku" || name === "goods" || name === "allowed-skus")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/sku/scenario.json");
  printReport(runPaymentSkus(loadPaymentSkus(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "priced" || name === "currency" || name === "sku-currency")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/priced/scenario.json");
  printReport(runSkuCurrency(loadSkuCurrency(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "party" || name === "table" || name === "hire-party")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/party/scenario.json");
  printReport(runHireParty(loadHireParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "cash" || name === "overdraft" || name === "sufficient")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/cash/scenario.json");
  printReport(runLedgerSufficient(loadLedgerSufficient(fixture)));
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
  pnpm demo velocity
  pnpm demo door
  pnpm demo match
  pnpm demo room
  pnpm demo conversion
  pnpm demo pair
  pnpm demo band
  pnpm demo nest
  pnpm demo heir
  pnpm demo stock
  pnpm demo purse
  pnpm demo seat
  pnpm demo cover
  pnpm demo mint
  pnpm demo payee
  pnpm demo climb
  pnpm demo born
  pnpm demo reach
  pnpm demo year
  pnpm demo fuse
  pnpm demo sku
  pnpm demo priced
  pnpm demo party
  pnpm demo cash
  pnpm mcp`);
process.exit(command ? 1 : 0);
