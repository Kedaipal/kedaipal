# Booking vertical — date-range bookings, request-to-book (Sengloh anchor)

The booking bundle turns Kedaipal's product system into something a campsite /
venue / homestay can sell through: buyers pick a **date range** on a calendar,
**request to book**, the seller approves, and one payment (total + refundable
security deposit) settles it. Spec: ClickUp `86eyj70z1` (decisions locked with
Arif 7 + 12 Aug 2026). Design reference: `86eym0pjg` (Variant A buyer calendar
locked 16 Aug). Anchor customer: Sengloh (campsite, Founding Member #7).

**Build = six slices, each landing functional** (`86eyn4kap` → `86eyn4kf2`).
S1→S2→S3 are a stacked chain merged to staging **together** — S1 alone ships a
creatable-but-unbookable product, S2 alone ships requests with no Approve
button. S4 (seller calendar + blocks), S5 (security deposit), S6 (ICS feed)
follow the core independently.

| Slice | Contents | Status |
| --- | --- | --- |
| S1 `86eyn4kap` | Schema + kind-first wizard + booking listing setup | ✅ built (this doc) |
| S2 `86eyn4kbw` | Availability module + buyer calendar (Variant A) + request-to-book | ✅ built (this doc) |
| S3 `86eyn4kcn` | Approve/decline + WA copy set + buyer tracking states | ✅ built (this doc) |
| S4 `86eyn4kdb` | Seller month calendar + `bookingBlocks` | — |
| S5 `86eyn4kee` | Security deposit end-to-end | — |
| S6 `86eyn4kf2` | ICS calendar feed + Settings connect card | — |

---

## S1 — product kind + booking listing setup (`86eyn4kap`)

### The kind primitive

`products.kind: "physical" | "service" | "booking"` (optional; **unset =
physical** — the legacy default, zero migration; `create` normalizes an
explicit `"physical"` to unset so the default has one spelling, the
minQuantity posture). Kind is a **vocabulary + question router, never a
behaviour fork** (locked): it changes which wizard steps appear and what words
render (product → listing/service), while everything sells through the same
products/variants primitives.

- **"Food" is a wizard card, not a stored kind.** It stores as `physical` and
  its follow-up is the existing preparation question re-framed ("Made fresh
  when ordered" vs "Ready stock"). No feature can ever branch on "food".
- **Kind is immutable after create** (v1 decision, recorded here): a kind flip
  on an ordered product would leave orders whose semantics don't match the row
  (a physical order has no `bookingRange`; a booking order has no stock
  movement). Escape hatch = archive + recreate. `products.update` deliberately
  has **no kind arg**; revisit if a real seller hits it.
- Shared pure module: `convex/lib/productKind.ts` (`ProductKind`,
  `effectiveKind`, `kindNoun`, `MAX_CAPACITY_PER_NIGHT` = 100 — a fat-finger
  guard, not a product limit; `sanitizeCapacityPerNight`). Imported by both
  the mutations and the wizard/form UI (productCap precedent).

### Booking config

`products.booking: { capacityPerNight }` (optional object) — a site/plot IS a
product; capacity counts interchangeable units bookable for the same night
("Standard Plot ×5" = one product, capacity 5). **Kind ⟷ config pairing is
enforced both directions in `create`**: booking without capacity is refused
(no availability semantics), capacity on a non-booking product is refused
(dead config). `update` accepts `booking` only on a booking-kind row —
capacity is the one booking knob a seller re-tunes, and **lowering it never
cancels existing bookings** (S2's availability module simply stops new
requests). `securityDeposit` joins this object in **S5** — the wizard field
ships there WITH its machinery, because an input that silently does nothing is
worse than hidden behaviour.

`retailers.storeType` (same enum, optional) — "What does your store sell?" in
Settings → Store, directly under the store description. Its ONLY job is
pre-selecting the wizard's kind card for **new** products; it never re-types
existing ones (the card copy says so). Settings shows **three** cards (Food &
physical goods merged — two lit cards for one stored value would read broken);
the wizard shows four because mid-wizard the Food card routes the preparation
question. Tap again to clear (`storeType: null` in `updateSettings`).

### The wizard's kind-first route

Step **0** — "What are you selling?" (BM "Anda jual apa?" comes with the
storefront i18n sweep; `/app` is EN like every dashboard route) — four
`AnswerCard`s with one-line examples, pre-answered + badged "Your store type"
when `storeType` is set, food/booking explainer notes under the cards. Step
IDs stay stable; only the walked order changes (`wizardSteps(shape, kind)`):

- physical/service: `[0, 1, 2, 3, 4, 5]`
- made-to-order: `[0, 1, 2, 3, 5]` (unchanged posture)
- **booking: `[0, 1, 3, 5]`** — no Choices (one implicit variant; a plot has
  no size matrix in v1), no Preparation (request-to-book IS the preparation;
  capacity, not stock, governs availability — the row is
  `blockWhenOutOfStock: false`, `requiresProof: false`).

Booking's step 3 renders as **"Price and capacity"**: price per night (the
implicit row's price — `wizardPriceLabel` prints "RM 80/night"), "Spots
available each night" stepper, and min notice (**promoted here from More
options** — `products.minNoticeDays` reused verbatim, "guests can't request a
check-in sooner than this"). Review shows Type/Price/Capacity/Notice rows in
booking words; More options collapses to just "Open in the full editor"
(no mockup approval, no custom line, no min quantity — one request = one
booking, so `buildWizardSubmitValues` never sends `minQuantity` for booking).

`switchKind` crossing the booking boundary rebuilds the selling substrate
(guarded by the same typed-data confirm as the shape switchers); Food ⟷
Physical is a pure relabel. The card round-trips through the full form as the
STORED kind — a food seller's draft re-lights "Physical goods", by design.

### Edit form (`ProductForm`)

Kind arrives via `initialValues.kind` and is displayed, never edited. Booking
products swap the "Pricing & choices" card (VariantEditor) for a compact
**"Pricing & capacity"** card (per-night price on the implicit row + capacity
input, validated to the same 1..100 the server enforces); Order rules keeps
only min-notice (re-worded); the summary strip reads **"Booking · 5
spots/night · RM 80/night"** (`describeProduct` gained a booking branch). The
wizard ⇄ form handoff carries `kind` + `capacityPerNight` losslessly both
ways (`ProductFormDraft` gained both).

## S2 — availability + buyer calendar + request-to-book (`86eyn4kbw`)

### The order shape

A booking is an ORDER in the same table, created through its own public
mutation **`bookings.requestBooking`** rather than a branch inside the
storefront `orders.create` (the two share almost no validation — no cart,
delivery, stock or fee resolution — but every shared seam is imported from the
same libs: `computeOrderTotals`, id generation, usage metering, CRM linking,
`stampProductsOrdered`). The request lands as:

- **`orders.status = "booking_requested"`** — the locked carve-out from
  confirm-at-create. Exits: approve → `confirmed` (S3), decline / expiry /
  cancel → `cancelled`. **Every write path guards it**: `updateStatus` +
  `advanceToStage` throw ("approve or decline it from the order page"),
  `bulkUpdateStatus` SKIPS (mockup-gate posture) — approve/decline stay the
  only doors so the guest always gets the one confirmation + payment ask.
- **`bookingCheckIn` / `bookingCheckOut` / `bookingProductId`** — the spec's
  `bookingRange` FLATTENED to top-level fields so the capacity scan can ride
  the new `by_booking_product` index (arrays/objects can't be index keys; a
  flagged divergence). checkOut is **exclusive**: a 25→27 stay sleeps nights
  25+26, and the 27th is free for someone else's check-in (back-to-back
  bookings pinned by test).
- **`deliveryMethod = "booking"`** (new literal — nothing is shipped or
  collected; the guest shows up). `DeliveryMethod` widened in both orderStatus
  twins with a **booking label preset** (shipped → "Checked In", delivered →
  "Checked Out", EN/MS/ZH) and the inbox icon is a calendar.
- **`fulfilmentDate = checkIn`** — so inbox sort, due-today and urgency badges
  read the stay with zero new code.
- **`items[0].quantity = nights`** at the per-night price — every money
  surface (totals, CSV, insights, receipts) reads "listing × nights" with no
  special-casing. No stock is moved (capacity, not stock, governs).
- Phone **required server-side** (unlike the storefront's protocol-optional
  phone): the whole request lifecycle reaches the guest on WhatsApp.

### One availability authority

`convex/lib/bookingAvailability.ts` — imported by `requestBooking` (the
atomic in-transaction check; Convex serializes, so two buyers racing for the
last spot can't both pass) and the public **`bookings.availability`** query,
so checkout and the calendar can never disagree. Capacity holders = every
booking order that is **not `cancelled`** (a `booking_requested` soft-holds
from the moment it exists — spec decision 3). Constants: horizon **180 days**,
max stay **30 nights** (also the scan's look-back bound), request TTL **24 h**.
The public query returns **binary** per-night availability (`unavailable[]` —
counts never cross the public wire) + the gates (`noticeDays` =
max(store, listing), `horizonDays`, `maxNights`), and answers **null** for any
listing that isn't publicly bookable (archived/hidden/hidden-by-category/
non-booking — the no-leak posture). Windows are MYT-midnight-aligned and
capped at 92 days per call.

**Expiry**: `bookings.expireStaleRequests` on a 15-min cron cancels requests
older than 24 h through `applyStatusTransition` — hold release, CRM/usage
reversal, timeline event and buyer notice all ride the one cancel path. The
buyer was promised "confirms within 24 hours" up front; the New bucket's age
escalation (amber 4 h / red 24 h) now doubles as the seller's countdown.

### Buyer surfaces (Variant A, locked 16 Aug)

- **`/{slug}/checkout?booking=<productSlug>`** → `BookingCheckoutForm`
  replaces the cart checkout: 1 Who's booking (name + required MY WhatsApp +
  PDPA line, EN/MS) → 2 When is your stay (the calendar) → optional note.
  Ticket-skin receipt ("RM80/night → nights → **Total when approved**"),
  disabled-with-reason CTA **"Request to book"**, and the honesty pair —
  "Nothing is charged now" + "{store} confirms within 24 hours" — at the
  commitment point. Mobile keeps the fixed bottom CTA bar
  (`--storefront-bar-h`), desktop the sticky right column. Success navigates
  straight to `/track/<token>` — **no wa.me handoff, no ?send** (nothing to
  send; the seller's approve drives the chat).
- **`BookingCalendar`** (`booking-calendar.tsx` on the themed
  `ui/calendar.tsx` DayPicker) with the selection logic PURE in
  `src/lib/booking-dates.ts`: Monday week start, greyed+struck unavailable
  nights (full and blocked identical, locked), two-tap check-in → check-out,
  and **checkout-only handling** — after a check-in, days past the reachable
  window disable, and the first full night stays tappable dashed as the
  LEAVING morning (its night isn't slept; drop this and the night before a
  full weekend is unsellable). The amber conflict line explains the ceiling
  ("… onwards is booked out — you can stay N nights"). Availability windows
  follow month navigation ([visible month, +2 months), stable MYT anchors →
  cached per window).
- **Product page / card**: booking listings price "RM80 **/night**", the card
  CTA reads **"Book"** (calendar icon) and always routes to the page; the
  page's buy box collapses to one door — "Request to book" → the booking
  checkout — with the availability + nothing-paid explainer. **A stay never
  enters the cart** (quick-add unreachable by construction).
- **Counter**: `products.listForCounter` filters booking listings out — the
  counter has no date-range UI; a walk-in guest books on the storefront.
  Revisit if a real seller asks.

## S3 — approve / decline + buyer states (`86eyn4kcn`)

### The two exits

**`bookings.approveBookingRequest`** (owner-or-admin, soft-locked like every
seller write): `booking_requested` → `confirmed` through `applyStatusTransition`
(timeline beat, activation stamp, stage reset — `notifyStatusChange` skips
`confirmed`, so nothing generic goes out), then the guest's ONE message — the
**existing confirmation template + push machinery** (`notifyStorefrontOrderCreated`:
stamps, 30s/2m/8m retries, delivery-webhook correlation, all inherited) whose
button lands on the payable order page. That IS "confirmed + payment ask in one
message": the template states the total (always final for bookings — no
mockup/fee holds by construction) and the page carries Pay-now/manual. Template
env unset ⇒ approve still works, page still payable, no automatic message
(the storefront's own legacy posture).

**`bookings.declineBookingRequest`**: reason REQUIRED (≤200 chars, quoted
verbatim to the guest — a silent no dead-ends someone planning a trip), stamps
**`bookingResolution: "declined"` + `bookingDeclineReason`**, then the one
cancel path releases the hold. The expiry cron stamps
`bookingResolution: "expired"` the same way. Both markers exist so the buyer's
page can say the TRUE thing — and so `notifyStatusChange` **suppresses the
generic cancelled message** on resolution cancels (wrong copy, and the guest
never messaged the WABA, so there's no session window for it to land in
anyway). A seller cancelling an APPROVED booking carries no marker and keeps
today's behaviour. `assertStillRequested` gives cause-true refusals: approve at
hour 25 reads "expired — ask the guest to book again", never a generic error.

### Seller surfaces

- **`BookingRequestCard`** takes the stepper's slot while `booking_requested`
  (the stepper can't move it — the server refuses): amber card with the
  request badge, **"Expires in Nh"** countdown (red ≤4h — the same clock the
  cron kills), check-in/check-out/nights/total in the ticket skin, the
  **capacity context line** ("2 of 5 spots already booked on those nights" —
  new seller-only `orders.get.bookingContext`, computed from the availability
  module minus this order's own hold; never on the buyer path), and
  Approve (primary) / Decline… (outline). The decline dialog: quick-reason
  chips + free text, reason-required submit. After a non-approval resolution,
  **`BookingResolutionNote`** keeps the why (incl. the typed reason) visible
  on the cancelled order.
- Fulfilment card reads "Booking · 2 nights · 25 Sep → 27 Sep" with a
  calendar icon and a "Check-in" date chip; the **booking stepper skips
  "Packed"** (synthesized stages filter the anchor — Confirmed → Checked In →
  Checked Out; a seller's own configured stages are untouched).
- Seller WA alert: `requestBooking` schedules the existing 86eyhw9zy
  new-order template (env-gated; its button opens the order page where
  Approve/Decline leads). A booking-worded template is a Meta-registration
  follow-up.

### Buyer tracking states (design §2)

- **Awaiting**: amber "Request sent" card — "{store} usually confirms within
  24 hours — we'll WhatsApp you either way. Nothing has been charged."
  (EN/BM). The **payment card is suppressed** while requested — an armed Pay
  button on a request would be a lie.
- **Declined**: "Request declined" + the seller's reason as a blockquote +
  "Nothing was charged." + **"Try different dates"** → the storefront (new
  `retailerSlug` on the order payload).
- **Expired**: same card shape with the 24-hour explanation.
- **Approved**: the existing payment card takes over (Pay now / manual) —
  plus the "Your stay" card (check-in/check-out/nights, frozen fields), the
  booking's stand-in for the address/pickup blocks.
- Timeline: the first node reads "Awaiting Approval" (the swept status label,
  seller-locale aware) instead of "Order Received"; `booking_requested` sits
  at position 0.

### Deferred WA messages (explicit divergence)

The spec's matrix gives the buyer a WA ping at request-sent and at
declined/expired. All three need **Meta-approved templates** (the guest has
no session window until they message first), which don't exist yet — same
boat as the confirm template before 86eyf1rck. v1 ships the STATES on the
page the buyer already holds (they land on it at request time, and the
approve message links back to it); the request-ack / declined / expired
templates are the Meta-registration follow-up with Arif, wired the day the
envs exist. The approve message needs NO new template (it reuses the live
confirm template).

### S3 tests

`convex/bookings.test.ts` ("approve / decline"): approve happy path +
no-push-without-env + double-approve refusal; decline reason gates +
resolution stamps + released nights + already-declined refusal; expiry stamps
the resolution + hour-25 approve names it; bookingContext on the seller read
only.

## S4 — seller calendar + block days (`86eyn4kdb`)

The seller's month view, and the calendar's ONE write: block/unblock. The
calendar is a **lens over the orders** (design §3) — every day taps through
to its bookings and each row opens the order; managing a booking (approve,
decline, cancel, advance) only ever happens there.

### Blocks join the one availability authority

New table **`bookingBlocks`** (`retailerId`, optional `productId` — unset =
whole store, `startDate`/`endDate` MYT midnights **end-INCLUSIVE** (a single
blocked day is `start === end`; contrast `bookingCheckOut`, which is
exclusive because it's a leaving morning — a block has no morning), optional
note ≤200 chars, index `by_retailer_start`). `findFullNights` now unions
**capacity-full OR seller-blocked** (`loadBlocksForWindow` — indexed scan
bounded by `MAX_BLOCK_DAYS` 366, the blocks' `MAX_BOOKING_NIGHTS` role —
+ `isNightBlocked`), so all three consumers — `requestBooking`'s atomic gate,
the public buyer calendar, and the seller month view — get the same answer by
construction, and **blocked ≡ full is structural**: the public payload stays
a binary `unavailable[]`, a buyer can never tell "someone booked it" from
"the seller closed it" (spec decision, pinned by test). Blocking stops **new
requests only** — existing bookings on those nights are untouched (the seller
card manages those); overlapping block rows are tolerated and unioned at read
(merging at write would make unblock ambiguous).

### `convex/bookingBlocks.ts`

- **`blockDays`** (owner-or-admin, soft-locked, act-as audited): validates
  midnight alignment, order, ≤366 days, note length, and that a
  `productId` scope is one of the store's booking listings. No overlap
  merging.
- **`unblock`**: deletes the row; **idempotent** (already-gone = no-op) so a
  double-tap or stale sheet never errors.
- **`sellerCalendar`** (≤92-day windows, the availability bound): per-day
  `{date, booked, blocked}` + the raw block rows (the unblock sheet needs ids
  and notes) + the store's booking listings (the filter chips).
  **`capacityPerNight` is returned only when listing-scoped** — the honest
  denominator; the all-listings view shows bare counts because summing
  capacity across different products is fake math (design decision).
- **`dayBookings`**: the tapped night's stays (`checkIn ≤ night < checkOut`,
  non-cancelled), each row `shortId`/name/range/status — the tap-through.
- **`hasBookingListings`**: does this store sell the booking kind at all —
  gates the Orders-header toggle so non-booking stores never see a calendar
  they have nothing to put on.

### Seller surfaces

- **`/app/orders/calendar`** (`app.orders.calendar.tsx`) +
  **`OrdersViewToggle`** — an Inbox · Calendar segmented control (Links, so
  back/refresh/deep-links work) in the Orders header on both breakpoints,
  rendered only when `hasBookingListings`. Deliberately **outside the
  `inboxEnabled` Pro gate**: booking is all-tier, so a Starter booking store
  still reaches its calendar. Deep-linking with zero booking listings gets a
  what-this-is empty state + "Create a booking listing", never a blank grid.
- **`SellerBookingCalendar`** (`seller-booking-calendar.tsx`): Monday-start
  month grid (design cell variant A — count pills `N/M` listing-scoped, bare
  `N` on all-listings), blocked cells striped + `Ban` icon, today ringed,
  past dimmed; month nav bounded −12/+6 months; listing filter chips (a
  single-listing store auto-scopes so the honest denominator shows without a
  tap); a legend line names both markers. **Two-tap blocking** (same
  interaction as the buyer calendar — drag fights scroll on mobile): "Block
  days…" arms → first tap = start, later tap = end (earlier tap restarts,
  same day = one night) → confirm sheet with scope (whole store vs the
  filtered listing — scope choice only exists when a listing chip is
  active), optional note, and the consequence line ("stops **new** requests
  only — existing bookings stay, buyers just see the dates as unavailable").
  Tapping any day outside block mode opens the **day sheet**: covering
  blocks (scope + note + one-tap Unblock, per-listing blocks name the
  listing) + that night's bookings (rows → order page) + a "Block this
  night" shortcut when unblocked.

### S4 tests

`convex/bookingBlocks.test.ts`: validation sweep (alignment / order / length
/ note / non-booking listing / stranger), blocked-≡-full in the public
window, blocked night refuses a NEW request with the same "no longer
available" copy while the existing stay survives (and stays listed in
`dayBookings`), per-listing scope leaves siblings open / store scope covers
all / unblock restores + rebooks + is idempotent, `sellerCalendar` shapes
(counts, scoped-only capacity, blocks + listings, window bound), and
`hasBookingListings` by kind.

### What S4 deliberately does NOT do

- **No buyer-visible "blocked" state** — blocked ≡ full, locked (above).
- **Blocks never cancel bookings** — a seller closing dates with a stay
  already on them handles that stay on the order (decline/cancel has the
  reason + notification machinery; a block silently killing a paid stay
  would be indefensible).
- **No ICS feed** — the Google-Calendar one-way sync is S6 (`86eyn4kf2`),
  which reads the same bookings + blocks this slice renders.
- No drag-to-select (two-tap, mobile-first), no week/agenda view, no
  recurring blocks (a season is one ≤366-day block).

## S5 — security deposit end-to-end (`86eyn4kee`)

Sengloh's original ask: the refundable damage hold, collected ON TOP of the
stay price **in the same single payment** at approval (distinct from the
parked partial-payment deposit `86eyhwb03`). Held money, never revenue.

### Schema + money plumbing

- **`products.booking.securityDeposit`** (sen, optional; `sanitizeSecurityDeposit`
  in `productKind.ts` — integer 0..RM10,000, 0 normalizes to unset). The
  wizard's booking pricing step and the edit form's booking card both carry
  the field (shipped HERE, not S1 — an input that does nothing until its
  machinery exists is worse than hidden). Handoff carries it both ways.
- **`orders.securityDeposit`** — FROZEN at request time (snapshot posture; a
  policy edit never changes a placed booking; pinned by test). Rides the
  `computeOrderTotals` **extras seam** (quotedAmount/pickupFee/deliveryFee
  precedent), so `total = nights × price + deposit` — ONE payment at
  approval, zero new payment states; the S3 approve message needs no change
  (its total is the total).
- **`revenueExcludingDeposit`** (`convex/lib/order.ts`) — the ONE author of
  the revenue figure: CRM `totalSpent` (link / cancel-decrement /
  `moveOrderToPhone` / backfill) and Insights (earned, trend, collected,
  payment slices via `InsightsOrderInput.securityDeposit`) all subtract the
  deposit. Recompute-delta sites (`total - order.total`) need no netting —
  the deposit is frozen, so it cancels out of any difference.

### Stated before, lined everywhere after

- **Pre-request** (never a surprise at payment): the product page's booking
  box states "+ RM100 refundable security deposit — collected with your
  payment, returned after check-out"; the booking checkout receipt carries a
  deposit line, folds it into "Total when approved", and the nothing-charged
  footer names the return.
- **Own line on every money surface:** buyer tracking totals (EN/BM), seller
  order-detail totals, the S3 request card ("incl. RM100 refundable…"),
  receipt/invoice PDF ("Security deposit (refundable)" row), CSV
  **"Security deposit"** column (0.00 never blank, so a bookkeeper can
  subtract the column — the identity the header comment documents).

### Return tracking

**`bookings.settleSecurityDeposit`** (owner-or-admin, soft-locked, act-as
audited, ONE shot): guards — booking order with a deposit, **`delivered`**
(check-out) and **paid** only (before check-out there's nothing to return; a
cancelled-after-payment booking settles the whole payment in one refund
conversation instead — both order pages state that context); `keptAmount`
integer 0..deposit, reason REQUIRED on any keep (≤200, quoted verbatim to the
guest). Stamps `securityDepositReturnedAt` + `securityDepositKeptAmount/
KeptReason` (unset on a full return).

Seller: **`SecurityDepositCard`** on order detail — amber "RM X to return"
card at delivered+paid (the card IS the v1 reminder; no nudge cron), **Mark
returned in full** / **Keep part of it…** (dialog: amount ≤ deposit +
required reason, destructive-styled confirm), then the settled outcome note
(mint returned / amber kept with the split). Buyer: the tracking page shows
the same outcome (mint full-return card / amber kept card with the reason
blockquote and returned-remainder line, EN/BM).

### Explicit divergences

- The ticket's "ONE WA note on settle" is **deferred with the S3 template
  batch**: booking guests never message the WABA (no wa.me handoff), so
  there is no session window days after check-out — a session send would
  silently fail exactly when it matters. The outcome lives on the order page
  both sides already hold; the WA ping joins the Meta-template registration
  follow-up (and the standing no-new-WA-sends posture).
- Partial keep ships (ticket recommended it pending Arif); a full keep is
  the same path with `keptAmount === deposit`.

### S5 tests

`convex/bookings.test.ts` ("security deposit"): frozen at request + inside
the one total + policy-edit immunity + CRM spend excludes it; settle guards
(pre-checkout / unpaid / over-deposit / keep-without-reason / double-settle)
and both outcomes; depositless refusal. `convex/products.test.ts`: stored in
sen, 0-clears, ceiling refusals. `convex/lib/insights.test.ts`: earned /
trend / collected / payment slices all net of deposit.
`convex/lib/orderCsv.test.ts`: the column + 0.00 default.

### What S2 deliberately does NOT do

The seller's Approve/Decline surfaces, tracking-page request states and every
WhatsApp message (request received / approved+pay / declined / expired) are
**S3** — which is why the chain merges together; an S2-only deploy would take
requests the seller can only cancel. Blocks join the availability module in
S4; the deposit line in the receipt is S5.

### S2 tests

`convex/lib/bookingAvailability.test.ts` (night math, exclusive check-out,
range gates, holder set), `convex/bookings.test.ts` (binary availability +
per-night capacity, no-leak null, window validation, request happy path ×
nights pricing, phone required, last-spot race, back-to-back stays,
release-on-cancel, range gates, non-booking refusal, write-path guards, expiry
sweep incl. fresh-request survival, counter exclusion),
`src/lib/booking-dates.test.ts` (tz-proof date conversion, two-tap reducer,
checkout-only ceiling + conflict copy inputs).

### What S1 deliberately does NOT do

- **No buyer-surface change**: a booking product renders on the storefront as
  a normal product until S2 lands the calendar + request-to-book — which is
  exactly why S1 merges to staging only together with S2+S3.
- No counter exclusion (S2), no availability/capacity checking (S2), no
  security deposit (S5), no CSV-import kind column (booking listings are
  wizard-created; import stays physical-kind).
- Public reads: `kind`/`booking` ride the existing `productWithVariants`
  spread — public-safe by design (buyers price and book against them in S2).

### Tests

`convex/products.test.ts` ("product kind + booking config"): pairing
enforcement both directions, capacity bounds, update re-tune + non-booking
refusal, physical-normalizes-to-unset. `convex/retailers.test.ts`
("storeType"): set/read/clear. `product-wizard.test.ts`: booking route
`[0,1,3,5]`. `product-wizard-booking.test.tsx`: render cover — step 0 cards +
disabled-with-reason Continue, storeType pre-answer badge, food follow-up
note, the walked booking route, publish payload (`kind` + `booking`, no
`minQuantity`, one `blockWhenOutOfStock: false` variant), junk-capacity
inline error, leaving-booking re-asks. `product-summary.test.ts`: booking
strip wording.
