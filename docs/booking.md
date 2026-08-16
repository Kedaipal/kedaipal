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
| S2 `86eyn4kbw` | Availability module + buyer calendar (Variant A) + request-to-book | — |
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
