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
  endDate?: number      // LAST day of a multi-day event; unset = one day
}
```

Public-safe — buyers read the date, the time and (derived) the seats left.
**`orders` gained nothing**: `fulfilmentDate`, `fulfilmentTimeMinutes` and
`items[].productId/variantLabel/quantity` already carry everything the tally
needs, and no new index was required.

`seats: 0` normalizes to **unset** at the sanitizer, so "no limit" has one
spelling. A stored 0 would read as "sold out" to `seatsLeft` and render an
uncapped event as fully booked from the first paint.

## Multi-day events (`endDate`)

Added 22 Sep 2026 for the second seller, Helinox Community Malaysia's
*Into The Falls* camp (4–6 Dec, 90–110 participants). Packages and tent type
are two option axes, the RSVPs panel's per-option tally is the tent lot plan,
and the seat cap is the participant limit, so the only missing piece was a
last day.

`endDate` is **display and listing lifetime only**:

- Every RSVP still freezes `fulfilmentDate = event.date` (the check-in day), so
  the seat tally's key never moves and nothing else in the order flow changes.
- `isEventPassed` (and so `hiddenFromStorefront` and the passed-event refusal
  in `orders.create` and the counter) runs off `eventLastDay()`. The listing
  stays up, and keeps taking late registrations, until the day after the
  LAST day, so a camp doesn't vanish on its second morning.
- It's validated in `sanitizeEvent` with **the ticket's rules only**: a
  calendar day, not before `date`. There is deliberately **no length cap**
  (revised 23 Sep — the first build's 31-day block was not ticket scope): a
  real 6-week class series must save, and a cap's only workaround — leaving
  the last day blank — reintroduces the vanishing-listing bug the field fixes.
  The typo guard is the form: past `LONG_EVENT_WARN_DAYS` (14) an **amber
  warning** asks "That's a 43-day event — double-check the last day" with Save
  enabled, and the read-back range names both years across a boundary. (The
  500-seat ceiling stays: `1..500` is in the ticket's acceptance criteria.)
  The same day as `date` normalizes to **unset**, so "one day" has one
  spelling.
- It **stays editable while guests are booked**, unlike the date. It moves no
  seat, and extending a camp by a day should reach every guest. That's why the
  tracking page and the WhatsApp RSVP label read it live from the product
  rather than freezing it onto the order.

Spelling: the glanceable badge is the compact range `Fri 4 – Sun 6 Dec` —
the month said once, the start time dropped (a multi-day chip must fit one
line on a 375px card; the time is the moment's job). Years appear only when a
day is outside the current year, so a New Year's range names both.
The full spelling, from `formatEventMoment()`, is used wherever a guest commits
or checks in: the checkout banner and read-back, the counter, the track page,
the seller's RSVPs panel and the WhatsApp label. One helper, so no surface can
forget the last day. The seller sets it as **Last day (optional)** beside
**Event date**.

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

1. **One event per cart, keyed on the PRODUCT** (PR-review fix) — not the
   date: two same-day events at different outlets share a date but not a
   venue, and the lock resolves from whichever product landed first, so a
   date-keyed check would confirm one event's guests at the other's address.
   Several lines of ONE event (Set A + Set B) stay a single entry. Refused at
   add-to-cart (`useCart.addItem` compares `productId`) and at both server
   doors; the server checks are the stale-tab backstop.
2. **A finished event refuses** new RSVPs.
3. **Self-collect is asserted, not silently rewritten.** By the time the cart
   resolves, the address has been sanitized and a delivery quote resolved —
   flipping the method there would leave an order carrying delivery state it
   should never have had. The checkout hides the delivery option, so reaching
   this means a stale tab.
4. **The venue is the EVENT's, forced like its date** (round 4:
   `event.venueId`). A guest choosing the venue is as wrong as a guest
   choosing the day — on a multi-outlet store the generic pickup picker would
   offer outlets the event isn't at. Checkout shows the venue as a read-back
   titled **Venue** ("set by the store, the same for every guest"), and
   `orders.create` overrides whatever pickup id the client sent via
   `resolveEventVenue`. The counter runs the same resolver, so the two doors
   can never seat one event at different venues. **A HIDDEN pickup point is a
   first-class venue** (round 5): `isActive: false` removes a point from the
   buyer's standard-order choice, never from an event it hosts — an
   *RSVP-only location* IS a hidden point, so no separate "event locations"
   table/section exists. The resolver honours the named venue whatever its
   active state (rerouting guests to the "first active" outlet would be a
   wrong address, strictly worse than a hidden one); the fallback for
   legacy/unset venues is first active point, else first point at all. The
   checkout reads the venue through its own public query
   (`pickupLocations.eventVenuePublicBySlug` — same resolver, buyer-safe
   shape, gated so only a venue some live event actually names is served),
   because the active-only public list rightly omits a hidden venue. The
   Settings → Fulfilment row of a hosting point carries an "Event venue:
   <names>" line (plus "guests are still sent here" when hidden), and the
   hide-toast names the consequence — hiding must never read as "gone
   everywhere". **Save-time rules**: a single-point store never picks (unset
   = the only point, stated read-only in the form so the default isn't
   silent); with more than one point — hidden ones count — the seller must
   name the venue, refused at save, required on the form/wizard with the
   reason, hidden options suffixed "— hidden from buyers". A store with NO
   point at all still refuses the RSVP outright: a confirmation that never
   says where to go is a dead end.
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
  the storefront can no longer sell. The **venue is frozen onto a counter RSVP
  too** (first active pickup point; refused in seller words when none exists) —
  a plain counter sale is handed over at the counter and keeps no pickup card,
  but an RSVP's guest leaves and comes back, and their order page's event note
  points at the pickup card. The counter's Collection panel **reads the
  event moment back** ("Set by the event…") instead of offering the date
  editor, the confirm dialog names it, and the **Send-link mode refuses an
  event cart with the event's own reason** (share the storefront link instead)
  — checked *before* "unpriced", or a free RSVP line would be misnamed a
  custom item.
- **`isDefaultedCounterDate`** (`convex/lib/order.ts`) revises the old
  "counter orders never show a fulfilment-date badge" rule. That rule was
  right for the walk-in it described and wrong for the two counter orders
  whose date IS a promise: a preorder the seller picked a later day for, and a
  walk-in RSVP whose date the event forced. The test is now the **rationale,
  not the source**: a counter date equal to the MYT day the order was created
  is the default (noise — hidden); any other counter date is information —
  shown. One predicate feeds both the inbox badge and the order detail's
  "Collect on" row, so the two seller surfaces can't disagree.
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
| Moving the VENUE, with live RSVPs | Refused (PR-review fix) — every RSVP froze the old address onto its order page, so a move splits one event across two addresses with no send path to tell anyone. Compared on the **effective** venue, so re-saving the same venue (raising the cap) and NAMING a legacy blank venue where it already resolves both stay allowed; the form disables the select with the reason, keeping a blank venue pickable |
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

## The RSVP status pipeline (`orderFlowKind` + `FLOW_PRESETS`)

An RSVP's lifecycle is **Confirmed → Checked In** — nothing is packed, nothing
is ready for pickup; a guest registers and then walks in. Rather than
special-casing that, `orderStatus.ts` grew a **flow-kind registry**:
`OrderFlowKind = delivery | self_collect | booking | event`, and one
`FLOW_PRESETS` entry per kind declaring its label overrides, the anchors its
pipeline skips, and whether seller-configured custom stages apply. Booking's
existing behaviour (skip "Packed", never take custom stages) moved into the
same table, so **a future kind is one registry entry**, not a fork in five
resolvers.

- **`orders.eventRsvp`** is the frozen at-birth marker (stamped by both create
  doors), because every surface — the inbox chip, the stepper, bulk actions —
  needs the kind *synchronously*. The event's own details (endDate) are still
  read live from the product; the marker is never patched. `orderFlowKind`
  derives the kind, with the marker outranking the stored `self_collect`.
- **Both steppers** (seller pipeline header + buyer timeline) resolve stages
  with the event kind: Order Received → Confirmed → Checked In, and the
  advance CTA reads **Mark as Checked In**. `default:packed` is an *unknown
  stage* for an RSVP — vocabulary, not a relabel.
- **Bulk actions skip** an order whose flow kind lacks the target anchor
  (booking + "Packed", event + "Packed"/"Ready for Pickup"), counted and named
  in the toast (`skippedNoSuchStage`) — never a silent no-op. Cancel still
  reaches every kind.
- **The counter's "Completed" override doesn't apply**: a walk-in RSVP isn't
  complete at the counter — the guest attends later — so its terminal state
  stays "Checked In". The counter's done screen also drops the one-tap "Mark
  as completed" for RSVPs.
- **The inbox chip** resolves per-row flow kind (this fixed bookings' chips in
  passing — a checked-out stay used to read "Collected" at the retailer
  grain).
- **Custom stages** (Settings → Order status) never apply to events, said in
  the settings note for sellers who run events (`products.hasEventListings`).
  Tagging custom stages per product kind is ticketed separately.

## Free events (`isFreeOrder`)

A total of 0 is **not enough on its own** to say an order is free, and that's
why `isFreeOrder` is a shared predicate rather than an inline `total === 0`:

- a made-to-order line sits at 0 until the seller quotes the mockup, and
- an out-of-zone delivery sits at its item subtotal until she arranges the fee.

Both are "price not settled yet" — the exact opposite of "free". Telling those
buyers their order costs nothing is how a seller ends up doing RM400 of catering
for free. `isFreeOrder` = zero **AND** no outstanding price to name.

A **free counter order records no payment**, whatever the client sent —
"Paid now · Cash" on an RM0 RSVP wrote a payment-received event that the order
page then contradicted with "Free order". The counter hides the payment card
for a free cart, the confirm dialog says "Free order — nothing to collect",
and `createOrderFromSession` enforces the same rule server-side (counter
totals carry no unsettled price, so zero there is a real zero).

It drives: the confirmation template's money parameter (`NO_PAYMENT_LABEL`,
"no payment needed" — a parameter VALUE, so **no Meta re-approval**), the
free-RSVP reply on the legacy inbound path, the tracking page's payment
surfaces (both the status card and the how-to-pay section drop entirely, and
the "confirmation sent" card says "nothing to pay" instead of pointing at a
how-to-pay section that isn't there — both languages), and the seller order
page (the unpaid card becomes "Free order — there's nothing to collect").
Paid events run the normal handshake unchanged.

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
| Seller product page | The **RSVPs panel**, above the form: total, per-option tally, seats left, and a link into the inbox searching the product's frozen item name (the inbox's `from`/`to` bind to createdAt, and no arbitrary fulfilment-day filter exists) |
| Seller product form | Its own **Event** card above "Order rules" (see below) |
| `/track/<token>` | "Event: Fri 25 Sep · 8:00 AM — set by the store for this event" |
| Product CSV export | `event_date`, `event_end_date`, `event_time`, `event_seats` (export-only; the import names them as ignored) |

### Why the Event card sits above "Order rules"

Minimum quantity and minimum notice are **limits on how a buyer may order**. An
event changes **what the product is** — it gains a date, a venue, a seat count,
and a listing that retires itself. It also *overrides* the minimum notice below
it, which is why it comes first.

In the wizard the event has a **front door** (round 4, Zaki's live-test
finding — the drawer-only entry was invisible to the exact persona the
feature serves): step 0 gains an **Event card** next to Booking. Like Food,
the card is a *router*, not a stored kind — it lands as `physical` + the
event flag armed, and walks its own route: **When is it?** (date, last day,
time, seats — right after the name, because the date is the product's
identity) → guest-choice vocabulary on the type step (food set / package /
tent type; made-to-order hidden) → price (with the "RM 0 / S$ 0 = free RSVP" hint, in the store's own symbol)
→ **Cap each choice separately?** (the preparation step re-worded: per-choice
caps are how Helinox limits tent slots per type) → review. Selecting the card
arms `event.on`; switching away disarms it, keeping typed values. On the
event route the review drawer hides the event fields (the step owns them —
one editor, three doors: step, drawer, full form). The Pro gate refuses at
the card **with the reason**, never opening a flow that can't publish.
`/app/products/new?card=event` (`z8r3fdhkr7`) opens step 0 with the Event
card already selected — the "Create an event" link in the v2026.09.7
What's-new note — through the same transition as the tap, and the same
refusal (shown on arrival) on a locked plan. See
[`product-setup-wizard.md`](./product-setup-wizard.md). Why
NOT a fourth kind, even ignoring cost: kind answers *what is sold*, the event
flag answers *how its date works* — orthogonal axes (a breakfast is food AND
an event); the flag is reversible where kind is immutable; and booking earned
its kind by forking the data model (no variants, own index) while an event
forks nothing. The toggle in the drawer / full form remains for turning an
EXISTING product into an event.

### Min notice + prep time HIDE while the event toggle is on

Both timing rules are **hidden, not disabled**, in the form and the wizard — a
greyed-out input still reads as a rule the seller is failing to set. One line
replaces them ("Minimum notice and prep time don't apply to an event — guests
RSVP to the fixed date and time you set above"), and the submit values are
**dropped** (`0`/unset) so a value typed before toggling never rides along
invisibly. Their validation is skipped too, or a stale invalid value would
block Save with an error the seller can no longer see. The CSV import's
`importOrderRules` matches: a prep-time edit targeting an event product is
**skipped and named** in the preview ("prep time doesn't apply"), the booking
posture. The pickup note stays — it's an instruction, not a timing rule.

### Where the seller SEES that a product is an event

- **The product list card's third line** IS the event line — `Event ·
  Fri 4 – Sun 6 Dec` in accent (`Ended · …` muted once passed) in place of the
  stock word. It lives in the card's flexible left column so a long range
  truncates; the first cut put it in the `shrink-0` chip column, which kept
  its own width and crushed the product name to 0px (found by rendering).
- **The form's summary strip** and `describeProduct` prefix the same
  `Event · …` first — it changes what the product is, so it outranks
  stock/price in the sentence.

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
