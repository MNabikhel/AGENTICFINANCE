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
import { loadNotExpired, runNotExpired } from "@aether/not-expired";
import { loadChainIntegrity, runChainIntegrity } from "@aether/chain-integrity";
import { loadHireState, runHireState } from "@aether/hire-state";
import { loadLedgerKnown, runLedgerKnown } from "@aether/ledger-known";
import { loadKyaParty, runKyaParty } from "@aether/kya-party";
import { loadFxWindow, runFxWindow } from "@aether/fx-window";
import { loadIntentSubject, runIntentSubject } from "@aether/intent-subject";
import { loadFxQuote, runFxQuote } from "@aether/fx-quote";
import { loadSameCurrency, runSameCurrency } from "@aether/same-currency";
import { loadLadderLegal, runLadderLegal } from "@aether/ladder-legal";
import { loadMinLevel, runMinLevel } from "@aether/min-level";
import { loadBirthRung, runBirthRung } from "@aether/birth-rung";
import { loadMaxAutonomy, runMaxAutonomy } from "@aether/max-autonomy";
import { loadAttestationFresh, runAttestationFresh } from "@aether/attestation-fresh";
import { loadApprovalPending, runApprovalPending } from "@aether/approval-pending";
import { loadKyaNotSelf, runKyaNotSelf } from "@aether/kya-not-self";
import { loadHostAuthority, runHostAuthority } from "@aether/host-authority";
import { loadOccurrenceFresh, runOccurrenceFresh } from "@aether/occurrence-fresh";
import { loadRoleCapability, runRoleCapability } from "@aether/role-capability";
import { loadAmountRange, runAmountRange } from "@aether/amount-range";
import { loadEscrowRequired, runEscrowRequired } from "@aether/escrow-required";
import { loadKnownSku, runKnownSku } from "@aether/known-sku";
import { loadKnownRfq, runKnownRfq } from "@aether/known-rfq";
import { loadKnownIntent, runKnownIntent } from "@aether/known-intent";
import { loadKnownCart, runKnownCart } from "@aether/known-cart";
import { loadKnownHire, runKnownHire } from "@aether/known-hire";
import { loadKnownParent, runKnownParent } from "@aether/known-parent";
import { loadKnownApproval, runKnownApproval } from "@aether/known-approval";
import { loadKyaKnownParent, runKyaKnownParent } from "@aether/kya-known-parent";
import { loadKnownAttestation, runKnownAttestation } from "@aether/known-attestation";
import { loadKnownInvitee, runKnownInvitee } from "@aether/known-invitee";
import { loadCartFresh, runCartFresh } from "@aether/cart-fresh";
import { loadFreezeState, runFreezeState } from "@aether/freeze-state";
import { loadUniqueKey, runUniqueKey } from "@aether/unique-key";
import { loadSystemScope, runSystemScope } from "@aether/system-scope";
import { loadActorKnown, runActorKnown } from "@aether/actor-known";
import { loadReceiptKnown, runReceiptKnown } from "@aether/receipt-known";
import { loadKyaMintFresh, runKyaMintFresh } from "@aether/kya-mint-fresh";
import { loadWindowFresh, runWindowFresh } from "@aether/window-fresh";
import { loadMmKnown, runMmKnown } from "@aether/mm-known";
import { loadCurrencyMatch, runCurrencyMatch } from "@aether/currency-match";
import { loadSafeBalance, runSafeBalance } from "@aether/safe-balance";
import { loadFxPair, runFxPair } from "@aether/fx-pair";
import { loadApprovalReplay, runApprovalReplay } from "@aether/approval-replay";
import { loadChainIntact, runChainIntact } from "@aether/chain-intact";
import { loadPrincipalNotFrozen, runPrincipalNotFrozen } from "@aether/principal-not-frozen";
import { loadAllowedInstruments, runAllowedInstruments } from "@aether/allowed-instruments";
import { loadHumanSignature, runHumanSignature } from "@aether/human-signature";
import { loadDelegationDepth, runDelegationDepth } from "@aether/delegation-depth";
import { loadPaymentReference, runPaymentReference } from "@aether/payment-reference";
import { loadIdentityParty, runIdentityParty } from "@aether/identity-party";
import { loadHireVoid, runHireVoid } from "@aether/hire-void";
import { loadMarketParty, runMarketParty } from "@aether/market-party";
import { loadMandateParty, runMandateParty } from "@aether/mandate-party";
import { loadRfqParty, runRfqParty } from "@aether/rfq-party";
import { loadCartParty, runCartParty } from "@aether/cart-party";
import { loadPaymentParty, runPaymentParty } from "@aether/payment-party";
import { loadCadenceReach, runCadenceReach } from "@aether/cadence-reach";
import { loadRangeFresh, runRangeFresh } from "@aether/range-fresh";
import { loadBudgetFresh, runBudgetFresh } from "@aether/budget-fresh";
import { loadCurrencyFresh, runCurrencyFresh } from "@aether/currency-fresh";
import { loadHatchFresh, runHatchFresh } from "@aether/hatch-fresh";
import { loadCapFresh, runCapFresh } from "@aether/cap-fresh";
import { loadGrantFresh, runGrantFresh } from "@aether/grant-fresh";
import { loadNestTighter, runNestTighter } from "@aether/nest-tighter";
import { loadPathTighter, runPathTighter } from "@aether/path-tighter";
import { loadPathLive, runPathLive } from "@aether/path-live";
import { loadChildCurrency, runChildCurrency } from "@aether/child-currency";
import { loadPayoutFresh, runPayoutFresh } from "@aether/payout-fresh";
import { loadFxMaker, runFxMaker } from "@aether/fx-maker";
import { loadRateFresh, runRateFresh } from "@aether/rate-fresh";
import { loadNestParty, runNestParty } from "@aether/nest-party";
import { loadCheckoutParty, runCheckoutParty } from "@aether/checkout-party";
import { loadHireRoomParty, runHireRoomParty } from "@aether/hire-room-party";
import { loadHireSlipParty, runHireSlipParty } from "@aether/hire-slip-party";
import { loadChildParty, runChildParty } from "@aether/child-party";
import { loadRootParty, runRootParty } from "@aether/root-party";
import { loadSettleParty, runSettleParty } from "@aether/settle-party";
import { bootCliRuntime, cliAuditVerify, cliLedgerReplay } from "./bus.ts";

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

if (command === "demo" && (name === "mint" || name === "operating-book")) {
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

if (command === "demo" && (name === "stale" || name === "ttl" || name === "not-expired")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/stale/scenario.json");
  printReport(runNotExpired(loadNotExpired(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "chain" || name === "integrity" || name === "verify-chain")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/chain/scenario.json");
  printReport(runChainIntegrity(loadChainIntegrity(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "arrow" || name === "hire-state" || name === "early-release")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/arrow/scenario.json");
  printReport(runHireState(loadHireState(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "wallet" || name === "usdc-book" || name === "known-account")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/wallet/scenario.json");
  printReport(runLedgerKnown(loadLedgerKnown(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "name" || name === "kya-party" || name === "in-name")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/name/scenario.json");
  printReport(runKyaParty(loadKyaParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "pane" || name === "fx-window" || name === "missing-window")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/pane/scenario.json");
  printReport(runFxWindow(loadFxWindow(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "subject" || name === "not-yours" || name === "wrong-desk")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/subject/scenario.json");
  printReport(runIntentSubject(loadIntentSubject(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "paper" || name === "fx-quote" || name === "research-settle")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/paper/scenario.json");
  printReport(runFxQuote(loadFxQuote(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "mix" || name === "same-currency" || name === "mixed-journal")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/mix/scenario.json");
  printReport(runSameCurrency(loadSameCurrency(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "rung" || name === "skip-rung" || name === "ladder-legal")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/rung/scenario.json");
  printReport(runLadderLegal(loadLadderLegal(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "grade" || name === "min-level" || name === "junior")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/grade/scenario.json");
  printReport(runMinLevel(loadMinLevel(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "cradle" || name === "birth-rung" || name === "birthright")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/cradle/scenario.json");
  printReport(runBirthRung(loadBirthRung(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "ceiling" || name === "slip-ceiling" || name === "max-autonomy")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/ceiling/scenario.json");
  printReport(runMaxAutonomy(loadMaxAutonomy(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "lapse" || name === "hop-lapse" || name === "attestation-fresh")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/lapse/scenario.json");
  printReport(runAttestationFresh(loadAttestationFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "pause" || name === "ticket" || name === "pending")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/pause/scenario.json");
  printReport(runApprovalPending(loadApprovalPending(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "mirror" || name === "selfie" || name === "echo")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/mirror/scenario.json");
  printReport(runKyaNotSelf(loadKyaNotSelf(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "warrant" || name === "signet" || name === "charter")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/warrant/scenario.json");
  printReport(runHostAuthority(loadHostAuthority(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "vacant" || name === "hollow" || name === "zeroed")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/vacant/scenario.json");
  printReport(runOccurrenceFresh(loadOccurrenceFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "badge" || name === "hat" || name === "vest")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/badge/scenario.json");
  printReport(runRoleCapability(loadRoleCapability(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "lid" || name === "sticker" || name === "tag")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/lid/scenario.json");
  printReport(runAmountRange(loadAmountRange(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "bare" || name === "owed" || name === "tab")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/bare/scenario.json");
  printReport(runEscrowRequired(loadEscrowRequired(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "shelf" || name === "aisle" || name === "rack")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/shelf/scenario.json");
  printReport(runKnownSku(loadKnownSku(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "hall" || name === "foyer" || name === "lobby")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/hall/scenario.json");
  printReport(runKnownRfq(loadKnownRfq(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "writ" || name === "folio" || name === "deed")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/writ/scenario.json");
  printReport(runKnownIntent(loadKnownIntent(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "crate" || name === "bin" || name === "tray")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/crate/scenario.json");
  printReport(runKnownCart(loadKnownCart(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "pact" || name === "bond" || name === "lease")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/pact/scenario.json");
  printReport(runKnownHire(loadKnownHire(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "root" || name === "stem" || name === "trunk")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/root/scenario.json");
  printReport(runKnownParent(loadKnownParent(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "docket" || name === "chit" || name === "stub")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/docket/scenario.json");
  printReport(runKnownApproval(loadKnownApproval(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "graft" || name === "twig" || name === "scion")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/graft/scenario.json");
  printReport(runKyaKnownParent(loadKyaKnownParent(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "seal" || name === "wax" || name === "stamp")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/seal/scenario.json");
  printReport(runKnownAttestation(loadKnownAttestation(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "guest" || name === "invitee" || name === "visitor")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/guest/scenario.json");
  printReport(runKnownInvitee(loadKnownInvitee(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "dust" || name === "ash" || name === "cinder")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/dust/scenario.json");
  printReport(runCartFresh(loadCartFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "thaw" || name === "frost" || name === "rime")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/thaw/scenario.json");
  printReport(runFreezeState(loadFreezeState(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "twin" || name === "clone" || name === "doppel")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/twin/scenario.json");
  printReport(runUniqueKey(loadUniqueKey(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "fence" || name === "scope" || name === "staff")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/fence/scenario.json");
  printReport(runSystemScope(loadSystemScope(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "mute" || name === "hush" || name === "blank")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/mute/scenario.json");
  printReport(runActorKnown(loadActorKnown(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "nil" || name === "gone" || name === "lost")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/nil/scenario.json");
  printReport(runReceiptKnown(loadReceiptKnown(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "spark" || name === "kindle" || name === "wick")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/spark/scenario.json");
  printReport(runKyaMintFresh(loadKyaMintFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "wilt" || name === "fade" || name === "dusk")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/wilt/scenario.json");
  printReport(runWindowFresh(loadWindowFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "maker" || name === "pit" || name === "booth")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/maker/scenario.json");
  printReport(runMmKnown(loadMmKnown(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "ink" || name === "dye" || name === "chalk")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/ink/scenario.json");
  printReport(runCurrencyMatch(loadCurrencyMatch(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "brim" || name === "swell" || name === "crest")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/brim/scenario.json");
  printReport(runSafeBalance(loadSafeBalance(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "swap" || name === "flip" || name === "twist")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/swap/scenario.json");
  printReport(runFxPair(loadFxPair(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "sour" || name === "curd" || name === "whey")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/sour/scenario.json");
  printReport(runApprovalReplay(loadApprovalReplay(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "cut" || name === "snip" || name === "cord")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/cut/scenario.json");
  printReport(runChainIntact(loadChainIntact(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "ice" || name === "glaze" || name === "chill")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/ice/scenario.json");
  printReport(runPrincipalNotFrozen(loadPrincipalNotFrozen(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "rail" || name === "tender" || name === "till")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/rail/scenario.json");
  printReport(runAllowedInstruments(loadAllowedInstruments(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "pen" || name === "quill" || name === "nibs")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/pen/scenario.json");
  printReport(runHumanSignature(loadHumanSignature(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "well" || name === "deep" || name === "fathom")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/well/scenario.json");
  printReport(runDelegationDepth(loadDelegationDepth(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "cite" || name === "xref" || name === "hitch")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/cite/scenario.json");
  printReport(runPaymentReference(loadPaymentReference(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "lock" || name === "ring" || name === "ward")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/lock/scenario.json");
  printReport(runIdentityParty(loadIdentityParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "void" || name === "nix" || name === "scrap")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/void/scenario.json");
  printReport(runHireVoid(loadHireVoid(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "fold" || name === "yank" || name === "tug")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/fold/scenario.json");
  printReport(runMarketParty(loadMarketParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "rip" || name === "tear" || name === "shred")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/rip/scenario.json");
  printReport(runMandateParty(loadMandateParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "shut" || name === "clap" || name === "gavel")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/shut/scenario.json");
  printReport(runRfqParty(loadRfqParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "dump" || name === "chuck" || name === "toss")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/dump/scenario.json");
  printReport(runCartParty(loadCartParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "spike" || name === "ditch" || name === "junk")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/spike/scenario.json");
  printReport(runPaymentParty(loadPaymentParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "week" || name === "tide" || name === "cycle")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/week/scenario.json");
  printReport(runCadenceReach(loadCadenceReach(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "gulf" || name === "rift" || name === "span")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/gulf/scenario.json");
  printReport(runRangeFresh(loadRangeFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "coffer" || name === "vault" || name === "pouch")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/coffer/scenario.json");
  printReport(runBudgetFresh(loadBudgetFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "clash" || name === "jolt" || name === "snag")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/clash/scenario.json");
  printReport(runCurrencyFresh(loadCurrencyFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "hatch" || name === "flap" || name === "cork")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/hatch/scenario.json");
  printReport(runHatchFresh(loadHatchFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "eave" || name === "ridge" || name === "gable")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/eave/scenario.json");
  printReport(runCapFresh(loadCapFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "sill" || name === "ledge" || name === "lintel")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/sill/scenario.json");
  printReport(runGrantFresh(loadGrantFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "joist" || name === "strut" || name === "brace")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/joist/scenario.json");
  printReport(runNestTighter(loadNestTighter(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "stud" || name === "noggin" || name === "dwang")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/stud/scenario.json");
  printReport(runPathTighter(loadPathTighter(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "plate" || name === "sole" || name === "shoe")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/plate/scenario.json");
  printReport(runPathLive(loadPathLive(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "header" || name === "cripple" || name === "king")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/header/scenario.json");
  printReport(runChildCurrency(loadChildCurrency(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "pip" || name === "tick" || name === "basis")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/pip/scenario.json");
  printReport(runPayoutFresh(loadPayoutFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "quoin" || name === "pier" || name === "plinth")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/quoin/scenario.json");
  printReport(runFxMaker(loadFxMaker(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "ashlar" || name === "voussoir" || name === "impost")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/ashlar/scenario.json");
  printReport(runRateFresh(loadRateFresh(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "corbel" || name === "springer" || name === "haunch")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/corbel/scenario.json");
  printReport(runNestParty(loadNestParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "trolley" || name === "basket" || name === "buggy")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/trolley/scenario.json");
  printReport(runCheckoutParty(loadCheckoutParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "poach" || name === "raid" || name === "snatch")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/poach/scenario.json");
  printReport(runHireRoomParty(loadHireRoomParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "guise" || name === "mask" || name === "cloak")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/guise/scenario.json");
  printReport(runHireSlipParty(loadHireSlipParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "cuckoo" || name === "brood" || name === "changeling")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/cuckoo/scenario.json");
  printReport(runChildParty(loadChildParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "forge" || name === "fake" || name === "dummy")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/forge/scenario.json");
  printReport(runRootParty(loadRootParty(fixture)));
  process.exit(0);
}

if (command === "demo" && (name === "snare" || name === "gin" || name === "wire")) {
  const fixture = resolve(process.cwd(), "fixtures/demo/snare/scenario.json");
  printReport(runSettleParty(loadSettleParty(fixture)));
  process.exit(0);
}

if (command === "audit" && process.argv[3] === "verify") {
  const result = cliAuditVerify(bootCliRuntime());
  if (!result.ok) {
    const body = result.error.decision
      ? { ...result.error.error, decision: result.error.decision }
      : { ...result.error.error };
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result.value, null, 2));
  process.exit(0);
}

if (command === "ledger" && process.argv[3] === "replay") {
  const rt = bootCliRuntime();
  const ok = cliLedgerReplay(rt);
  console.log(JSON.stringify({ ok, entries: rt.ledger.entries.length }));
  process.exit(ok ? 0 : 1);
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
  pnpm demo stale
  pnpm demo chain
  pnpm demo arrow
  pnpm demo wallet
  pnpm demo name
  pnpm demo pane
  pnpm demo subject
  pnpm demo paper
  pnpm demo mix
  pnpm demo rung
  pnpm demo grade
  pnpm demo cradle
  pnpm demo ceiling
  pnpm demo lapse
  pnpm demo pause
  pnpm demo mirror
  pnpm demo warrant
  pnpm demo vacant
  pnpm demo badge
  pnpm demo lid
  pnpm demo bare
  pnpm demo shelf
  pnpm demo hall
  pnpm demo writ
  pnpm demo crate
  pnpm demo pact
  pnpm demo root
  pnpm demo docket
  pnpm demo graft
  pnpm demo seal
  pnpm demo guest
  pnpm demo dust
  pnpm demo thaw
  pnpm demo twin
  pnpm demo fence
  pnpm demo mute
  pnpm demo nil
  pnpm demo spark
  pnpm demo wilt
  pnpm demo maker
  pnpm demo ink
  pnpm demo brim
  pnpm demo swap
  pnpm demo sour
  pnpm demo cut
  pnpm demo ice
  pnpm demo rail
  pnpm demo pen
  pnpm demo well
  pnpm demo cite
  pnpm demo lock
  pnpm demo void
  pnpm demo fold
  pnpm demo rip
  pnpm demo shut
  pnpm demo dump
  pnpm demo spike
  pnpm demo week
  pnpm demo gulf
  pnpm demo coffer
  pnpm demo clash
  pnpm demo hatch
  pnpm demo eave
  pnpm demo sill
  pnpm demo joist
  pnpm demo stud
  pnpm demo plate
  pnpm demo header
  pnpm demo pip
  pnpm demo quoin
  pnpm demo ashlar
  pnpm demo corbel
  pnpm demo trolley
  pnpm demo poach
  pnpm demo guise
  pnpm demo cuckoo
  pnpm demo forge
  pnpm demo snare
  aether audit verify
  aether ledger replay
  pnpm mcp`);
process.exit(command ? 1 : 0);
