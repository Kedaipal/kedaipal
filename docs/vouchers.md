# Vouchers — seller-issued single-use codes

> **Status: shipped** (ClickUp `z8r3fdr617`, scoped 8 Oct 2026, built 9 Oct).
> Reviewed and revised 10–12 Oct: batch grouping, the receipt skin, the
> findings from the Chrome pass, and — settled late, after the ticket had left
> it to Arif — **the plan gate**, which now follows a downgrade the way promo
> already did. See "The plan gate" below; it is the one decision here that
> changed after the first build.
> This doc was written ahead of the code on purpose — the redemption model
> (especially *how the QR is used*) was decided at scoping and the build
> implements what's written here. Everything below is now live; the
> implementation pointers at the bottom say where each part lives.

A **voucher** is a seller-issued discount applied to **one order** at
checkout. It comes in two **usages**: a **single-use** voucher is one unique
`KP-XXXX-XXXX` code, one redemption; a **shared code** (`z8r3fducfm`, 30 Oct
2026) is one seller-named word — `SALE345` — that every buyer can type, until
it runs out or ends. See [Shared codes](#shared-codes--one-word-many-buyers-z8r3fducfm).
It is the *buyer-specific* discount lever. The *product-level* lever (promo price /
flash sale, `z8r3fdcw72`, [promo-price.md](./promo-price.md) once it lands) is
a deliberately separate mechanism: a promo changes the **line price**, a
voucher is an **order-level deduction**. They are never one system.

## The model in one paragraph

A `vouchers` row is retailer-scoped and carries a crypto-random, typeable code
(unambiguous alphabet, `KP-XXXX-XXXX` shape), a value (fixed amount in sen or
a percentage of the item subtotal), an optional expiry date, and a status
(`active → redeemed | voided`, plus `expired` judged at read time). Redemption
is atomic with order create — the voucher flips to `redeemed` in the same
mutation that inserts the order, so two checkouts racing one code serialise on
OCC and exactly one wins. A cancelled order returns its voucher to `active`
(any cancel cause — the seller issued it to that buyer). One voucher per
order, no stacking.

A **shared** row differs in exactly one way: it **counts** instead of
flipping. `usage: "shared"` carries a seller-named `code`, a `maxRedemptions`
cap and/or an `endsAt` instant, and a `redeemedCount`; each order that spends
it adds a `voucherRedemptions` row and bumps the count in the same
transaction, and the row is never stored `redeemed` — "all used" and "ended"
are both judged at read time. Everything else (the terms, the frozen
snapshot, the totals seam, the three doors, the hand-back) is the same code
path. See the section below.

## Shared codes — one word, many buyers (`z8r3fducfm`)

**Why.** Yap (14 Oct) and the vendor feedback behind Zaki's 30 Oct ask both
expected what every other shop does: *"use code SALE345 for 20% off"* — one
code on a poster or in a story, used by anyone. The single-use voucher
deliberately left this out of its v1 as a different abuse surface; this is
that revisit, scoped to what was actually asked for: a code the seller names
or picks from suggestions, bounded by **a total number of uses, an end
time, or both — whichever comes first ends it**.

### The decisions

- **A usage on the same table, not a second table.** Arif's draft ticket
  sketched a separate `promoCodes` table with its own redemption doors and a
  second id on `orders`. Rejected: every door, the totals seam, the frozen
  snapshot, the money surfaces, the permission area, the plan gate, the rate
  limiter, the deletion cascade and the buyer's field already exist for
  vouchers, and a shared code needs every one of them unchanged. It differs
  in ONE mechanism — count, don't flip — so it is `vouchers.usage`, and
  `orders.voucherId` points at it like any other voucher. Absent `usage` is
  `single`: no backfill.
- **Scope follows Zaki's ask, not the draft ticket.** Per-buyer limit, min
  spend, max-discount clamp, a scheduled start and "extend a live code" were
  in Arif's sketch and were left out of this first build. They shipped next,
  on the same model, as `z8r3fdz0pw`: see
  [Shared codes v2](#shared-codes-v2--who-qualifies-the-cap-the-start-extending-z8r3fdz0pw).
- **At least one bound is required.** A public code with no cap and no end
  is an open-ended liability. `sharedLimitsError` refuses it on the server
  and the form says why beside the disabled button ("a shared code can't run
  forever"). Zaki's wording — "either a max quantity or a deadline or both".
- **The end is an INSTANT (`endsAt`), not the single-use day convention.** A
  shared code is posted for a happy hour or a weekend, so it ends at a time;
  "works all through the day" would overshoot by hours. Kept as its own
  field rather than overloading `expiresAt` with a second meaning.
- **Cap-first precedence is the actual order of events, not a tie-break.** A
  use can only land while the code is running, so a full cap was filled
  BEFORE any end passed. `resolveVoucherStatus` therefore asks the cap first
  and needs no "which came first" stamp. A full code reads **Used** to the
  seller ("All 50 uses taken") and **`exhausted`** to the buyer — "This code
  has run out" — because "already used" would be a lie to someone who never
  used it.
- **Unique per store among LIVE codes, not globally.** A single-use code is
  globally unique because it is private and a cross-store match must be
  impossible. A shared word is public by design — two stores both running
  `SALE20` is the normal case — and the buyer always types it at a known
  store, so lookup is `(retailerId, code)` (`by_retailer_code`). An ended
  code's word may be reused; `liveSharedVoucher` picks the spendable row,
  else the newest dead one so the refusal names what happened to the word on
  the poster rather than "not found". The same helper backs `create`'s
  "already running" refusal and the form's live availability line, so
  "taken" means exactly "a buyer typing it now would spend that other row".
- **One buyer field, two parsers, no collision.** `parseVoucherCode` tries
  the strict single-use shape first (8 symbols of the no-O/0/I/1 alphabet),
  then the shared word (4–16 letters and digits). `sharedCodeError` refuses
  at create any word the single-use parser would claim (`SALEDEAL`), so no
  real code is ever claimed by both and the order of the parsers can never
  change what a buyer's code means. The `malformed` sentence no longer names
  `KP-XXXX-XXXX`, because two shapes are valid now.
- **`voucherRedemptions` is the truth; `redeemedCount` is the cheap gate.**
  The count is what the door checks (O(1), hot-row safe at SME volume); the
  rows are what the seller's "who used SALE345" reads and — the structural
  reason they exist — what makes the hand-back **idempotent**: a cancel that
  finds no row for its order returns nothing, so a re-cancel or a second
  cancel seam can't decrement twice. Both are written in the same
  transaction, which is the only thing that keeps them equal.
- **Void works on a shared code and corrects nothing retroactively.** Orders
  that already used it keep their discount (the snapshot is frozen); the
  count still drops when one of those orders is later cancelled, so "12
  used" keeps meaning twelve even on a voided row.
- **A shared word is public, and the form says so.** It is meant to be
  guessable — that is what makes it easy to type off a poster — so it is no
  way to keep a deal private: the per-store `checkCode` budget slows a
  dictionary of common words down but cannot stop one. What limits a
  shared code is its BOUNDS, not its secrecy. The code field's helper says
  "It isn't secret: anyone who has the word, or guesses it, can use it", and
  stays on screen under the "is free" line rather than being replaced by it.
  A deal for named buyers is a batch of single-use vouchers.
- **"Who used it" lists the latest `SHARED_USES_LISTED` (200) uses.** The
  list reads one order per use, so a code near the 10,000-use ceiling would
  exceed Convex's per-query read limit and the dialog would error. The query
  takes one row past the limit so `limited` is exact, and the dialog then
  says "Showing the latest 200 orders" instead of the "N more are waiting on
  credits" line — that sentence is count minus rows, which only means
  credits when nothing was cut off.
- **`redeemedAt` is single-use only.** A shared use stamps nothing on the
  code row: each use's time is its `voucherRedemptions.createdAt`, and a
  "last used" stamp would point at a cancelled order the moment that use was
  handed back.

### What the seller sees

- **One "New voucher" dialog, led by "Who can use it"** — *One buyer* (the
  original) or *Everyone*. Picking Everyone swaps the batch count and
  day-expiry for **the code** (typed, upper-cased in place, with three tap-to-
  fill suggestions that follow the value — `SAVE20`, `DEAL20`, `SALE###` —
  and a live "SALE20 is free / already running" line) and **two switches**
  for the bounds, each opening its own control, with a helper that states the
  rule for the combination that is on.
- **The list row says "Shared"** (outlined chip, so it reads as a kind and not
  a second status) and its outcome line is the tally — "12 of 50 used · ends
  31 Oct 2026, 6:00 PM" / "All 50 uses taken" / "Ended … · 12 of 50 used".
  An **"N orders"** button opens the *who used it* dialog (newest first,
  linking each order); it is a READ, so it stays after the code is dead and
  is offered to read-only teammates too. Gated orders are absent from it
  (`forSeller`), and a count the list can't show is said plainly.
- **The share sheet** addresses a crowd — "Use code SALE345 at … for 20% off"
  — and states the bound as what is **left**, not what was set.

### What the buyer sees

The same field, the same link, the same QR. A word typed any way lands
canonical; past the cap they read "This code has run out — every use has
been taken"; past the end, "This voucher has expired". A claim link whose
word ran out between send and open **drops** the discount with that sentence
rather than dead-ending, exactly as a spent single-use code does.

## Shared codes v2 — who qualifies, the cap, the start, extending (`z8r3fdz0pw`)

The rest of Arif's sketch, built on the model above without changing it:
every rule is a field on the same `vouchers` row, judged on the same resolve
path, at the same three doors. Nothing here is enforced only in `checkCode`;
the field's check is for the tick, and the order door decides.

| Rule | Field | Kind | Usages |
|---|---|---|---|
| Per-buyer limit | `perBuyerLimit` | entry rule | shared only |
| Minimum spend | `minSpend` | entry rule | single-use and shared |
| Per-order discount cap | `maxDiscount` | **term** (frozen) | percent vouchers, either usage |
| Scheduled start | `startsAt` | status | shared only |
| Extend a live code | `vouchers.extendShared` | mutation | shared only |

### Entry rules vs terms: the one distinction that matters

An **entry rule** decides whether this buyer and this basket may use the
code. It is judged **once, at redemption**, by `entryRefusal`
(`convex/lib/voucherRedemption.ts`), and never again. A **term** decides
what the code takes off, so it rides `voucherSnapshot` and every recompute
re-applies it. The minimum spend is an entry rule and the cap is a term.
Mixing them up produces the two failures this design prevents: a minimum
re-judged on a recompute would silently strip a discount the buyer was
given (the custom-decline shrinks the basket, and the buyer loses the
code); a cap that wasn't frozen would stop clamping the moment a recompute
re-read the terms. `sharedVouchersV2.test.ts` pins both: "NEVER re-judged
on a recompute" raises the row's minimum past the order and re-prices the
address, and the cap test re-prices the address and sets a delivery fee.

### The per-buyer limit

- **Counted off `voucherRedemptions.waPhone`** with the `by_voucher_phone`
  index: "how many orders has this number placed with this code" is one
  bounded range read inside the order mutation. The number is the one the
  order stores (E.164 digits, `parseBuyerWaPhone`), so `012-345 6789` and
  `+60 12 345 6789` are the same buyer.
- **Race-safe for free.** Two checkouts from one number both read the range
  and both patch the voucher row's `redeemedCount`, so they conflict on OCC
  and the retry is refused `buyer_limit`. `redeemVoucher` re-asserts the
  count from a fresh read too.
- **A cancel gives the buyer's use back**, not just the code's: the hand-back
  deletes the redemption row, which is what the count reads.
- **What a missing number means depends on the door** (`VoucherEntry.phoneless`):
  - **storefront** refuses (`buyer_phone_required`). The form requires the
    number anyway, so only a stale or direct client reaches this.
  - **counter**: an anonymous walk-in's use **counts toward the code's total
    only** (`total_only`). Refusing would turn away a buyer standing at the
    till. The counter panel says so on the applied code ("This sale has no
    buyer number, so it counts toward the code's total only") so the seller
    doesn't assume the limit protected them.
  - **claim** always has a number. The send refuses if that number has used
    the code, and the claim page **drops** the discount (the usual degrade)
    if the buyer used it at the storefront between send and open.
- **Never names the earlier order.** The number is typed, not proven, so
  "This WhatsApp number has already used this code — it's 1 per buyer." is
  the least a per-buyer limit can reveal. The check spends the per-store
  `voucherCheck` budget, so it can't be used to sweep numbers.
- **Known residual: a TARGETED lookup is possible.** Anyone holding a public
  1-per-buyer code can type a specific person's number into `checkCode` and
  learn one bit: "this number has ordered from this store with this code".
  That bit is inherent to a per-buyer limit (the order door would reveal the
  same thing at Place order), and the limiter caps volume, not intent. It was
  accepted for v2 because the bit is narrow (one store, one code, no order,
  no name, no date). Revisit it at the next PDPA review, or if per-buyer
  limits come to cover anything more sensitive than a promo.
- **On by default (1 per buyer) in the New voucher dialog.** Without it a
  public code is reusable by one buyer until the cap. That is the abuse
  case, and the safe answer is the one a seller gets without reading
  anything. Turning it off states the consequence ("one buyer can use it
  again and again until it stops working").

#### The storefront flow: apply now, check when the number arrives (Zaki, 30 Oct 2026)

The ticket sits above "Who's ordering?" on mobile, so most buyers type the
code before their number. Three flows were mocked at 375px and desktop:
**A** apply now and re-check, **B** ask for the number first, **C** hold the
discount struck through. Zaki picked **A**:

1. The code applies at once. A note under the voucher line says
   "1 per buyer · checked against your WhatsApp number".
2. Once step 1's number parses (debounced 600 ms, so finishing a number
   doesn't spend the store's check budget per keystroke), `checkCode` is
   asked again **with the number**. A first use reads
   "✓ 1 per buyer · checked for 012-345 6789". "Checked" only ever names the
   number currently on the page; an edited number reads as not yet checked.
3. A number that has used it takes the code **off**, with the reason under
   the field, before Place order. The code stays typed in the box, and it is
   *held*: if the buyer corrects a mistyped number, the held code is
   re-checked for the new one and comes back without retyping.

**Trap found while rendering it:** the re-check was first written inside
`VoucherField`, but on the storefront that field is mounted only while the
buyer has the voucher line open. A re-check living there would never run
for a buyer who didn't tap it. It is now `usePerBuyerRecheck`, a hook the
checkout page owns, and the notes are `VoucherNotes`, rendered by the ticket
directly under the voucher line (`CheckoutTotals.voucherNote`) where they
show without opening it.

### The minimum spend

- Judged against the **gross item subtotal**, boundary inclusive, like every
  other threshold in the app. It never sees fees or the discount itself.
- Available on **single-use vouchers too**: it is judged on the shared
  resolve path, so restricting it to shared codes would be an arbitrary
  gap with nothing to save.
- **Below the minimum, the code stays applied but reads "not yet".** The
  ticket gives it its own muted voucher line, and the note says exactly
  how much more is needed ("Add RM 10.10 more to use SALE345 — it needs
  RM 30.00 of items."). `previewDiscount` takes nothing off, and
  `voucherCodeForOrder` does not send the code, so the total on screen is
  the total charged. The seller at the counter usually keys the code
  before finishing the cart, and refusing it there would be the wrong
  answer. The panel skin drops its tick and accent for the same state.
- A door that does receive a code below its minimum refuses
  `below_min_spend` with the shortfall in the sentence.

### The per-order cap

`voucherDiscountFor` clamps by `maxDiscount` **before** the subtotal clamp,
so the two compose: 50% up to RM 20 takes RM 3 off a RM 6 basket and RM 20
off a RM 500 one, and never more than the goods. It is offered on a
percentage only. A fixed amount is already its own cap, so the server
refuses one (`voucherValueError`). The form's helper does the arithmetic
("20% off, up to RM 15.00. A basket over RM 75.00 gets the full
RM 15.00."), and buyers see "up to RM 20.00 off" as fine print on the code.

### The percent ceiling: decided as a caution, not a refusal

Arif suggested capping a shared percentage at 50%. **Not adopted.** "First
10 orders free" is a real promotion, and a public code's exposure is limited
by its bounds, the per-buyer limit and the per-order cap, not by its
percentage. A 50% ceiling would block the legitimate case and leave the
abusive one (an unlimited 49% code) untouched. Instead, a shared percentage
at or above `SHARED_PERCENT_CAUTION` (50) with no per-order cap shows an
amber caution under the value that names the control that actually limits
it. Single-use vouchers keep the 100% ceiling they always had.

### The scheduled start

- `startsAt` is an exact instant, like `endsAt`. Until then the row
  resolves `scheduled` at read time (no cron, the same posture as
  `expired`), asked after the cap and the end, since a code can't be spent
  before it starts.
- **A scheduled code holds its word.** `liveSharedVoucher` prefers a
  spendable row, then a scheduled one, then the newest dead one, and
  `holdsSharedWord` is the one meaning of "taken" for create, the live
  availability line and extend.
- The buyer who types it early is told **when**: "This code starts on
  1 Nov 2026, 9:00 AM — try again then." A claim carrying one drops it with
  that sentence.
- Seller: "When it starts" (Right away / Later…) sits before the bounds,
  in the order a sale runs. The row wears an outlined **Scheduled** pill
  and leads with the start. The **Scheduled** chip sits next to Active and
  appears only while a code is waiting (or while it is the chip in use), so
  a store that never schedules one doesn't carry a permanently empty chip.
  The share sheet opens the message with "Starts …".

### Extending a live code

`vouchers.extendShared` takes only `maxRedemptions` and `endsAt`, so a value
change is impossible by construction: there is no argument for it. The rule
(`sharedExtendError`) is "only ever more generous": the cap goes up, the end
moves later, and either bound may be dropped while the other stays. Adding a
bound that wasn't there would cut a public promise short, so it is refused.
It works on a code that **ran out or ended**, because "it sold out by lunch,
add 20 more" is the commonest reason to reach for it. The dialog then reads
"Bring SALE345 back". A revival has to move the bound that **stopped** it:
a code that ran out needs a total above what it has used ("It ran out at 10
uses — raise the total to bring it back"), and an ended code needs a later
end. Without that rule, a later end on a sold-out code saved "fine" and left
it dead (PR #440 review). The dialog's description says the same thing
BEFORE the seller touches anything — it names what stopped this code
(`whatStoppedShared`: ran out, ended, or both) and the move that brings it
back, and it never offers a later end to a code that ran out
(`revivalSentence`, from the hands-on test of that fix: it had said "more
uses or a later end" to a sold-out code with no end at all, and only "ran
out" to one that had also ended). A revival is refused if a newer code has taken the
word since, and a voided code stays voided. It is Pro-gated like `create`,
because a raised cap gives more away.

**Trap found by its test:** the dialog's pickers speak whole minutes, but a
stored end can carry seconds. Rebuilding an untouched end from the pickers
read as "moved earlier" and refused a cap-only raise, so an end the seller
hasn't touched is now the stored instant.

**One sentence for "no bound".** Create, extend and both dialogs refuse a
code with neither a total nor an end in the same words,
`SHARED_NEEDS_A_BOUND`. The extend dialog says it once — the line by the
disabled button — rather than a helper line and a refusal one above the
other; the New voucher dialog states it at the switches and names it as
the blocker in its footer, the pattern every other error there follows.

**A row wraps on content, not on a breakpoint.** A live shared code with
uses carries four actions (orders, Share, Extend, Void), a single-use code
two. Side by side at the same width, the four crushed the text to one word
per line, so the row now gives the text a 16rem basis and lets the actions
drop below it when they don't fit beside it. A code with one use reads
"Its only use is taken", not "All 1 uses taken".

### Placement: Vouchers, not a Promotions tab

Arif's sketch put codes under a Promotions home tab. Judged by meaning, they
stay in **Vouchers**. A shared code is a voucher: the same table, the same
three doors, and the same `vouchers` permission area (issuing gives money
away, so it is its own grant). Promotions (`z8r3fducfd`) is **catalogue
pricing** under the `products` area: a sale price changes a product before
checkout, while a code is redeemed at it. That boundary was already drawn
when Promotions shipped as its own nav entry rather than a tab of Vouchers.
Moving shared codes would split one object across two pages and two grants.

### What each side sees

| State | Seller | Buyer |
|---|---|---|
| Per-buyer, no number yet | "1 per buyer" fine print on the row | "1 per buyer · checked against your WhatsApp number" |
| Per-buyer, checked | — | "✓ 1 per buyer · checked for 012-345 6789" |
| Per-buyer, used up | "N orders" lists each use | Code comes off: "This WhatsApp number has already used this code — it's 1 per buyer." |
| Anonymous counter sale | "…counts toward the code's total only" on the panel | — |
| Under the minimum | "min. spend RM 50.00" on the row | Voucher line reads "not yet" + "Add RM X more…" |
| Capped | "up to RM 20.00 off" on the row | "up to RM 20.00 off" under the voucher line |
| Scheduled | Scheduled pill, "Starts …", own chip | "This code starts on … — try again then." |
| Extended / revived | Row shows the new bounds; toast states them | The code works again |

## The code, the QR and the link — what each is for

Every voucher's share sheet carries three spellings of the same thing. They
exist because the buyer is in one of two places when they redeem:

| Artifact | What it is | Built for |
|---|---|---|
| **The code** (`KP-7F3K-Q2WM`) | The voucher itself, human-typeable | Reading out loud, typing into the storefront checkout field, the seller keying it at the counter |
| **The QR** | The **plain code as text**, QR-encoded | Flashing at the counter — any camera app decodes it to the code instantly |
| **The link** | Storefront checkout URL with `?voucher=<code>` | Sending to the buyer on WhatsApp — opens checkout with the code already applied |

### When and how the buyer uses the QR

The QR is the **counter artifact**. The flow it's designed for:

1. The seller creates the voucher and sends it to the buyer (WhatsApp share
   from the share sheet, or the buyer screenshots the QR in person).
2. The buyer turns up at the stall / counter and **flashes the QR** (or just
   reads the code out).
3. The seller points any phone camera at it — because the QR encodes the
   *plain code text*, the camera preview shows `KP-7F3K-Q2WM` with **no scanner
   app, no deep link, no sign-in** — and keys the code into the counter
   checkout's voucher field. The discount lands on the counter order.

Deliberate decisions behind that:

- **The QR encodes the code, never a URL.** A URL-encoding QR scanned by the
  seller would open the *seller's own storefront checkout* — a buyer surface,
  on the wrong side of the counter. Encoding the bare code keeps the QR
  symmetric: whoever scans it, they get the one thing both sides can use.
- **No seller-side scanner is built in v1.** The phone's own camera already
  reads text QRs for free; a dedicated in-app scanner is a follow-up only if
  real counters ask for it.
- **The QR adds nothing online.** A buyer on their own phone can't scan their
  own screen — that's what the **link** is for: it opens the storefront
  checkout with `?voucher=` pre-filled, so the code is applied without typing.
  The share sheet says which to use where, so the seller never has to explain
  it.

### Where redemption happens, per surface

| Surface | Who enters the code | How |
|---|---|---|
| **Storefront checkout** | The buyer | Types it into the "Have a voucher?" field in the totals card, or arrives via the `?voucher=` link and finds it applied |
| **Counter sale** | The seller | Keys it into the voucher field in the order panel (reading it off the buyer's QR or by ear) |
| **Claim link** | The seller, at send | Applied when sending the claim; frozen into the claim like the line prices, shown on the buyer's claim ticket |

Every door re-validates server-side at order create (never trusting an
earlier check) and refuses with a named reason: invalid, expired, voided,
already used (naming the order), or another voucher already on this order.

## Lifecycle and the seller's controls

- **Create**: single or batch ("create 20"), value + optional expiry (store
  time zone, end of day), plus an optional **name** — the batch's handle, asked
  for where the run is created rather than only offered as a rename afterwards.
  Vouchers list shows status filters (active / redeemed / expired / voided),
  each row linking a redeemed voucher to its order.
- **Rename a batch**: the only bulk *update* that exists, deliberately — see
  "A batch is one object" below.
- **Void**: any time, with an optional private reason. Soft — the row and its
  history stay; the code simply stops redeeming, with copy that says so.
  There is no hard delete in v1. **Void the rest of a batch** in one action,
  named with its own count ("Void 14 left").
- **Expiry** is judged inside the redeem mutation against `Date.now()`; the
  list and the buyer-facing error render it, no cron flips anything.

## A batch is one object, not twenty rows

A "create 20" run listed flat is twenty cards differing in **eight random
characters**. The seller cannot tell which run a code came from, which run they
just made, or act on a run at all. So a batch collapses to **one parent**
carrying the three things they actually need — what it is **called**, how
**big** it is, and what has **become of** it ("20 codes · 14 active, 6 used") —
and expanding it reveals the very same `VoucherList` rows a standalone voucher
uses, so a code reads and behaves identically wherever it is found.

- **Collapsed by default.** The codes are the detail; the *run* is the object,
  and a seller scanning their book is looking for "the Raya giveaway", not for
  `KP-7F3K-Q2WM`.
- **The parent counts the WHOLE run, even under a filter.** With the `active`
  chip on, a part-spent run of 20 still says "20 codes · 14 active, 6 used" and
  adds "· showing 14". Recounting it as the filter's subset would tell the
  seller their run had shrunk.
- **Grouping is a pure helper** (`src/lib/voucher-groups.ts`:
  `groupVouchers(shown, all)`), given both the filtered rows *and* the whole
  book for exactly that reason — not logic buried in a component.
- **The name lives on each row's `note`**, not in a `batches` table. A batch is
  ≤50 rows (`VOUCHER_BATCH_MAX`), so denormalising means the list needs no
  join, and a single voucher's quieter "label" is the same field.
- **An unnamed run falls back to its size and date** ("20 vouchers · 9 Oct"),
  so a batch is never a nameless blob — and the fallback is stated in the
  create dialog's helper line, so the seller knows naming it is worth doing
  *before* they have twenty codes.
- **Bulk work on a run is Rename and Void-remaining, and that is the whole
  set.** A voucher's **value is immutable once issued** — a code already in a
  buyer's hand must never change what it is worth — so the name is the one
  thing left to change, and it is precisely the thing that makes the run
  findable. "Void N left" names its count and **disappears** once nothing is
  left to call off, rather than sitting there promising something the server
  rightly refuses. "Copy all codes" sits inside the expanded run, one per line.

`vouchers.list` returns the **whole book unfiltered** and the client filters
it. Two structural reasons: a parent has to state the run's totals while a chip
shows one child, and the chips then switch with no round trip. The scan was
always full anyway — `expired` is judged at read time, so there is no index
that could answer a status filter.

## The buyer's field: one control, two skins

`voucher-field.tsx` is the **only** voucher input in the app, worn by the
storefront checkout, the counter panel and the claim flow. It has two skins and
they are skins, **not two components**: the open/closed/applied/refused states,
the normalisation, the refusal copy and the shared discount maths are exactly
what must never diverge between the buyer typing a code and the seller keying
one.

| Skin | Where | What it looks like |
|---|---|---|
| `panel` | Counter order panel | House form chrome — a bordered input and an outline button, like every other dashboard field |
| `receipt` | Storefront checkout ticket | Caption-type `+ Voucher code` when closed; open, a **mono** field on the same dotted leader every charge row uses, with a stamped `Apply` set in the TOTAL's type |

The storefront ticket is a *printed receipt*, and a bordered input with an
outline button dropped onto one reads as a form stapled to a document. The
counter keeps the panel skin for the mirror-image reason: receipt grammar would
be as wrong on a dashboard as the chrome was on the ticket.

The receipt skin's small type stops at the **control**: the row is 13px mono,
the input inside it is 16px, because iOS Safari zooms the whole page when a
focused input is under 16px — and every other field on this checkout was
already 16px. The frame-level rule behind the panel skin's spacing lives in
[design-system.md](./design-system.md) (`InputPrefixFrame` lends its control
`min-h-11 px-3 text-base`; a `bare` input is `px-0`, so the end the plate is
not welded to would otherwise put the value hard against the border).

**There is no green "applied" panel.** The receipt's own voucher line already
states the code and what it took off, so a panel beneath it repeated the same
fact in a louder voice. Instead that line **is** the control: it is an
item-style disclosure (`aria-expanded`, a chevron), and tapping it reveals the
remove in the same 44px icon well a product line puts its trash in. The ticket
then has **one** idea of "tap a line to change it", which is the grammar the
item rows already taught.

## The plan gate — and when the field even appears

Two different questions, answered by two helpers in
`convex/lib/voucherRedemption.ts`. They are easy to conflate and must not be:

| Helper | Question | Used by |
|---|---|---|
| `storeCanUseVouchers` | **Could a code redeem here?** | the one shared resolve path, so every door agrees |
| `storeShowsVoucherEntry` | **Should the field even render?** | the storefront payload + the counter panel |

**The gate.** `storeCanUseVouchers` is `getAccess(...).features.vouchers` —
the very predicate the seller's own `assertPlanFeature` reads, so the door a
buyer knocks on and the door the seller issues from can never disagree. It
takes no view of the *caller*: a buyer is anonymous, and a code must not
redeem or refuse based on who is holding the phone. It sits inside
`resolveVoucherForOrder`, which is what makes the storefront, the counter and
the claim-at-send refuse identically; `claimVoucherState` carries it
separately, because a frozen claim never goes back through that path.

**The affordance.** `storeShowsVoucherEntry` is the gate **plus** "has this
store ever issued one". A store that has issued nothing has no code for
anyone to type, so the field could only ever refuse — a dead control on the
surface we most want uncluttered. It is published as one derived bit,
`acceptsVouchers`, beside `paymentsPaused` on the public store payload; never
a count, never the plan.

- **"Ever issued", not "has an ACTIVE voucher."** A live count would hide the
  field at the worst possible moment: the buyer whose code was just voided
  would find no input at all, instead of the honest "This voucher is no
  longer valid" built for exactly that. It also leaks less — "this shop has
  used vouchers at some point" says far less than "there is a live code out
  there right now", which is what the rate limiter exists to protect.
- **The affordance implies the gate, never the reverse.** A `?voucher=` link
  reaches `orders.create` without passing the field, so hiding the control
  can never be the whole answer — the door re-asks.

**What the seller sees.** `vouchers.list` returns `paused`, and an `active`
row then wears **Paused** instead of Active, under a line naming the reason
and the one lever left (Void). The rows really are `active` — what changed is
the store — so saying "Active" would be true of the data and a lie on screen:
the seller would read Active, their buyer would be refused, and the seller
would rightly blame us.

**What the buyer sees.** `"This store isn't accepting vouchers right now."`
Neutral, and it never mentions a plan: the store's billing arrangement is not
its customer's business, and "they downgraded" invites a buyer to judge a
shop for something between the shop and us. It mirrors the payments-paused
copy, the house precedent for this exact shape.

## Guard rails

- Redemption and the code-check endpoint are **rate-limited** (own bucket in
  `convex/lib/rateLimiter.ts`) so codes can't be guessed by hammering.
- The discount applies to the **item subtotal only** — never fees or
  deposits — and is clamped so the total never goes below zero. Minimum-order
  and free-delivery thresholds judge the *pre-discount* subtotal.
- A voucher order still uses one credit (`recordOrderCreated` unchanged).
- **Pro-gated, and the gate follows a downgrade** (ticket left this open as
  "needs Arif's call"; decided by Zaki 12 Oct). Issuing is Pro, and so is
  **redeeming**: below Pro every door refuses with `store_ineligible`.
  Nothing is destroyed — the rows stay `active`, the list and Void stay, and
  re-upgrading makes every unspent code spendable again. See "The plan gate"
  below.

## How it is built

### The subtractive seam — the one thing that could silently overcharge

A voucher is the **first subtractive term** `total` has ever carried, and the
failure it introduces is silent: a recompute site that drops it charges the
buyer **full price**, with no error anywhere. `convex/orders.ts` has **six**
sites that recompute an existing order's total (mockup submit, mockup
re-quote, custom-decline, pickup switch, address re-price, seller
set-delivery-fee), and before this feature all six **hand-listed** the extras
they happened to know about — a list that had already drifted: every one of
them omitted `securityDeposit`.

So the discount is not threaded through six lists. It rides one helper:

- **`orderExtras(order)`** (`convex/lib/order.ts`) is the single author for
  "what is already folded into this order's total". Every recompute site
  spreads it and overrides only the term it is changing:

  ```ts
  computeOrderTotals(order.items, {
    ...orderExtras(order),
    deliveryFee: resolved.snapshot?.fee,
  })
  ```

  A future extra is therefore carried by all six the moment it is added there.
- **`computeOrderTotals`** returns `{ subtotal, discount, total }`. Each site
  patches `voucherDiscount: storedDiscount(discount)` beside `total`.
- The seam carries the voucher's **terms**, not a frozen sen figure. "10% off
  this order" has to follow the subtotal when the custom-decline keeps part of
  a mixed basket; a fixed voucher re-clamps to whatever the basket is now
  worth. Freezing the computed sen would leave a figure matching nothing.
- **`orders.subtotal` stays GROSS.** The min-order rules and the free-delivery
  thresholds read it, so netting the discount in would silently move every
  threshold in the app. `total` is the net number.
- `revenueExcludingDeposit` needs no voucher term — `total` is already net, so
  every revenue surface (CRM `totalSpent`, Insights) counts the real money
  without knowing vouchers exist.

Both halves of that are test-enforced, in `convex/orderTotalsSeam.test.ts`:

- a **source scan** fails any `computeOrderTotals` call in `convex/` that
  hand-lists extras while recomputing an existing order (a call either spreads
  `...orderExtras(...)` or is a classified order-CREATE door);
- a **count** pins that every site binding `discount` also persists it.

And behaviourally, in `convex/voucherRedemption.test.ts`: all six sites are
exercised with a live voucher, and each proof is mutation-tested — dropping the
voucher at a site turns its own test red.

### The money rule

`voucherDiscountFor` (`convex/lib/vouchers.ts`) is the only place the discount
is computed, server and client both. The base and the cap are the **item
subtotal**, which is what makes the two guard rails one clamp: the discount
can never reach a fee or a deposit, and `subtotal - min(d, subtotal)` can never
drive the total below zero because every other term is additive. Percentages
round to the nearest sen **once**, here, so the storefront preview and the
stored total agree exactly. A non-finite value floors to 0 (`Math.max(0, NaN)`
is `NaN`, which would otherwise write an unreadable order — found by this
file's own test).

### Where each piece lives

| Piece | Where |
|---|---|
| Code, value, status, refusal copy, `ClaimVoucherState` + `claimVoucherDiscount` (pure — the claim page loads it in the browser); shared-code parser, bounds rule and status precedence | `convex/lib/vouchers.ts` |
| Shared-code lookup (`liveSharedVoucher`), the count-not-flip redeem and the idempotent hand-back | `convex/lib/voucherRedemption.ts` |
| Shared-code create (`insertSharedCode`), `sharedCodeAvailable`, `listRedemptions`, `extendShared` | `convex/vouchers.ts` |
| v2 rules — `sharedLimitsError` (start, per-buyer), `sharedExtendError`, `minSpendError`, `voucherFinePrint`, the cap in `voucherDiscountFor` | `convex/lib/vouchers.ts` |
| v2 entry rules — `entryRefusal`, `VoucherEntry`, `holdsSharedWord`, `voucherTermsOf` | `convex/lib/voucherRedemption.ts` |
| Flow A re-check + the ticket's notes — `usePerBuyerRecheck`, `VoucherNotes`, `voucherCodeForOrder` | `src/components/vouchers/voucher-field.tsx` |
| Extend dialog; the shared switch row | `src/components/vouchers/extend-shared-dialog.tsx`, `limit-row.tsx` |
| "Who used it" dialog | `src/components/vouchers/voucher-uses-dialog.tsx` |
| Resolve / redeem / release / claim state (ctx) | `convex/lib/voucherRedemption.ts` |
| Totals seam + `orderExtras` | `convex/lib/order.ts` |
| Issue, rename-batch, void, void-batch, list, code check | `convex/vouchers.ts` |
| Storefront redemption | `orders.create` (`voucherCode` arg) |
| Counter redemption | `counterCheckout.createOrderFromSession` (explicit `voucherCode` arg) |
| Claim redemption | `orderClaims.sendClaim` freezes, `commit` spends |
| Hand-back on cancel | `reverseCancellationEffects` + `declineMockupItem` |
| Seller surface | `src/routes/app.vouchers.index.tsx`, `src/components/vouchers/*` |
| Buyer / counter field | `src/components/vouchers/voucher-field.tsx` (ONE control, two skins) |
| Batch grouping (pure) | `src/lib/voucher-groups.ts` + `voucher-batch-card.tsx` |
| `?voucher=` carried across browsing | `src/hooks/useVoucherParam.ts` |
| Tenant teardown | `voucherRedemptions` then `vouchers` phases in `convex/lib/accountDeletion.ts` |

### A refused code is a state to fix, not an error to read

Both doors re-validate, so either can refuse a code the field checked happily
a minute earlier — someone else spent it, the seller voided it, the store
dropped below Pro. When `orders.create` refuses, the checkout **removes the
voucher** (which corrects the ticket's total on the spot) and hands the
sentence back to the field, via `serverRefusal`. It used to land as a
page-level banner while the applied line and its discount stayed drawn, so
the buyer read a total nobody was going to charge them.

This mirrors the price-changed guard exactly (`priceChangedErrorOf` →
`voucherRefusedErrorOf`, both in `src/lib/format.ts`): a typed payload the
surface turns into a state, never a string it prints over the page. The
field's own refusal always outranks the server's, because the buyer has typed
since the server spoke.

### The seller's list is a read of ORDER data

A spent voucher names the order it went to, which puts `vouchers.list` under
the T3.1 rule — *a gated order is invisible*. The order goes through
`forSeller` **in the query's own body**, so the allowlist governs
structurally: the two fields taken (`shortId`, `total`) are both on
`GATED_ORDER_FIELDS` and leak nothing today, but the next field added here
would be picked off a redacted row rather than a raw one. `toRow` is pure and
takes the already-redacted summary, which is what keeps the redaction visible
at the surface that answers for it.

Excusing the read in `OPEN_READS` instead would have stated a safety it
doesn't check — the exact failure `creditLockCoverage.test.ts` was written
about (*"a list that states a completeness it doesn't check is worse than no
list"*). `vouchers` and `orderClaims` are both in `READ_MODULES` now;
`orderClaims.getByToken` is excused there as a **buyer** door, since the gate
withholds an order from the seller and never from the buyer who placed it.

### Decisions worth keeping

- **Codes are globally unique**, not per store (`by_code`). A code typed at the
  wrong store resolves to a row whose `retailerId` does not match and is
  refused as "not valid for this store" — it can never silently match a
  *different* store's voucher, which a per-store index would have allowed the
  moment two stores minted the same 8 symbols. The refusal never confirms the
  code exists somewhere.
- **`checkCode` is a mutation, not a query.** A voucher code is the only
  guessable secret the storefront accepts, so the check has to spend
  rate-limiter budget — and the limiter can only be spent from a mutation. It
  writes nothing else. A free query here would be an unmetered oracle for
  guessing codes.
- **No character repair in `normalizeVoucherCode`.** Case, spaces, dashes and
  a missing `KP-` are all folded; a typed `O`/`0`/`I`/`1` is **rejected**,
  because no real code contains one and "repairing" it could map two distinct
  codes onto one and hand a buyer somebody else's voucher.
- **`vouchers` is its own permission area.** Issuing gives money away, so it
  must not arrive free with `orders: write` ("move this order to packed").
  Redeeming at the counter needs `orders: write` only, so a front-desk helper
  can take a voucher without being able to mint one. Left off both team
  presets deliberately.
- **The route is not plan-walled, but redemption is.** The LIST stays open on
  a downgraded store — it still has codes to read and void — while every
  redemption door refuses. The first build had redemption survive a downgrade,
  on the reasoning that outstanding codes are promises already made. That was
  wrong twice over: the ticket never settled plan gating (it says "needs
  Arif's call"), and the sibling feature had already settled the shape —
  `isPromoActive` folds the plan in, which is *"why a downgraded store's
  storefront quietly sells at list while the config survives"*. A capability
  that survives a downgrade is not one.
- **Void refuses a redeemed voucher.** It has been spent and the order is the
  record; voiding one would imply the discount could be clawed back off a
  placed order. `voidBatch` therefore skips spent rows and names the skip
  rather than refusing a part-spent run.
- **A voided voucher is never resurrected by a cancellation.** The seller
  withdrew it on purpose.

- **What a claim is worth is answered per STATUS, and the completed case is a
  trap.** Once a claim completes, its voucher is `redeemed` — so a row that
  re-judged the voucher live would get `dropped` back and print the **gross**
  for exactly the claims where the discount definitely happened. So
  `ClaimListRow.total` reads the **order's** recorded total when there is one,
  and items-minus-the-live-voucher otherwise. Judging live for an open claim is
  the right answer there for the mirror-image reason: a voucher voided after
  sending really has stopped discounting, and the seller's list should say so
  at the same moment the buyer's page does. Fees stay out of an open claim's
  figure — they depend on choices the buyer hasn't made and only ever ADD.
  Both halves are mutation-tested; dropping the order short-circuit turns the
  completed case red with `expected 3000 to be 2500`.

- **`claimVoucherDiscount` is the one author of what a claim's voucher takes
  off** (in the pure `convex/lib/vouchers.ts`, because the buyer's claim page
  calls it in the browser — it moved out of `voucherRedemption.ts`, whose
  `getAccess` import dragged `convex/subscriptions.ts` into the client, z8r3fdv49m). Only an `applied` voucher discounts — a `dropped` one must price at
  FULL and say why, which is the entire reason the claim degrades instead of
  refusing. The rule was briefly written twice (the ticket's maths, then the
  page header), and the second copy is exactly how the header came to print the
  **gross** items figure: a claim sent at RM 32.00 greeted the buyer with
  "RM 40.00" directly above a ticket reading "TOTAL RM 32.00" (found in the
  hands-on pass, 12 Oct). The header subtracts the voucher but **not** fees,
  which depend on choices the buyer hasn't made yet and only ever ADD.

- **A batch's NAME is renameable; its value is not.** `renameBatch` is the only
  bulk update, because a code in a buyer's hand must not change what it is
  worth. It writes a private label, so it is classified in
  `creditLockCoverage.test.ts` as having nothing to meter.

- **The list's lock is the house hook, not a hand-derived one.** The first
  build read `isStoreReadOnly(retailer)` directly and dropped its second
  `isAdmin` argument, so an **admin** was shown a seller's sentence — "Your
  store is view-only until the subscription is settled" — over a New-voucher
  button the server would happily have accepted (reported by Zaki, 10 Oct).
  The page now uses `useAreaLock("vouchers")` + `ViewOnlyNote` like every other
  area, which is admin-aware by construction. The lesson is general: a lock
  re-derived at a call site is a lock that will disagree with the server.

- **Both counter doors take the code as an ARGUMENT, never off the session
  draft.** The draft is a 700 ms debounced autosave — `items` are already
  passed explicitly for exactly that reason — so a door reading it would drop a
  code applied in the second before the seller tapped Create or Send, *after*
  the panel had shown the discount. `counterCheckout.createOrderFromSession`
  and `orderClaims.sendClaim` take `voucherCode`; `draft.voucherCode` exists
  only to restore the field on a refresh. Pinned by "the door reads the
  ARGUMENT, never the debounced draft".

- **A `?voucher=` link is tapped BEFORE shopping, so the code is held.** The
  link points at checkout (that is where it is spent), but the buyer it was
  sent to on WhatsApp has an empty cart — they land on "Your cart is empty ·
  Browse the store", and in-store navigation carries no params. So every
  storefront route captures the code to per-store sessionStorage
  (`useVoucherParam`, the `useSourceAttribution` sibling), checkout reads it
  back, the empty-cart panel SAYS it is being held, and it is forgotten once
  spent so a second checkout in the same tab can't re-apply a redeemed code.

### "N used" counts orders, not rows (31 Oct 2026)

The Vouchers header read "1 active · 0 used" beside a shared row saying "1 of
50 used": `counts.redeemed` counts rows whose resolved status is `redeemed`,
which a live shared code never is. `vouchers.list` now also returns `used` — a
spent single-use voucher counts one, a shared code counts its `redeemedCount`
whatever it currently reads — and the header prints that. The status chips keep
`counts` (they filter rows). Pinned in `vouchers.test.ts` and `sharedVouchers.test.ts`.

### The bugs found in passing

`orders.updateDeliveryAddress` refuses `self_collect` but **not** `booking`, so
a booking order could reach it — and with `securityDeposit` missing from its
hand-written extras, the deposit was silently deleted from `total`. Spreading
`orderExtras(order)` fixes it; `voucherRedemption.test.ts` pins it with a test
that fails if the site is reverted to its literal.

And a second, which is **promo's, not this feature's**: the counter panel
priced its lines from the LIST price while `createOrderFromSession` resolved
the PROMO one, so the seller confirmed RM50 and the order recorded RM40 — real
money at a cash till. It was reproduced with **no voucher involved**, which is
how it was established as pre-existing, and fixed here because it blocked
testing the counter's voucher line. See
[promo-price.md](./promo-price.md#the-counter-panel-quotes-a-price-so-it-calls-the-same-helper).

And a third, this one the feature's own: **every seller-side figure for a
claim printed the GROSS items total.** A claim sent at RM 32.00 read
"RM 40.00" in the claims list, on the frozen "waiting on buyer" screen (whose
whole job is to mirror what the buyer is looking at) and in the buyer's own
page header, directly above its own ticket reading "TOTAL RM 32.00".
`itemsTotal` equalled the total until a voucher could subtract from it; all
four surfaces now take the net. See "What a claim is worth" below.
