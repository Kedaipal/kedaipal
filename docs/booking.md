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
| S3 `86eyn4kcn` | Approve/decline + WA copy set + buyer tracking states | — |
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
