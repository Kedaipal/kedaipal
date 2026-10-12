# Vouchers — seller-issued single-use codes

> **Status: shipped** (ClickUp `z8r3fdr617`, scoped 8 Oct 2026, built 9 Oct).
> Reviewed and revised 10–12 Oct (batch grouping, the receipt skin, four
> findings from the Chrome pass).
> This doc was written ahead of the code on purpose — the redemption model
> (especially *how the QR is used*) was decided at scoping and the build
> implements what's written here. Everything below is now live; the
> implementation pointers at the bottom say where each part lives.

A **voucher** is a seller-issued, single-use discount: one voucher = one
unique code = one redemption, applied to **one order** at checkout. It is the
*buyer-specific* discount lever. The *product-level* lever (promo price /
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

## Guard rails

- Redemption and the code-check endpoint are **rate-limited** (own bucket in
  `convex/lib/rateLimiter.ts`) so codes can't be guessed by hammering.
- The discount applies to the **item subtotal only** — never fees or
  deposits — and is clamped so the total never goes below zero. Minimum-order
  and free-delivery thresholds judge the *pre-discount* subtotal.
- A voucher order still uses one credit (`recordOrderCreated` unchanged).
- Pro-gated (decided 8 Oct): creating vouchers is a Pro capability; already
  -issued history stays visible on a downgraded store.

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
| Code, value, status, refusal copy (pure) | `convex/lib/vouchers.ts` |
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
| Tenant teardown | `vouchers` phase in `convex/lib/accountDeletion.ts` |

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
- **The route is not plan-walled.** Issuing is the Pro capability; the LIST is
  not, because a downgraded store still has outstanding codes it has to honour
  and void. The gate lands on one button, with its reason beside it.
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
  off.** Only an `applied` voucher discounts — a `dropped` one must price at
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
