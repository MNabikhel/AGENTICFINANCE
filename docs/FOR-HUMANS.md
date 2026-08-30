# Aether, in human

If the rest of this repo looks like a protocol stack fell on the page, start here.

## The one-sentence version

**Aether is a rulebook for software that spends money.**

A human writes what is allowed. Agents go do the work. A referee that never gets tired and never guesses says yes, no, or ask a grown-up. A notary writes it down so nobody can rewrite yesterday. An auditor can read the book and cannot spend.

That is the whole product. Everything else is how you say it to a machine.

## Why this matters

People are building agents that will shop, hire other agents, pay APIs, move treasury cash, and eventually sit closer to markets. Today’s “agent payments” work is mostly **checkout** (buy a toaster through ChatGPT) and **micropayments** (pay 2¢ for an API call).

Checkout is not an economy.

An economy needs:

- permission that can be proven later
- a referee who will refuse a bad spend even if the agent is clever
- a pause button and a grown-up
- a receipt that points at the permission
- a book that auditors and future agents can replay

Aether is that layer. It runs **now** on fake dollars (`USD_SIM`) so we can be honest about what works before anyone connects a real bank.

## The kitchen-table demo

Seven characters sit down:

| Who | Job |
|---|---|
| Ops Human | Writes the permission slip |
| Treasury | Holds the company cash, signs exceptions |
| Procurement | Shops, within the slip |
| Data Vendor | Sells a dataset |
| Compute Vendor | Sells GPU hours |
| Market Maker | Swaps dollars for USDC, no heroics |
| Auditor | Reads the notary book, cannot buy anything |

What happens:

1. The human says: *buy data and compute for the sprint, max $5,000 per item, $15,000 total.*
2. Treasury hands procurement $15,000.
3. Data is $800. The referee says **yes**. Money sits in escrow, work happens, vendor is paid, a receipt is written.
4. Compute is $6,400. The referee says **no** — $6,400 is over the $5,000 line on the slip. A manager cannot wink this through. Someone has to write a **new** slip.
5. The human writes a new slip for compute. Now the amount is legal, but it is still over procurement’s auto-approve threshold, so the referee says **ask treasury**.
6. Treasury signs. Escrow, work, pay, receipt.
7. The data vendor swaps its $800 into USDC at a 0.2% window. Not a trading floor.
8. The auditor checks the notary chain. Then the auditor tries to spend a dollar. **No.**

If you run `pnpm dev` and press **Shopping trip**, you will see that story in English, then you can open “the machinery” if you want hashes and rule IDs.

## The second demo: Night Watch (standing permission)

This is the one about **humans stepping back**.

A founder shakes hands with a night-watch agent (that handshake is Know Your Agent — not a password, a revocable permission to spend in someone’s name). They write a standing slip: buy research overnight, max $8,000 each, $20,000 total. They climb the ladder one rung at a time, **freeze the agent on purpose** to prove the kill switch works, then grant L5.

What happens:

1. A $200 brief is allowed. Nobody is at the keyboard.
2. A $6,000 brief is also allowed. At L3 that would have asked treasury. At L5 it does not — the slip still caps it.
3. A $9,000 brief is refused. The slip said $8,000. L5 cannot wink that through. That attempt also blows the **daily fuse**, which sticks.
4. A $200 follow-up is refused too. The fuse stays blown until a human resets it.
5. Treasury freezes the **founder**. Night Watch still has keys. It still cannot spend. Authority is a graph, not a token in a bot.
6. The founder revokes the handshake. The agent still exists. It is broke on purpose.
7. The auditor reads the book and still cannot spend.

Run it with `pnpm demo night-watch`, or press **Night watch** in the control room.

## The ladder (how humans step back without disappearing)

| Level | In English |
|---|---|
| L0 | The human does it. The agent drafts. |
| L1 | The agent prepares. The human clicks yes each time. |
| L2 | The agent may pay, if it still fits the slip. |
| L3 | The agent may hire other agents against that slip. (This is where the demo lives.) |
| L4 | The agent may hand a smaller slip to another agent. |
| L5 | Standing permission. Humans still hold freeze, daily circuit breakers, and the notary. **Not god mode.** |

The point of L5 is not “the machines won.” It is “the human is no longer in every click, and that is only safe because the referee, the freeze, the handshake, and the book are still there.”

## What we are not building

A trading bot. A storefront. A crypto casino. A chatbot that “decides if this looks risky.” Live wires to your bank in this version.

Those would be easy to fake and hard to trust. The valuable thing is the rulebook other agents can use when the wires *do* get connected.

## If you are cheering this on

You do not have to read `DESIGN.md`. That file is the contract between machines.

You can:

1. Read this page.
2. Run `pnpm demo` (shopping trip), `pnpm demo night-watch` (standing permission), `pnpm demo sub-hire` (one agent handing a smaller slip to another), `pnpm demo clearing` (a credit line and a settlement photo, not a second payment), `pnpm demo refund` (unwind funded escrow; the quote stays spent; the fuse stays sticky), `pnpm demo replay` (a retry of an allow is not a second spend), `pnpm demo nonce` (a payment nonce is one-shot), `pnpm demo deny` (a deny is never a leftover no), `pnpm demo recurrence` (a one-slot cadence is not an open checkbook), `pnpm demo calendar` (a closed calendar is not a freeze on funded work), `pnpm demo slot` (a refund does not restore a cadence slot), `pnpm demo daily` (a cadence is a gap, not a burst), `pnpm demo cart` (occupancy is a bind, not a field on fund), `pnpm demo velocity` (a hot hour is not a freeze on funded work), `pnpm demo door` (the public kernel is not a hosted checkout), `pnpm demo match` (a cheaper cart is not a discount), `pnpm demo room` (a closed room is not a bulletin board), `pnpm demo conversion` (an FX window is not a hire), `pnpm demo pair` (a second live hop is not a tighter grant), `pnpm demo band` (a 200bps band is not decoration), `pnpm demo nest` (a nested hop does not outlive its parent), `pnpm demo heir` (a dead parent is not a parent), `pnpm demo stock` (empty MM USDC is not a missing maker), `pnpm demo purse` (a budget is not an item cap), `pnpm demo seat` (one subscriber is one row), `pnpm demo cover` (a parent envelope is not a child's leftover), `pnpm demo mint` (a transfer is not a mint), `pnpm demo payee` (a listed payee is not any registered vendor), `pnpm demo climb` (a climb is not a wider handshake), `pnpm demo born` (an FX window cannot be born dead), `pnpm demo reach` (a window that opens after the slip dies is not a window), `pnpm demo year` (a handshake cannot outlive one year), `pnpm demo fuse` (a daily fuse is not a freeze on funded work), `pnpm demo sku` (a listed SKU is not any catalog good), and `pnpm demo priced` (a listed SKU is only priced in a catalog currency), and `pnpm demo party` (the other side of the table is not a party), and `pnpm demo cash` (empty cash is not a negative book), and `pnpm demo stale` (a stale quote is not a hire), and `pnpm demo chain` (a dead cart is not a check), and `pnpm demo arrow` (unfinished work is not a payout), and `pnpm demo wallet` (a vendor's USD cash is not a USDC wallet), and `pnpm demo name` (someone else's name is not a handshake), and `pnpm demo pane` (an FX SKU is a window, not a good), and `pnpm demo subject` (this slip is not yours to spend), and `pnpm demo paper` (a research quote is not a conversion window), and `pnpm demo mix` (a mixed journal is not a conversion), and `pnpm demo rung` (a skipped rung is not a promotion), and `pnpm demo grade` (a junior desk is not a nested-slip mint), and `pnpm demo cradle` (L5 is not a birthright), and `pnpm demo ceiling` (a climb is not a wider slip), and `pnpm demo lapse` (an expired hop is not a freeze on funded work), and `pnpm demo pause` (a dead pause is not a late yes), and `pnpm demo mirror` (a handshake is not a mirror), and `pnpm demo warrant` (an agent-issued slip is not host authority), and `pnpm demo vacant` (a cadence with no slots is not a cadence), and `pnpm demo badge` (a badge is not a shopping pass), and `pnpm demo lid` (an item cap is not an envelope), and `pnpm demo bare` (unfunded work is not a delivery), and `pnpm demo shelf` (a ghost SKU is not a catalog good), and `pnpm demo hall` (a missing room is not a missing SKU), and `pnpm demo writ` (a missing slip is not a missing handshake), and `pnpm demo crate` (a missing cart is not a broken payment chain), and `pnpm demo pact` (a missing contract is not a broken mandate chain), and `pnpm demo root` (a missing parent is not a tighter child), and `pnpm demo docket` (a missing ticket is not a late yes), and `pnpm demo graft` (a missing hop parent is not a nested handshake), and `pnpm demo seal` (a missing handshake is not a silent tombstone), and `pnpm demo guest` (a missing invitee is not a closed room), and `pnpm demo dust` (a stale unpaid cart is not a late check), and `pnpm demo thaw` (a no-op thaw is not a kill-switch test), and `pnpm demo twin` (a taken alias is not a second agent), and `pnpm demo fence` (system is not a treasurer), and `pnpm demo mute` (a missing speaker is not a 500), and `pnpm demo nil` (a missing receipt is not an empty success), and `pnpm demo spark` (a handshake cannot be born dead), and `pnpm demo wilt` (a permission slip cannot be born with a closed calendar), and `pnpm demo maker` (a window is not a journal against nobody), and `pnpm demo ink` (a cart label is not the hire's money), and `pnpm demo brim` (IEEE rounding is not a mint), and `pnpm demo swap` (a swapped pair is not a silent journal of the books this rail actually posts), and `pnpm demo sour` (a grown-up yes is not a late hire), and `pnpm demo cut` (a revoke is not an expiry), and `pnpm demo ice` (a frozen principal is not a frozen desk), and `pnpm demo rail` (a listed rail is not decoration), and `pnpm demo pen` (a junior signature is not a grown-up pause), and `pnpm demo well` (a fourth hop is not a nested parent), and `pnpm demo cite` (a listed reference is not decoration once a check exists), and `pnpm demo lock` (someone else's key is not yours to turn), and `pnpm demo void` (a void is not a refund), and `pnpm demo fold` (someone else's bid is not yours to pull), and `pnpm demo rip` (someone else's unused slip is not yours to tear), and `pnpm demo shut` (someone else's room is not yours to close), and `pnpm demo dump` (someone else's unused checkout is not yours to dump), and `pnpm demo spike` (someone else's unused payment is not yours to spike), and `pnpm demo week` (a week is not a cadence on a seven-day slip), and `pnpm demo gulf` (a floor above the lid is not a range), and `pnpm demo coffer` (a closed coffer is not a budget), and `pnpm demo clash` (a USDC coffer on a USD lid is not a budget), and `pnpm demo hatch` (a closed hatch is not a range), and `pnpm demo eave` (a cap below the desk is not a cap), and `pnpm demo sill` (a grant below the desk is not a handshake), `pnpm demo joist` (a nested grant wider than its parent is not a handshake), `pnpm demo stud` (a grant wider than the incoming hop is not a handshake), `pnpm demo plate` (an orphan hop is not a handshake), `pnpm demo header` (a USDC header under a USD plate is not a nested slip), `pnpm demo pip` (a conversion that pays nothing is not an FX window), `pnpm demo quoin` (a vendor's conversion is not a market-maker window).
3. Making the spec public is the switch you can flip now. Wiring a live bank is later, as adapters, never as the brain.
