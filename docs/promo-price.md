# Promo price & flash sale

> ClickUp `z8r3fdcw72`. Pro-gated. Shipped on the promo branch alongside the
> house countdown (`z8r3fdr60v`).

A **promotion** is a lower price for a while that snaps back by itself. A
**flash sale** is the same promotion with three additions — a unit cap, a max
per order, and a payment hold — not a second pricing system.

Deliberately separate from [vouchers](./vouchers.md): a promotion changes the
**line price**, a voucher is an **order-level deduction**. They never merge.

## The model

| Where | What |
|---|---|
| `products.promo` | One config per product: `runId`, `label?`, `startsAt?`, `endsAt?`, `unitCap?`, `maxPerOrder?`, `payWithinMinutes?` |
| `productVariants.promoPrice` | The sale price per sellable line, in sen; `< price` |
| `orders.items[].listPrice` | Frozen **only** when the line sold below it |
| `orders.items[].promoRunId` | Which run it sold under — what the cap tallies |

Nothing is flipped by a cron. Whether a promotion applies is resolved at read
time against `Date.now()` (the `isEventPassed` precedent), so an ended
promotion resolves to the list price everywhere, at once.

### `runId` — why a re-run starts a fresh pool

`sanitizePromo` keeps the existing `runId` when the seller edits a label or
tightens a cap, and mints a new one **only when the window changes**. The cap
tally groups sold units by `runId`, so re-running a sale starts its pool at
zero while a cap edit mid-sale does not wipe what has already sold.

A capped run always gets a concrete `startsAt` (stamped `now` when the seller
said "start now"), because the tally needs a left bound to stay a bounded
index read.

## Where the price is decided

`convex/lib/promo.ts` is the **one** authority — `effectivePrice(variant,
product, plan, now, unitsLeft)`. Every order door calls it:

| Door | Note |
|---|---|
| `orders.create` | Freezes `price` + `listPrice` + `promoRunId`; runs the cap, max-per-order and price-changed guards |
| `counterCheckout.createOrderFromSession` | Defaults to the effective price; a seller price adjustment overrides it and is **not** a promo sale. Counts against the cap, but deliberately does **not** enforce `maxPerOrder` — the seller is standing there, and a per-order limit exists to stop one online buyer clearing the pool, not to argue with the person at the counter |
| `orderClaims.sendClaim` | Locks the sale price at send; the unit counts against the pool at **commit** (the price-lock rule wins) |
| `bookings.requestBooking` | Nightly/package rate only — no flash mechanics (capacity already caps a stay); the weekend surcharge keeps its own rate |

Every door reads the run's **units counter** (`promoUnitsTaken`, next
section) inside its mutation. Convex mutations are OCC transactions and the
counter row is in every racing cart's read and write set, so the row *is* the
lock: two carts after the last unit serialise and the loser gets the
price-changed refusal. A cancelled or auto-expired order hands its units back
through the cancel seam.

### Units counter

> ClickUp `86eyjv002`. Every "how many are left" — storefront, category page,
> counter, claim link, checkout — is **one point read of the run's counter**,
> never a scan of orders.

The original count, `tallyPromoUnits`, *collects the store's orders* across
the sale window, once per capped product. That broke in two ways, both
measured on dev (2 Nov, a 20-product capped sale with 2,000 orders in the
window):

- **The catalogue.** `products.list` and `categories.getPublicPage` are public
  and reactive, so the order range sat in their read set: every new order, on
  any product, re-ran them for every open tab (51 re-runs across 24 orders),
  each costing capped products × orders. At that volume they read 17.9 MB, over
  Convex's **16 MiB per-transaction limit** — the storefront, category page,
  counter picker and products page all went down. The break point is roughly
  325 orders in the window for 20 capped products.
- **Checkout.** Each door tallied once per capped product in the cart: a
  7-product flash cart read 15.8 MiB. One more sale product, or a longer sale,
  and the **buyer could not check out** — a limit set by how busy the shop had
  been, which no seller or buyer could see or reason about.

So everything reads `promoRunUnits` — one row per (product, run), `units` =
sale units held by non-cancelled orders. One point read whatever the order
history; only a sale of *that* product moves the row (24 orders → 19 re-runs,
each a flat cost). And because the doors gate on it, it has to be exactly
right, which is what the rest of this section is about.

**How it stays equal to the tally** (all in `convex/lib/promoTally.ts`):

| When | What moves the row | Where |
|---|---|---|
| A capped run is saved | **Minted**: 0 for a run id the save just minted (no order can carry it — so a bulk promotion's apply batch reads nothing), the **tally** for a kept run | `ensurePromoRunCounter` ← `products.create` / `products.update` / the promotion apply queue |
| An order is created | `+` its sale units. A run with **no** row is left alone (see below): minting there would tally the window a second time inside the door, which already did | `subscriptionUsage.recordOrderCreated` — every door calls it |
| An order is cancelled (seller, buyer, the unpaid-flash expiry, an admin hard-delete of a live order) | `−` its sale units | `subscriptionUsage.recordOrderCancelled` — the one cancel seam |
| A declined custom line leaves a live order | `−` that line's units | `orders.declineMockupItem` (the only path that drops a line without cancelling) |
| The product is permanently deleted | Rows deleted | `deleteProductCascade` (also the account-deletion cascade) |

The seams move the row **only for an order the tally would count**: the
product's *current* run, created inside its *current* window. That second
condition is load-bearing, not tidiness — adding a cap to a running
**uncapped** sale keeps its `runId` but stamps `startsAt = now`, which moves the
tally's window past the sales made before the cap. Cancelling one of those
older orders must not move the counter, because the tally never counted it.
(Worth knowing on its own: that means adding a cap mid-sale starts the pool
fresh, even though the run id is kept.)

**Absent row = a run that was live before the table shipped.** Every reader
(doors included) falls back to the tally for it, so it behaves exactly as
before this change until the backfill (or the run's next save) mints it. A
sale doesn't mint it, on purpose: minting there would tally the window a
second time inside the door that just tallied it. This is the widen step;
`migrations:backfillPromoRunUnits` is the migrate step (mints every capped
run's row from the tally, **one product per transaction** via
`backfillPromoRunUnitsOne` — ten tallies in one page blew the read limit on
dev). It is **also a drift check**, safe to re-run any time: a row that
disagrees with the tally is reset to it and reported, so `drifted: 0` is the
healthy answer. The narrow step, deleting the fallback from `promoUnitsTaken`,
waits until the backfill has run on prod — **run it straight after the
deploy**, because a pre-existing live sale keeps the old, limit-bound reads
until it does.

`promoRunUnits.test.ts` pins counter ≡ tally across every row of the table,
through the real public mutations and the cron, and each seam is
mutation-tested: delete any one of them and a test goes red. It also proves
checkout gates on the counter (a counter at the cap prices the next sale at
list) and **fails if any Convex function but the backfill calls
`tallyPromoUnits`** — the guard against the scan creeping back into a door.

### The counter panel quotes a price, so it calls the same helper

`createOrderFromSession` defaults to the effective price, which makes the
**seller's own counter panel** a price-quoting surface and not merely a form:
the number on it is the one the seller reads out and takes cash for. It priced
every line from `variant.price` — the **list** price — while the mutation
resolved the promo one, so a basket of RM40-promo stock showed "Review order ·
RM 50.00" and recorded RM40. On a cash sale that gap is real money, counted
wrong at the till, with nothing on either side flagging it.

`src/lib/promo.ts` already exported `effectiveVariantPrice`; the counter simply
never called it. One `counterPrice(variant, product)` helper in
`src/routes/app.checkout.tsx` now feeds **all four** readers — the line row,
the variant picker, the draft rehydrate and the "from" range — so the panel's
number and the server's cannot part again. Found while testing vouchers
(`z8r3fdr617`) and **reproduced with no voucher involved**, which is what
established it as promo's bug rather than the voucher seam's.

## The guards

- **Cap straddle** — a cart wanting 5 when 3 remain is refused, never split
  across two prices. Typed `ConvexError`: `{ kind: "price_changed", reason:
  "units", … }`.
- **Max per order** — refused with copy naming the limit.
- **Price-changed** — `orders.create` takes an optional `expectedSubtotal`
  (the item subtotal the buyer was shown). A mismatch is refused with the live
  per-line prices rather than charging a different number. Absent (a stale
  client) keeps the old behaviour, so the field is widen-only.
- **Payment hold** — a capped sale with a pay-within window stamps
  `orders.paymentDueAt`; the existing `cancelUnpaidDueOrders` cron cancels it
  unpaid, restoring stock, refunding the credit and releasing the units. With
  several flash products in one cart the **strictest** window wins.

Read the typed refusal with `priceChangedErrorOf(err)` (`src/lib/format.ts`).
Do **not** pass it to `convexErrorMessage` — it would stringify to
`[object Object]`.

## What the seller sees

The **Promotion** card sits directly under pricing in the product form —
promo is a price decision, and the cards below it are about how a product may
be ordered.

Start and duration are **two separate questions** ("When does it start?" /
"How long does it run?"), with a computed sentence underneath saying what they
add up to: *"Runs from the moment you save until Fri, Oct 9, 11:00 AM."* One
combined "duration" control reads as a start offset — 30 min, from now or
lasting 30 min? — which is exactly the confusion this layout removes. A
scheduled start anchors the duration to the **start**, or a drop set for
tonight would end before it opened.

Sale prices are typed per line in the card (with a `%` quick fill that writes
absolute, 5-sen-rounded values) but stored on the **same variant rows the
pricing grid owns**, so a line added, renamed or removed there can never drift
from the promotion.

Flash extras hide behind the reason they don't apply on booking/event
listings, mirroring `assertFlashFieldsAllowed` — the fields never vanish
silently. The credits nudge appears when the cap exceeds the store's balance.

**Starting over — "Clear sale prices & settings"** (`z8r3fdudm3`). Switching
the promotion off only *hides* its fields: label, window, caps and every sale
price come back on the next switch-on. So the card's foot carries one control
that resets the whole card in one tap (draft → `EMPTY_PROMO_DRAFT`, every
line's sale price → blank, in one `onPromoPrices` batch). It **keeps the
switch where it was**, because starting over is not switching off, and it
resets the form only: nothing reaches the store until Save, so there's no
confirm. **Undo** sits inline where the button was, never in a toast. A
toast's handler would run with the props of the render that cleared, and the
form's price setter maps the editor rows it closed over, so a late Undo would
overwrite anything typed since. Any edit drops the Undo. With nothing to
clear, the button is disabled and the line says so (`promoFieldsDirty`).

**A switched-on promotion must put something on sale.** `promoDraftIssue`
takes the card's rows, and on with every sale price blank it says *"Set a
sale price on at least one line, or switch the promotion off."* This is the
one rule with **no server twin**: the server would store the config, and the
buyer would get a promotion with nothing in it. Clear makes that state one tap
away, so the form refuses it. The full form now gates Save on
`promoDraftValid` (it previously relied on the server's refusals), the wizard
gates its Price step, and the issue line is the `data-form-error` the focus
helper scrolls to.

**Pro gate:** setting is gated (disabled-with-reason in place, the
`EventFields` posture); **clearing never is**, so a store that drops to
Starter can always switch a promotion off. The toggle is disabled only while
it's **off** on a locked store. It used to be disabled outright, which left a
downgraded seller unable to remove a paused promotion, and (because every
save re-sends a switched-on promotion and hits the Pro gate) unable to save
any other edit to that product. The locked card says the promotion is paused
and how to remove it. Clear is not offered there, because switching off is
the move. The rest of the card (sale prices, Quick fill, label, window,
extras) is **read-only** under the lock, inside a disabled `<fieldset>`:
every save that keeps the promotion on is refused by the server's Pro gate,
so an editable field there would be wrong-but-enabled (PR #365 review). The
switch sits outside the fieldset and stays live. A promotion on a downgraded store is *paused*, not deleted:
`effectivePrice` returns the list price and the storefront publishes no
`promoState` at all.

**The wizard offers the promotion too**, as a collapsed optional block at the
foot of its Price step — not a step of its own. The first cut left it out on
the reasoning that creating a product and merchandising it are different jobs,
which read fine on paper and badly in practice: a seller setting up a flash
sale had to create the product, leave the wizard, reopen it in the full form
and set the promotion there, for a feature whose whole point is being quick
off the mark. It validates through the same `promoDraftIssue` at the step that
owns it and submits through the same `promoSubmitValue`, so there is one
author for the rules and the wizard cannot drift from the form.

## What the buyer sees

`productWithVariants` publishes a buyer-safe `promoState` (`phase`, `label`,
`startsAt`, `endsAt`, `unitCap`, `unitsLeft`, `maxPerOrder`,
`payWithinMinutes`) plus `promoPriceFrom`, and **strips every `promoPrice`**
when the promotion can't apply — so the storefront can never show a sale the order doors would refuse.
The raw config stays owner-only.

`src/lib/promo.ts` is the storefront half. It re-derives nothing; it owns the
**clock at BOTH ends** — `phase` is a server read and nothing writes at
`startsAt` or `endsAt`, so a Convex subscription has no reason to re-run at
either boundary. A page sitting on a teaser therefore flips to the sale price
on its own clock at `startsAt` (`promoTeasing` / `promoLive`), which is why
`promoPriceFrom` is published for a scheduled run and not only a live one.
Only the close was handled at first; the open was missing, and the buyer the
teaser had told to wait watched the countdown hit zero, still saw the list
price, ordered, and hit a refusal their client could neither explain nor
clear (PR #350 review). It stops quoting a sale the moment the window
shuts. `usePromoClock` ticks only while there is a deadline to watch.

- **Cards** carry the whole sale story *on the image* — badge, countdown,
  units left — so a card on sale is exactly as tall as its neighbour and the
  grid never staggers. The badge ranks **last** in the top-left chain: every
  state above it (fully booked, out of stock, low stock) is a reason the buyer
  may not be able to order, which outranks a reason to want to. Navy + bolt
  when timed, mint for a plain discount. A teaser names the price *and* the
  wait ("RM 31.50 in 1h 11m"); add-to-cart stays at the list price until the
  drop. A **live timed** sale also gives the card a mint ring and a slow
  heartbeat (`animate-kp-flash-glow`, `src/styles.css`): a halo that leaves
  the card **outward only**, fades, and rests before the next beat. It never
  contracts back in (`z8r3fdudm2`). A plain discount never pulses, because
  urgency you can't run out of isn't urgency. The keyframes paint the ring
  themselves, since an animation owns the whole `box-shadow` and would
  otherwise erase `ring-2`. Under reduced motion the static ring is all that
  remains. The halo reaches **12px** — the grid's `gap-3`, and the room the
  Popular shelf's scroller leaves on every side. A horizontal scroller clips
  the Y axis too, so any scroller holding a card needs that 12px top and
  bottom, not just at the sides, or the pulse is cut flat above and below.
- **Product page** mounts the countdown band at the top and puts "12 of 30
  left at this price" above the buy box — the one fact the band can't carry.
- **Checkout** mounts the same band, driven by the flash that ends **soonest**
  (the one about to change what they pay), reconciles the cart against the
  live catalogue, and on any change disables Place order with a named reason
  plus one button that accepts the new prices and says what the items come to.

The countdown is always the page's **top band** — never an inline widget. See
[claim-links.md](./claim-links.md) for the strip itself.

## Money surfaces

`promoDiscountTotal` (`convex/lib/promo.ts`) is the one author of "what the
sale cost on this order": Σ (listPrice − price) × qty over the lines that sold
below list, read from the frozen pair so it stays true after the promotion
ends, is re-run or is deleted.

- CSV gains a **Promo discount** column, placed **outside** the Subtotal→Total
  addend run: the discount is already inside each frozen line price, so it is
  reported, never summed.
- The receipt PDF prints **"was RM X each"** under a discounted line.
- Insights needs nothing: line revenue is the frozen sale price, correct by
  construction.

## Promotions (bulk)

`z8r3fducfd` — many products on **one** promotion, set, edited and ended as
one. Built for Yap ("I got 20 item to set"): before it, a 20-product happy hour
was 20 product-form edits to start and 20 more to end.

### The promotion is a handle, not a price

A promotion (`promotions`) holds the terms — percent, window, label, flash
extras — and its members (`promotionMembers`) hold each product's reviewed
sale prices. Every write **fans out to the existing single-product fields**:
`products.promo` (through `sanitizePromo`, so the `runId` rule is the same one)
and `productVariants.promoPrice`. Nothing that prices anything changed:
`effectivePrice`, the tally, the order doors and the storefront don't know
promotions exist. Ending a promotion clears what it wrote; the frozen order
lines (`listPrice`, `promoRunId`) are untouched, so receipts and the CSV stay
right.

**Membership is its own table, not a field on `products`.** The ticket
proposed `products.promo.promotionId`. A new field on an existing table
poisons the shared dev deployment for every branch without it the moment one
row carries it (see the September collision), and it would have needed a
migration for nothing — `promotionMembers.by_product` answers "is this product
held?" in one index read.

### The queue

`200 products × 100 choices` is past one transaction's write budget, so a
member is a tiny state machine — `pending → applied`, `clearing → cleared`,
plus a terminal `moved` — worked by `runQueue` in batches of
`PROMOTION_BATCH_WRITES`. The first batch runs inside the seller's own
mutation (a few dozen products are live the moment they tap); the rest is a
scheduled `processQueue` continuation, and the dashboard reads **Applying…**
until it lands. Clearing runs before applying, so "End now" takes prices off
first. One promotion carries at most `MAX_PROMOTION_PRICES` (4,000) sale
prices, which keeps its own reads (detail page, edit review) inside a query;
the review's Save names the limit before the seller gets there.

### Rules worth knowing

- **One promotion per product, never taken over silently.** A product already
  on another *open* promotion, or carrying its own live/scheduled sale, is
  disabled in the picker with its reason and joins only by an explicit
  **Move here** — `create`/`addProducts` refuse anything already on sale that
  isn't named in `move`. A promotion whose window has passed holds nothing.
- **The start is always stored concrete.** A capped "start now" product stamps
  its own start, and `sanitizePromo` keeps a run (and its unit-cap pool) only
  while the window it's handed is identical. A promotion that left its start
  open would hand every later edit `undefined` against that stamp — **a mere
  rename reset every product's sold count** (caught by test). "Now" on an edit
  means "keep running from when it started".
- **Leaving is decided by `runId`, not by state.** An edit re-queues every
  member as `pending` without touching its product, so mid-queue a "pending"
  member can still have this promotion's sale on it. **End now**, **×** and a
  window that closes mid-queue all move a member that has EVER written its
  product (`runId` set) to `clearing`, never straight to `cleared`
  (`leavingState`, `applyMember`'s catch). Before this, ending a large
  promotion mid-edit left products selling at the sale price under a
  promotion that read "Ended" (PR #368 review).
- **An edit's terms reach every open member.** `update` re-queues the members
  it was sent with their new prices, and every *other* open member (one a
  teammate added while the edit was open) with its own prices, so no product
  is left on the old window or label. **×** on a promotion that has already
  ended is a no-op, so a stale tab can't shrink its history.
- **Clearing only touches what it wrote.** `clearMember` patches a product
  only while its promo still carries this promotion's `runId`; a product the
  seller has since re-priced by hand is left alone, and the detail page says
  so ("Re-priced by hand since — ending won't touch it").
- **Bookings and events take the price, not the flash extras** (capacity and
  seats already cap them) — `memberPromoInput`, said on the review step. A
  product with nothing that can go on sale (quote-only, ≤ 5 sen) is left out
  of a new promotion and named.
- **Gates.** Setting (create / update / add) is Pro and takes the lapsed-store
  lock, like the single-product promo. **Ending and removing are never
  Pro-gated**, so a downgraded store can always switch a sale off. No credit
  gate — the catalogue is paid for by the subscription
  (`creditLockCoverage.test.ts` lists `promotions` with `products`).
- **× takes one product out, instantly, with an Undo.** A single product is
  cheap to put back, so there's no confirm (End keeps its confirm: it puts a
  whole sale back). The toast's Undo re-adds it at the prices this promotion
  gave it (`addProducts`, so it's Pro — a store that can't set promotions gets
  the toast without Undo). A taken-out member is stamped `removedAt`, so an
  **ended** promotion's history and its **Run again** are the products it
  *ended on*, not every product that ever passed through it. Without the
  stamp, × and End both left `cleared` rows, and the ended page listed more
  products than its own count.
- **A running sale's start is stated, not asked.** Re-opening a promotion (or
  a product's own sale) whose start has passed seeds `startMode: "started"`:
  the terms show "It's already running — it started Wed 14 Oct, 8:30 pm" in
  place of the Now / Schedule a start… chips, and saving keeps that start.
  "Schedule a start…" with a past date was an invitation to move a sale that
  was already selling.
- **The product form can't fight it.** A grouped product's Promotion card
  reads "Part of **Happy Hour** · Edit promotion", edits only its own sale
  prices (`PromoFields terms="none"`), and sends no `promo` at all;
  `products.update` refuses a promo change on a grouped product from a stale
  tab, naming the promotion.

### Where it lives

`/app/promotions`, its own nav entry **right after Products**. It is catalogue
pricing (the `products` permission area), so it sits with the catalogue.

It is deliberately **not** merged with Vouchers (Zaki, 14 Oct 2026). A first
cut made the two one "Promotions" page with tabs, because the voucher ticket
had anticipated a shared home. It was reverted before merge: a sale price
changes a product's price before anyone checks out, while a voucher is a code
one buyer redeems at checkout. Each has its own create, edit and end, and a
seller looking for one should never have to know it is a tab under the other.

The picker lives **inside the flow**, not as a select mode on the Products
list. That list is a drag-to-reorder grid, and "Add products" to a running
promotion needs the same picker anyway.

| Piece | Where |
|---|---|
| Rules (pure) | `convex/lib/promotions.ts` |
| Writes, queue, reads | `convex/promotions.ts` |
| Flow rules (pure) | `src/lib/promotion-flow.ts` |
| Picker / review / flow | `src/components/promotions/*` |
| Routes | `src/routes/app.promotions.*` |
| Nav entry | `sidebar.tsx`, `bottom-nav.tsx` (after Products) |
| Product form grouped state | `GroupedPromotionNote` in `product-form.tsx` |

