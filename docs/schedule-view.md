# Schedule view — registered vs paid, per date

ClickUp [`z8r3fdjv0d`](https://app.clickup.com/t/z8r3fdjv0d). Orders → **Schedule**
(`/app/orders/schedule`), the fourth segment of the Orders view switch
(Cards · Table · Calendar · **Schedule**).

Every dated programme a store runs (events and bookings) on one screen,
one row per **(date, listing)**, with seats, registered and paid. It answers
Dr Niki's question, verbatim from 30 Sep: *"how many people registered and how
many paid for a specific date"*. A seller gets it per listing already (the RSVP
panel on the product page) and per order (the inbox), never across dates in one
place. Every event seller has the same gap.

It is a read-only **lens** over the orders the inbox lists, like the booking
calendar. It has no writes of its own.

## Where it lives and who sees it

| | |
| --- | --- |
| Route | `src/routes/app.orders.schedule.tsx` (`?past=true` shows the last 30 days) |
| Rows | `src/components/order/schedule-rows.tsx` — cards on mobile, one grouped table from `lg` |
| Query | `convex/schedule.ts` → `schedule.byDate`, `schedule.hasDatedListings` |
| Rules | `convex/lib/scheduleRows.ts` — pure, unit-tested; also holds the 90/30-day horizons both sides read |
| Toggle | `src/components/order/orders-view-toggle.tsx` — `showSchedule` |

- **Shown to** stores with at least one active event or booking listing
  (`schedule.hasDatedListings`), the way Calendar is shown only to booking
  stores. A store selling only cakes has no programme to schedule.
- **Plan: Pro**, gated with the inbox (`orderInbox`). Every row opens the
  inbox's listing view, which is itself a Pro inbox filter, so a Starter
  schedule would be a page of links into a paywall. On Starter the inbox's
  header actions (the view switch included) are already hidden; a deep link
  lands on a `ProFeatureWall`. The server refuses too (`assertPlanFeature`).
  Admin act-as sees through it, as on the inbox.
- **Permission:** `orders: read`. The **Headcount** link appears only for a
  teammate who can read `products`, since anyone else would just be refused.

## What a row counts

The counting rules are the ones the seller already sees elsewhere, so this
screen can't contradict the panel a row taps into:

- **An event counts SEATS** (`items[].quantity`), never orders. This is
  `tallyEventSeats`'s rule, so "46 registered" here is the "46 taken" on the
  listing's RSVP panel; a convex test pins the two numbers equal.
- **A booking counts bookings**: one order is one booking. A stay's line quantity
  is its *nights*, and a package's is always 1, so quantity would count nights
  for one listing and people for another.
- **Only `cancelled` leaves** (`holdsSeats` / `holdsCapacity`). A pending order
  and a request awaiting approval both hold their place, so both count.
- Rows key on the order's `fulfilmentDate`: the RSVP's event day, or the
  booking's check-in. A **multi-day event** is one row on its start date
  carrying its span, the same key `tallyEventSeats` uses.

### Every registered unit is in exactly one bucket

```
registered = paid + claimed + unpaid + awaitingApproval + free + waitingOnCredits
```

So the chips always add up, and "how many do I still chase" is never a
subtraction the seller does in their head.

| Bucket | Meaning | Shown as |
| --- | --- | --- |
| `paid` | `paymentStatus: received` (the house word is **Paid**) | mint chip; shown even at **0** once anything is payable, because "0 paid" five days out is the alarm |
| `claimed` | the buyer says they paid; the seller hasn't checked | blue chip + a one-line legend at the top of the page (only when some row has one) |
| `unpaid` | owed and not claimed: **the ones to chase** | amber chip |
| `awaitingApproval` | `booking_requested` (a booking request, or an RSVP to an event with *Approve each RSVP*): no payment asked yet | muted note under the chips |
| `free` | `isFreeOrder`: zero **and** nothing left to price | grey "Free" chip (or "N free" beside payable ones) |
| `waitingOnCredits` | the order is waiting on credits (T3.1) | muted note, "top up to open" |

**`claimed` is a bucket of its own on purpose.** Counting it as Paid tells the
seller money landed that may not have; counting it as Unpaid sends them
chasing a buyer who already paid. The inbox draws the same three-way line.

**"Free" is `isFreeOrder`, never `total === 0`.** A RM0 made-to-order line still
awaiting its quote is *owing*. The caller resolves `free` and the pure module
never re-derives it, so "free" can't drift into a second, looser meaning. This
was caught mid-build: the first draft used `total <= 0`.

**Credits (T3.1).** A waiting order holds its place on the row and is
**counted, never described**: its payment state isn't read into a bucket, and
it isn't one of the orders the row offers to open (the inbox hides it). The
`schedule` module is in `creditLockCoverage.test.ts`'s read sweep.

### Chips

Navy **capacity** ("50 seats", "Full · 50 seats", or "No seat cap", never
"0 left"), grey **registered**, then the payment split. The seats chip states the
cap, not a second copy of the count: an earlier "46/50 seats" beside
"46 registered" printed 46 twice.

## Where a row goes

- **Open N orders**: the inbox narrowed to exactly this row's orders, i.e.
  `?listing=<productId>&ffrom=<date>&fto=<date>`. `N` is `row.orders`: the
  orders the inbox *will* list (not seats, and not waiting-on-credits orders),
  so the button is a promise the next screen keeps. A row with nobody behind it
  says "No one registered yet" / "No bookings yet" / "Nothing to open yet"
  instead of offering a dead "Open 0 orders".
- **Headcount** (events only): the listing's own RSVP panel at
  `/app/products/$productId`, with the per-option split.

### The inbox's `listing` filter

Added for this screen, and the reason a row can hand over exactly what it
counted. A name search would also catch "Luncheon VIP", and a category holds
every listing filed under it.

- `InboxFilterArgs.listing` (`convex/lib/orderInboxFilter.ts`): an order
  matches when any line is that product, or when it is a booking of it
  (`bookingProductId`). It is in `NARROWING_FILTER_KEYS`, so it is a Pro inbox
  filter, and it is in the shared export validators, so a CSV of the view holds
  the same rows.
- **`v.string()`, not `v.id`**: it arrives off a URL, so a hand-edited id must
  read as "matches nothing", never as an argument error that takes the inbox
  down. The route also drops anything that isn't id-shaped.
- No picker writes it. Like Home's due span, the panel **shows it and lets it
  go**: the token reads `Listing: Luncheon` (`searchOrders.listingName`,
  resolved server-side and only for this store's own products), or *Listing not
  found* for a dead id. It is in `INBOX_FILTER_PARAMS`, so it counts as a filter
  and **Clear all** clears it.
- A gated order has its lines stripped before the predicate runs, so it never
  matches by line. That is why `row.orders` excludes them.

## Window

- **Today → +90 days** by default; **Show past 30 days** adds a *Past 30 days*
  section, most recent first. The horizon is printed at the top of the page,
  because a constraint is surfaced, never silent.
- `fromMyt`/`toMyt` come from the client as MYT midnights (as in
  `countDueByDay`: a query that reads the clock can't be cached). The server
  refuses non-midnight edges and any span over 121 days, which keeps the scan
  bounded.
- A **multi-day event that started before the window** but is still running
  belongs on it. Its RSVPs all sit on its first day, so the order read reaches
  back to the earliest such start. Its group heading reads **"On now · started
  Mon, 9 Nov"**, because the seminar's second morning is exactly when the seller
  opens this screen. A row is past only once its *last* day is behind today.
- **Bounded like the calendar feed**: at most 2,000 orders per window. Past
  that the query logs and returns `truncated: true`, and the page says the
  numbers may be short. It is never silently short.
- An event nobody has registered for still gets its row (seeded from the active
  event listings), because "0 of 30" five days before a luncheon is the most
  useful thing this screen can say. An **archived** listing with orders in the
  window keeps its row; its day still happens.

## States

Pro wall · loading (skeletons, never a flash of an empty state) · nothing dated
(the three create doors: *Add an event*, *Add a plan or package*, *Add a stay
or rental*) · dated listings but nothing in 90 days (with *Show past 30 days*)
· rows · past section · truncated warning. All pinned in
`src/routes/app.orders.schedule.test.tsx`.

## Tests

- `convex/lib/scheduleRows.test.ts`: grouping across two listings on one date,
  no cap, cancelled excluded, multi-day on its start date, booking rows, the
  exact-one-bucket partition, seat vs order counting, gated orders.
- `convex/schedule.test.ts`: the RSVP panel's number equals the row's; window
  bounds and refusals; Starter and stranger refused; the `isFreeOrder` rule; the
  inbox `listing` filter (exact match, a hand-edited id, another store's id,
  Pro-gated).
- `src/components/order/schedule-rows.test.tsx` and
  `src/routes/app.orders.schedule.test.tsx`: chips, notes, links and page states.
- `convex/lib/orderInboxFilter.test.ts` and
  `src/components/dashboard/order-filters.test.tsx`: the listing filter's
  predicate and token.

## Not built (deliberately)

- **Recurring programme sessions** (a weekly rule generating dates). This was the
  ticket's original scope before it was rewritten on 1 Oct, and it is parked
  under the *Mentoring sessions* ticket.
- **Chips as links** ("2 unpaid" opening only the unpaid orders). An event's
  chips count seats and the inbox lists orders, so "2 unpaid" could open one
  order (a party of two). The single *Open N orders* door names its real count
  instead; the seller narrows by payment in the inbox.
