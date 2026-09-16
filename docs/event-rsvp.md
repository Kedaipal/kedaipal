# Event RSVP — a fixed date on a product (`z8r3fdff9u`)

Huff & Puff runs one BNI/network breakfast a month at her venue. Guests need to
RSVP and pick a food set (Set A / Set B / Set C) so she has a headcount per
dish. Today that happens in a WhatsApp thread and she counts by hand.

**The whole feature is one new primitive:** a fulfilment date FIXED on the
product, which checkout locks to instead of letting each buyer pick their own.
Everything else already existed.

| What an event needs | What already does it |
|---|---|
| A food choice per guest | Product option axes (`Set` → A / B / C) |
| A headcount per dish | `orders.items[].variantLabel` × `quantity` |
| A seat cap | Counted from orders on `by_retailer_fulfilment` |
| All RSVPs on one day in the inbox | The fulfilment-date window filter |
| A confirmation to the guest | The order confirmation push |
| A free event | `price: 0` variants + `isFreeOrder` |
| **One fixed date every guest gets** | **← the only thing that was missing** |

## Why an event is NOT a booking, and not a new `kind`

A booking listing has **no variants** — "one implicit variant", with the
availability index keyed on `productId` ([`booking.md` S1](./booking.md)). Hanging
a food choice off one would split capacity per variant and reopen that index,
which is exactly the trap the booking spec named. A booking also asks the guest
for a date RANGE; an event's whole point is that the date isn't theirs to pick.

A fourth product `kind` was rejected for the reason `productKind.ts` already
gives: a kind changes vocabulary and which questions get asked, never forks the
product system. An event is a `physical` (or `service`) product with one extra
field.

## Schema

```ts
// products
event?: {
  date: number          // MYT midnight epoch (isMytMidnight)
  timeMinutes?: number  // 0..1439; unset = an all-day event
  seats?: number        // total cap across ALL options; unset = uncapped
}
```

Public-safe — buyers read the date, the time and (derived) the seats left.
**`orders` gained nothing**: `fulfilmentDate`, `fulfilmentTimeMinutes` and
`items[].productId/variantLabel/quantity` already carry everything the tally
needs, and no new index was required.

`seats: 0` normalizes to **unset** at the sanitizer, so "no limit" has one
spelling. A stored 0 would read as "sold out" to `seatsLeft` and render an
uncapped event as fully booked from the first paint.

## The two modules

- **[`convex/lib/productEvent.ts`](../convex/lib/productEvent.ts)** — pure:
  `sanitizeEvent`, `isEventPassed`, `hiddenFromStorefront`, `formatEventBadge`,
  `seatsLeft`, `describeEvent`. Shared by the Convex mutations that validate and
  the seller form / storefront that render, the `productKind` precedent.
- **[`convex/lib/eventSeats.ts`](../convex/lib/eventSeats.ts)** — the ONE seat
  tally (`tallyEventSeats`, `seatsRequested`, `seatsExhaustedMessage`), the
  `bookingAvailability` precedent. The storefront chip, the seller's panel, the
  checkout refusal and the counter all read it, so no two surfaces can disagree
  about the arithmetic — including the clamp at zero.

**Seats count QUANTITY, not orders.** A guest RSVPing for themselves plus two
colleagues takes three seats, which is what "30 seats" means to the person
standing in the room.

## The date lock (`orders.create`)

For a cart holding any event line:

1. **One event per cart** — two different event dates need two fulfilment dates
   and an order carries one. Refused at add-to-cart; this is the stale-tab door.
2. **A finished event refuses** new RSVPs.
3. **Self-collect is asserted, not silently rewritten.** By the time the cart
   resolves, the address has been sanitized and a delivery quote resolved —
   flipping the method there would leave an order carrying delivery state it
   should never have had. The checkout hides the delivery option, so reaching
   this means a stale tab.
4. **A venue is required.** An event whose store has no active pickup point
   would confirm a guest with no idea where to go, so it refuses. The storefront
   gates the RSVP on the same condition.
5. **`fulfilmentDate` = `event.date`, `fulfilmentTimeMinutes` = `event.timeMinutes`,**
   forced — never read from the client.
6. **Minimum notice and opening hours are SKIPPED.** The seller fixed the moment
   when she published the event; holding her own date to her own "2 days'
   notice" rule, or refusing it because the shop is shut on a Sunday she's
   catering anyway, would refuse guests for a date she chose on purpose.
7. **The seat cap is counted inside the mutation**, which is what makes it
   atomic: Convex mutations are OCC transactions, so two guests racing for the
   last seat serialise and the second one's tally already includes the first.
   No reservation table, no lock row.

## The other doors

- **Counter checkout** takes walk-in RSVPs: the date and time are **forced**
  (rather than refused — the counter's date field is a convenience the seller
  may simply not have filled, and there's exactly one date the order can mean)
  and the seat cap is counted the same way. A seat sold at the counter is a seat
  the storefront can no longer sell.
- **Claim links refuse event products at the seller's door.** A claim freezes a
  price and lets the BUYER pick a date — the one thing an event forbids — and
  carries no seat hold, so an event sold through one could oversell the room
  between the send and the commit. Refused where the alternative (share the
  storefront link) is one tap away, with a commit-time backstop.
- **Rescheduling an RSVP is refused.** Moving one guest drops them out of the
  headcount (which keys on the event date) while telling them to turn up on a
  day nobody else is coming. `orders.get` exposes `eventLocked` so the seller's
  Reschedule is disabled *with the reason* rather than erroring on submit.

## Editing an event that has guests

Gated on the **live (non-cancelled) headcount**, deliberately NOT on
`products.orderedAt`. `orderedAt` is never cleared, not even when every order is
cancelled — using it would leave a seller who typo'd a date and cancelled the
two test RSVPs permanently unable to fix it.

| Edit | Rule |
|---|---|
| The date, with live RSVPs | Refused — "18 guests have already RSVP'd for …" |
| Turning the event OFF, with live RSVPs | Refused, same reason |
| Raising the seat cap | Always allowed |
| Lowering the seat cap | Only to ≥ what's taken |
| Re-saving on its own past date | Allowed (`allowPastDate`) — fixing a cap the morning after |

## The self-retiring listing

`hiddenFromStorefront` drops a finished event from **every** public read — the
grid, the product page, the category page, the by-id endpoint, the sitemap and
the popular rail — from MYT midnight on the day AFTER the event. No cron, no
seller action: the seller of a one-off event is the last person who should have
to remember to unpublish it. It stays up for the whole event day, so a guest
checking the venue at 7 AM for an 8 AM breakfast still finds it.

Seller surfaces deliberately do NOT apply it: a past event stays in the
dashboard with its headcount, because "how many came to the September one?" is a
question about history.

**Known imprecision:** a category's denormalized `productCount` is not
recomputed when an event retires, so a category can over-count by one until the
product is archived. Making it exact needs the daily cron this design exists to
avoid; the storefront grid itself is always right.

## Free events (`isFreeOrder`)

A total of 0 is **not enough on its own** to say an order is free, and that's
why `isFreeOrder` is a shared predicate rather than an inline `total === 0`:

- a made-to-order line sits at 0 until the seller quotes the mockup, and
- an out-of-zone delivery sits at its item subtotal until she arranges the fee.

Both are "price not settled yet" — the exact opposite of "free". Telling those
buyers their order costs nothing is how a seller ends up doing RM400 of catering
for free. `isFreeOrder` = zero **AND** no outstanding price to name.

It drives: the confirmation template's money parameter (`NO_PAYMENT_LABEL`,
"no payment needed" — a parameter VALUE, so **no Meta re-approval**), the
free-RSVP reply on the legacy inbound path, and the tracking page's payment
section. Paid events run the normal handshake unchanged.

> **Open, needs Arif:** a proper "RSVP confirmed for <event> at <venue>"
> WhatsApp template would need a new Meta submission — the approved
> confirmation template takes exactly three body params (`shortId`, `storeName`,
> money) plus the tracking URL button. Until then the event's moment, venue and
> chosen option live on `/track/<token>`, which that button already opens —
> consistent with [`one-message-per-order.md`](./one-message-per-order.md).

## Surfaces

| Where | What it shows |
|---|---|
| Storefront card | Date as an **accent chip** (the headline fact, not a micro-rule), "N seats left", "Fully booked" outranking "Out of stock" |
| Product page | `EventNotice` — the moment, the seats, and that there's no delivery and no date to pick. CTA reads **RSVP** |
| Cart | Refuses a second event date with the reason; the stepper is capped by seats as well as stock |
| Checkout | A lock banner at the TOP (adding an RSVP changes the terms of the whole order) with a one-tap "remove the RSVP" escape; section 3 reads the moment back instead of asking |
| Seller product page | The **RSVPs panel**, above the form: total, per-option tally, seats left, and a link into the inbox filtered to that day |
| Seller product form | Its own **Event** card above "Order rules" (see below) |
| `/track/<token>` | "Event: Fri 25 Sep · 8:00 AM — set by the store for this event" |
| Product CSV export | `event_date`, `event_time`, `event_seats` (export-only) |

### Why the Event card sits above "Order rules"

Minimum quantity and minimum notice are **limits on how a buyer may order**. An
event changes **what the product is** — it gains a date, a venue, a seat count,
and a listing that retires itself. It also *overrides* the minimum notice below
it, which is why it comes first, and why minimum notice **disables with the
reason** while the event is on rather than staying enabled and being silently
ignored.

In the wizard it lives in the review step's "More options" drawer, not as a
step: the wizard's steps are the questions every product must answer, and "is
this an event?" is no for almost all of them.

## Tier

Pro (`events` in `PLAN_FEATURES`). Gates only **setting** the event config —
an event that already exists keeps taking RSVPs, the headcount keeps totalling,
and the buyer flow never varies by seller plan, so a downgrade never strands
guests mid-RSVP. Clearing an event is un-gated (never trap a downgraded seller),
the `categories` / `radiusDelivery` posture.

## Not built (deliberate)

- **CSV import of event columns.** The three columns export but the import
  ignores them — nobody bulk-loads events, and the import screen already names
  export-only columns rather than no-op'ing silently.
- **An inbox event badge.** The badge diet allows ONE contextual badge, the
  fulfilment-date badge already carries the event's date, and the card shows the
  product name. A second chip — and the denormalized `orders` field it would
  need — buys nothing.
- **Recurring events.** Each month's breakfast is its own product. Revisit if a
  seller asks twice.

## Tests

- [`convex/eventRsvp.test.ts`](../convex/eventRsvp.test.ts) — the date lock, the
  seat-cap race, quantity-not-orders, cancel-frees-a-seat, the headcount, the
  edit rules (including that a cancelled RSVP doesn't strand the date), the
  self-retiring listing, and the claim-link refusal.
- [`convex/lib/productEvent.test.ts`](../convex/lib/productEvent.test.ts) — the
  sanitizer, `isEventPassed` at the day boundary, `seatsLeft`'s clamp, and the
  badge's MYT formatting.
- [`convex/lib/order.test.ts`](../convex/lib/order.test.ts) — `isFreeOrder`,
  including that an unquoted made-to-order order is never "free".
