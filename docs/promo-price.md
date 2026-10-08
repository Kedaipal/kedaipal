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
| `counterCheckout.createOrderFromSession` | Defaults to the effective price; a seller price adjustment overrides it and is **not** a promo sale |
| `orderClaims.sendClaim` | Locks the sale price at send; the unit counts against the pool at **commit** (the price-lock rule wins) |
| `bookings.requestBooking` | Nightly/package rate only — no flash mechanics (capacity already caps a stay); the weekend surcharge keeps its own rate |

`convex/lib/promoTally.ts` counts units **inside the mutation** — Convex
mutations are OCC transactions, so the tally *is* the lock. Cancelled and
auto-expired orders drop out of it, which is how their units return to the
pool with no bookkeeping at all.

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

**Pro gate:** setting is gated (disabled-with-reason in place, the
`EventFields` posture); **clearing never is**, so a store that drops to
Starter can always switch a promotion off. A promotion on a downgraded store
is *paused*, not deleted — `effectivePrice` returns the list price and the
storefront publishes no `promoState` at all.

**The wizard deliberately offers no promotion.** Creating a product and
merchandising it are different jobs; it sends `promo: null` and the full form
is one tap away.

## What the buyer sees

`productWithVariants` publishes a buyer-safe `promoState` (`phase`, `label`,
`startsAt`, `endsAt`, `unitCap`, `unitsLeft`, `maxPerOrder`) plus
`promoPriceFrom`, and **strips every `promoPrice`** when the promotion can't
apply — so the storefront can never show a sale the order doors would refuse.
The raw config stays owner-only.

`src/lib/promo.ts` is the storefront half. It re-derives nothing; it owns the
**clock**, so a page left open stops quoting a sale the moment the window
shuts. `usePromoClock` ticks only while there is a deadline to watch.

- **Cards** carry the whole sale story *on the image* — badge, countdown,
  units left — so a card on sale is exactly as tall as its neighbour and the
  grid never staggers. The badge ranks **last** in the top-left chain: every
  state above it (fully booked, out of stock, low stock) is a reason the buyer
  may not be able to order, which outranks a reason to want to. Navy + bolt
  when timed, mint for a plain discount. A teaser names the price *and* the
  wait ("RM 31.50 in 1h 11m"); add-to-cart stays at the list price until the
  drop.
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
