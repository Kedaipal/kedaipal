# Live courier price at checkout (z8r3fdbvdy)

**Status: complete, pending a local test round.** Sellers can pick the mode,
stored stores migrate to it, and buyers are priced across every armed
provider.

Reference: [`delivery-lalamove.md`](./delivery-lalamove.md) ·
[`delivery-delyva.md`](./delivery-delyva.md) · ticket
[z8r3fdbvdy](https://app.clickup.com/t/z8r3fdbvdy)

## Why it exists

A store can arm more than one booking provider (86eyjpv6z), and the checkout
fee was priced by ONE tool while dispatch could use ANOTHER. That is a
measured leak, not a hypothesis: a Lalamove-priced store collected **RM4.00**,
the vendor then booked Delyva Instant at **RM4.75**, and ate RM0.75 on every
such order.

## The rule

The fee is a PREDICTION of which tool will ship the order. Predictions drift,
so the only real question is **who absorbs the drift** — and our customer is
the vendor.

1. **Both providers quote → charge the HIGHER.** Whichever tool the seller
   picks at dispatch, the collected fee covers it; a seller who books the
   cheaper one keeps the difference, and the dispatch card shows "buyer paid
   X" beside every price so that choice is always informed.
2. **Cold cart → Delyva alone.** A rider carries no temperature guarantee, so
   a cheaper rider quote must not win — and must not stand in when Delyva has
   nothing. We refuse rather than price a frozen cart as an ambient trip.
3. **One provider armed** → that provider. This is what `mode: "lalamove"`
   always was; `live` is its superset.
4. **A quote in a currency the buyer isn't charged in is DISCARDED**, never
   converted. Reachable today: a Malaysian Delyva account attached to a
   Singapore store prices in MYR, and we hold no exchange rate.
5. **Nothing priceable → the most ACTIONABLE reason present.** "Change your
   address" is said only when every provider agrees the address is out of
   range; a seller-side breakage outranks a generic failure because its copy
   points somewhere useful.

Min-pricing was proposed and rejected (4 Sep): it is friendlier to the buyer
and recreates exactly the leak above. The over-collection is small in
practice because **Lalamove answers nothing outside its service area**, so the
both-quote case is the intra-city one, where rider and courier prices sit
close together.

**Delyva's side of the comparison is its CHEAPEST service**, because Delyva
returns a list, not a price, and the dispatch card pre-selects cheapest too —
so checkout and dispatch describe the same choice. A seller who habitually
books a dearer courier still under-collects by the difference; a per-store
"preferred courier" setting is the later tightening, deliberately not v1.

## Where the code lives

| Piece | File | Note |
| --- | --- | --- |
| The rule | `convex/lib/liveQuote.ts` | **Pure.** No network, no database — the part that carries money is testable on its own. All three money guards are mutation-tested. |
| Orchestration | `convex/liveQuote.ts` | Fetches every armed provider in parallel, applies the rule, records ONE row. Its own module because it belongs to neither provider. |
| Lalamove fetch | `convex/lalamove.ts` → `fetchLalamoveQuote()` | Lifted out of `quoteForCheckout` so a price can be fetched **without** minting a redeemable row. |
| Delyva fetch | `convex/delyva.ts` → `fetchDelyvaCheckoutQuote()` | Cheapest service; an empty list is disambiguated by `GET /service` exactly as dispatch does. |

**A losing quote leaves no row behind.** `deliveryQuotes` rows are redeemable
at order create, so only the charged price may have one.

**Item type comes from the STORE default**, exactly as dispatch does. That is
what unblocked this ticket from 86eyrmv1j (per-item temperature flags): a
frozen store quotes frozen, an ambient store quotes parcel, and nothing is
ever silently priced as ambient. When per-item flags land, only
`cartItemType()` changes.

**Cart weight is summed from the VARIANTS**, never accepted from the client —
a tampered weight would otherwise buy a cheaper courier band. **An item with
no usable weight (an unweighed product, a custom line) is quoted at a one-kilo
floor** (`liveQuoteWeightKg`, `LIVE_QUOTE_WEIGHT_FLOOR_G` in
`convex/lib/liveQuote.ts`): weighed lines sum, unweighed lines add nothing,
and a cart holding one is never quoted under 1 kg. A fully weighed cart keeps
its real sum even under a kilo. Only an EMPTY cart stays unpriceable (the
"every surface supplies the cart" guard below).

Until 23 Oct 2026 an unweighed line meant Delyva "simply didn't bid", and
that was reported as a store-side gap. On a store whose rider can't reach the
address — or, as on Mandos (prod: every tee stored at 0 g, Delyva the only
courier, no self-collect) on every address — the whole checkout refused with
"pricing isn't working for this store", and the seller never saw why: the
readiness list that names unweighed products only showed for the weight-zone
mode. Parcel weight is an optional product field, so blank is a normal state,
not a misconfiguration to punish the buyer for. **Why a floor and not a
per-item guess:** nearly every Malaysian parcel service bills its first
kilogram flat, so a light unweighed cart (tees, kuih) is priced exactly right
and a heavier one is under-quoted — the seller who left the weight blank
absorbs the next band when they book, never the buyer; counting each unweighed
item as a kilo would overcharge a buyer of three tees for a rule they never
saw. **Rejected:** fee-pending ("arrange"), which is what the weight-zone mode
does for a missing weight — in live mode it would put the payment chase back
on the seller, the pain this product exists to remove. The seller is told in
three places: the live-pricing card's readiness list (now shown whenever
Delyva is armed, naming the products and the one-kilo rule), the "How live
pricing works" bullet, and the dispatch dialog, which already asks for the
packed weight before any booking. **The floor is the backstop, not the
path** — the section below makes the weight required wherever pricing
depends on it.

## Parcel weight is required where pricing depends on it (23 Oct 2026)

**The rule has one author:** `weightPricingOf(retailer)` in
[`convex/lib/weightPricing.ts`](../convex/lib/weightPricing.ts) answers *why*
a store's delivery charge depends on parcel weight — `"rate_card"` (the
weight-zone mode) or `"courier"` (live pricing with Delyva armed, the
Mandos shape) — or `null`. Riders price by distance, so a live store with
Lalamove alone does not price by weight. "Armed" is `delyvaBookingArmed`
(credentials + the Courier-booking toggle + country), deliberately a hair
wider than the bidding condition, which also needs a pickup address: a
seller half-way through Delyva setup is asked for weights one step early,
never one step late. The owner read exposes it as `retailers.weightPricing`
(one enum, never the keys), and every surface below reads that:

- **The product form and the wizard require it.** On such a store the
  parcel-weight inputs are promoted out of Advanced (as the rate card already
  did), marked *(required)*, and `buildSubmitVariants` refuses an active,
  non-custom row with a blank or `0` weight with an issue addressed to that
  row's input — the wizard's Price step asks beside every price (with a
  "Same weight for all" fill) and maps the same issue to `weight:<row>`. The
  copy is keyed by the reason (`WEIGHT_REQUIRED_COPY`): the rate-card store
  is told the item *can't be priced*, the courier store that it is *quoted as
  a 1 kg parcel until weighed* — never the other way round. Custom lines and
  off-sale choices are exempt (unknowable, unorderable); services and
  bookings have no parcel, and an event RSVP is met at the venue (judged by
  the fulfilment moment, never by kind). The server stays permissive here — the floor and
  the rate card's "arrange" rule are the backstop for imports, the MCP server
  and legacy rows.
- **The bulk fill fixes an existing catalogue in minutes.** Products →
  Parcel weights (`/app/products/weights`,
  [`parcel-weights-fill.tsx`](../src/components/products/parcel-weights-fill.tsx))
  lists every unweighed buyable choice product by product with a box each, a
  "Fill every empty box" control (it never overwrites a typed weight) and a
  per-product fill, and saves through `products.setParcelWeights` — bounded
  to `PARCEL_WEIGHTS_BATCH_MAX` rows a call (the page batches), every row
  checked against the store (a foreign id refuses the whole batch), a list of
  ids and grams rather than anything keyed by a name. The list is
  `products.unweighedChoices`, the same walk (`collectUnweighedChoices`) the
  readiness notice counts with, so the two can never disagree about a row.
  It is reached from the readiness notice (one shared `MissingWeightsNotice`
  on the Settings pricing card AND the Products list), the floor note on an
  order, the arming gates — and permanently from the Products header's bulk
  menu ("Parcel weights", beside Import/Export), because the notice vanishes
  once every product is weighed and the page must stay reachable (Zaki,
  /test-code round).
- **Arming weight pricing waits for the catalogue.** Switching Delyva's
  Courier-booking toggle on in live mode, moving the delivery charge onto the
  rate card, or onto live pricing while Delyva is armed, is **refused**
  server-side (`assertCatalogueWeighed`) while any buyable choice is
  unweighed — "N products have no parcel weight — couriers price every order
  by weight. Set them under Products → Parcel weights first." — and the
  controls say so *before* the tap: the toggle greys out with the count and
  the link (`delyva.getSettings.bookingHeldForWeights`), the pricing card's
  Save greys out with the same line. Connecting Delyva on a live store stores
  the key but holds booking OFF (`bookingHeldForWeights` on the connect
  result; the Integrations card says so). **Only the switch is gated** — a
  store already pricing by weight keeps working on the floor / the "arrange"
  rule and keeps saving its other settings, so a legacy store (Mandos) never
  loses a buyer; the notice and the fill are how it rectifies itself.
  **Rejected:** warn-only — a warning beside a working switch is the state
  Mandos was in; and gating admin act-as differently — the gate protects the
  seller's money, and an admin pre-building a store has no products yet.
- **The order says when the floor fired.** `liveQuoteWeightFacts` reports
  `floored` and `unweighedLines` (non-custom lines a product weight would
  have priced); a Delyva-won quote stamps them on its `deliveryQuotes` row
  (`weightFloored`, `unweighedLines`, widen-only) and `orders.create` carries
  them onto `deliverySnapshot`. The seller's order page shows "Priced at the
  1 kg floor — N items had no weight. A heavier parcel costs you the
  difference when you book." under the delivery fee, and the Delyva dispatch
  card repeats it above the weight box — one author,
  [`floor-priced-note.tsx`](../src/components/order/floor-priced-note.tsx).
  A rider-won quote never carries the stamp (riders don't weigh). Buyer
  surfaces are unchanged: the buyer paid the floor and owes nothing more.

## Country posture

`live` works in **both markets**. It was MY-only for one day — "no provider
can quote in SG" — until Lalamove SG opened
([z8r3fdch3r](https://app.clickup.com/t/z8r3fdch3r)): riders cover every
SG→SG address, so the justification died and `COUNTRY_DELIVERY_MODES.SG`
gained `"live"`. Distance and weight-zone stay MY-only (their zone maps are
Malaysia-shaped), and the legacy `"lalamove"` literal stays refused for SG —
no SG store was ever on it, so there is nothing to migrate. An SG store's
Delyva side simply never bids while its catalogue is empty; Lalamove prices
alone, which is the single-provider case the rule already handles.

## Audit trail

The quote row is consumed at create, so the order keeps the evidence:
`deliverySnapshot.quoteProvider`, `.quoteServiceName` and `.quotesConsidered`
(every bid, winner included) answer "why was I charged RM5.70" months later.

## Settings

**The tile is no longer Lalamove's.** It carries both wordmarks, because the
mode prices across every armed provider and a rider-branded tile says the
wrong thing to a store that ships parcels. It stays the promoted, first tile
for the reason it always was: every tier should SEE that real courier pricing
exists.

Under it, a **"Priced by"** block states who will actually be asked and what
happens when they disagree — two armed providers is not an edge case, it is
the reason the mode exists, and a seller who doesn't know both are quoted
can't explain their own checkout prices to a buyer. With one provider armed it
says how to add the other; with none it says checkout would be refused and
points at Integrations.

**Rider-only controls follow the rider.** The vehicle picker, the pickup-pin
reference and the city-zone coverage note render only when Lalamove is
connected — they are meaningless to a parcel-only store, and they used to
render regardless because the mode was Lalamove's.

**The cold-chain constraint is stated, not discovered.** A store whose Delyva
parcel type is Chilled or Frozen sees an amber note: checkout asks for a
cold-chain price, and if the account has no cold-chain service, no price comes
back and delivery checkout is refused — riders are never substituted. A seller
must never learn that from orders quietly stopping.

**Migration:** `migrations:migrateLalamoveModeToLive` flips stored
`mode: "lalamove"` rows. Safe on every store, because it only bites where the
leak already did — a store with one armed provider has one bidder and prices
identically either way. Idempotent. The old literal stays valid (and shows as
selected) so an unmigrated row is never "nothing picked".

## Hardening (PR #253 review)

**Every buyer surface supplies the cart.** The hook's `items` input is
REQUIRED — two surfaces (claim checkout, the tracking page's address-edit
dialog) omitted it, which starved Delyva of a weight and silently re-opened
the one-provider leak exactly where "a claim link pricing differently from
the storefront would be its own bug". The type system now catches the next
surface that forgets.

**The legacy single-provider action refuses provider-aware stores.**
`lalamove.quoteForCheckout` answers `unavailable` for a `mode: "live"` store:
serving it would mint a redeemable Lalamove-only row — an API-level way
around charge-the-higher, and on a cold store a rider price for a frozen
cart. The one honest caller is a stale pre-deploy bundle, whose buyer
recovers on reload (fresh bundles re-route reactively the moment the
migration flips the mode). Once the legacy `"lalamove"` mode literal is
narrowed out of the schema, this action retires with it — that narrow is the
same already-ticketed step, not a second one to forget.

**A quote row is bound to the cart it priced.** Delyva bids on summed
variant weight, so quoting a light cart and checking out a heavy one would
buy a cheaper courier band. Provider-aware rows stamp their lines
(`deliveryQuotes.lines`) and `loadCheckoutDeliveryQuote` compares them
against the order's real lines as a multiset — same posture as its existing
coordinate check. Legacy rows carry no lines (rider prices ignore the cart)
and skip it.

## Checkout

**A cart edit re-quotes.** A provider-aware quote is bound to the cart it
priced (`sameQuotedLines`), so `useLiveDeliveryQuote` re-fires when the
cart's line multiset changes — a quantity bump changes the weight Delyva
bids on, and without a re-quote the buyer saw a stale fee and then a refusal
at order create. Cart edits are debounced at 900 ms (a pin pick is 400 ms)
so tapping + three times spends one quote from the store's `lalamoveQuote`
bucket (10/min, burst 4). A rider-only store never re-fires for the cart.
The checkout also holds the store's "live" answer across the edit
(`heldDeliveryAnswer` with `placeholderData: keepPreviousData`): the
reactive `delivery.quote` takes the cart as an argument, so each tap used to
blank it for a beat — the delivery line vanished, the total dropped and the
live quote reset. A held FEE (flat, distance) is still dropped, so a fee for
an old address never shows. Measured on the dev sandbox (Alor Setar, Delyva
only): 1 kg RM 4.75, 10 kg RM 9.50, 25 kg RM 53.77 on DHL once the cart
outgrew Instant Delivery — and a burst of 17 taps spent one quote.
Weight units: the cart is summed in grams and sent to Delyva as
`weight: { unit: "kg", value }` (`convex/lib/delyva.ts`, `roundKg`); Lalamove
is never sent a weight — riders price by vehicle and distance.

**The address helper names who prices it.** `delivery.quote`'s `live` result
carries `riders` / `couriers` — which kinds of provider can bid
(`lalamoveBookingArmed`, `delyvaBidsAtCheckout` in
`convex/lib/courierBooking.ts`, the latter being exactly the condition
`getLiveQuoteContext` arms Delyva on). `liveQuoteAddressHint`
(`src/lib/live-quote-copy.ts`, one author for the storefront and the claim
checkout) then says "by rider", "by courier" or "by rider or courier", and
drops "addresses outside the rider's coverage can't be delivered" the moment
a courier can bid — it had been saying that on a Delyva store that priced an
Alor Setar address no rider could reach (`/test-code` on PR #415).

**The store's mode decides which action prices it**, handed to the client on
the reactive `delivery.quote` result as `providerAware` — never inferred.
A `"live"` store goes through `liveQuote.quoteForCheckout`; a not-yet-migrated
`"lalamove"` store keeps the single-provider action. So **a deploy alone never
changes what anyone is charged** — only the migration does, which is the whole
point of doing it as widen → migrate → narrow.

All three buyer surfaces share the hook and therefore agree: the checkout
sheet, the claim-link checkout, and the tracking page's address-edit dialog.
A claim link pricing the same cart differently from the storefront would be
its own bug.

**`no_cold_service` is its own buyer state**, not folded into "too far". The
address is fine, so the copy must not send anyone editing it — it says the
store can't ship chilled or frozen here right now and points at WhatsApp
(and pickup, where the store offers it). Folding it into `out_of_range` would
have had buyers rewriting a perfectly good address forever. All three
surfaces render it; two of them would otherwise have fallen through to a
spinner that never resolves.

**It can never be stored.** A cold-chain block refuses checkout rather than
landing the order fee-pending — a frozen cart must not quietly become "the
seller will confirm the charge later" — so `storablePendingReason()` strips it
at the three order-creating call sites.

**Delyva's inputs ride along**: the written city/state/postcode (it prices on
the postcode, not the map pin) and the cart lines (the server re-reads each
variant's weight itself). Coordinates stay required for both modes, because
the redemption check at order create is coordinate-based and one replay
control covering both providers beats two.
