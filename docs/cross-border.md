# Cross-border delivery MY ↔ SG

ClickUp [`z8r3fdr5yy`](https://app.clickup.com/t/z8r3fdr5yy). Decisions: Zaki,
28–29 Oct 2026 (ticket comments carry the full reasoning).

A Malaysian store can take orders delivered to a Singapore address, and a
Singapore store can take orders to a Malaysian one. It works like a **corridor**,
not "ship anywhere": v1 opens exactly the other country in `COUNTRIES`, and the
address the buyer types is held to that country's real format.

## The model in one paragraph

A store saves a **lane**: "I deliver to Singapore", plus **its own price for
Singapore** (`retailers.crossBorderLanes`). Products **inherit** the lane, and a
seller can only opt a product **out** (`products.domesticOnly`). The buyer picks
**Deliver to** at checkout. A foreign address is priced by the lane, never by the
domestic config. The whole thing is **Pro**, and the gate sits at the **address**,
not the courier, so a flat-fee or free store can't take a foreign address on
Starter either. The pure rules live in [`convex/lib/crossBorder.ts`](../convex/lib/crossBorder.ts).
The database-backed read lives in [`convex/crossBorder.ts`](../convex/crossBorder.ts) `storeLanes`.

## Stored vs live: a lane pauses, it is never deleted

`effectiveLanes` / `lanePauseFor` decide at **read time** whether a stored lane
is taking orders. That way a downgrade, a disconnected courier or a pending
products step pauses it everywhere at once, without a settings write, and the
lane comes back untouched once the cause clears. **A buyer is never offered a
country nothing can price.**

| Pause | Kind | Why | What the seller sees |
|---|---|---|---|
| `plan` | store-wide | Not on Pro/Enterprise (`PLAN_FEATURES.crossBorder`) | Pro badge + Upgrade on the switch |
| `delivery_off` | store-wide | `offerDelivery === false` | "Turn on delivery" link |
| `awaiting_products` | lane hold | A NEW lane, products not yet confirmed (`lane.awaitingProducts`) | "Almost on" + "Choose what can go" |
| `courier_unavailable` | lane hold | A `live` lane, and EasyParcel can't quote (`easyparcelQuoteBlock`) | The missing step + its fix (Connect / Add your WhatsApp number / Finish setup) |

**Home pricing no longer pauses a lane** (Zaki, 30 Oct): a lane always carries
its own price, so a store on live courier pricing at home delivers abroad at the
lane's price. The old `live_pricing` pause is gone.

A store-wide pause keeps the price but locks it (the server refuses any lane
save while it holds): the form is one disabled `fieldset` with "Saving is off
while delivery to … is paused" by the button. A **lane hold never locks the
price**: switching away from EasyParcel pricing is one way out of it. The switch
can always be turned off. Upgrading uses the house `UpgradeLink`.

**Turning on is two doors, one switch.** The switch opens one price chooser in
two halves (the Delivery pricing pattern): *Kedaipal built-in — you set the
price* (flat, weight, free) and *Partner integration* (**Priced live by
EasyParcel**). Saving stores the lane HELD (`awaitingProducts: true`) and opens
the products step; confirming it (`setDomesticOnly({ confirmLane })`) clears the
hold in the same transaction as the choices. A live lane saved before EasyParcel
is ready is held as `courier_unavailable` and **goes live by itself** once
EasyParcel can quote. No callback, nothing to remember. On a MY store, the
**first EasyParcel connect opens the lane** (live, held for products):
EasyParcel only carries overseas orders there, so connecting it means
overseas. It's skipped if a lane exists, the plan or delivery is off, or
products need weights. Never on an SG store, where EasyParcel also carries
home parcels.

`domesticOnlyCouriersDeliver` names the couriers that ONLY deliver at home
(never EasyParcel, which also goes abroad), so the help line can't claim an SG
store's overseas courier stays home.

## Pricing: the buyer always sees a price

`CrossBorderPricing` has three arms, and each one always gives a price:

- **`flat`**: a fee per order (must be > 0), with an optional free-above threshold.
- **`weight`**: one band card for the whole country, with an optional threshold.
  An unweighed cart or one over the last band is **blocked** with the reason; it
  never lands fee-pending, because the lane promised a price up front. A weight
  lane makes `weightPricingOf` answer `rate_card`, so the parcel-weight readiness
  notice and the arming gate cover it.
- **`free`**: the seller covers the courier. It needs an explicit tick in
  settings and is never inherited from domestic free delivery.

The **Delivery pricing** page says the lane's price too ("Orders to Singapore have
their own price", with a link), and its Free card says overseas orders still pay
it. Without that, a store on Free read "no delivery charge" and could assume
orders abroad ship free. The note is judged on what's **saved**: a paused lane
reads "Delivery to Singapore is paused", with the reason and the kept price,
never that its price applies. The warning by the save button covers what
saving live **would** change, so it shows only while the lane is still live.

**`live`** (z8r3fdr5yy follow-up): **priced live by EasyParcel** at checkout,
optional free-above. It's the courier that carries the parcel, so the buyer pays
what the default booking costs:

- `delivery.quote` answers `{ kind: "live" }` for the cart, and checkout calls
  `liveQuote.quoteForCheckout` with the **destination country**. EasyParcel is
  the only bidder abroad (`getLiveQuoteContext`).
- **The box is picked from the cart's weight** (`boxForWeight`: the smallest box
  whose size weight, L×W×H ÷ 5000, covers it. Small ≤ 0.6 kg, Medium ≤ 2.25 kg,
  else Large). The dispatch card pre-selects the same box, and the seller can
  change it at booking. The guide (`ParcelBoxGuide`) shows on the live option.
- **The service priced is the dispatch card's pre-selection** (`checkoutRate` =
  `defaultRateId`, moved to `convex/lib/easyparcelRates.ts` so there's one
  author).
- **No currency conversion.** The buyer always pays in the store's currency, and
  a live EasyParcel account quotes in it (connect refuses a live account from the
  other country). An account in another currency (the MYR sandbox on an SG
  store) holds the lane as `wrong_currency` instead of offering a price it
  can't charge.
- **Bound to the postcode, not a pin**: an overseas address is often typed by
  hand. The held `deliveryQuotes` row carries `postcode` instead of
  coordinates, and redemption refuses a different postcode. So checkout never
  asks an overseas buyer for a map pin: manual entry always stays open, the
  quote fires only once the postal code is complete (`postcodeRule` — 5 digits
  MY, 6 SG, so typing "46…" spends no courier quote), and until then the
  block reason is `no_postcode` — "Add your postal code so we can calculate
  your delivery fee", by the fee line and by Place order. The order door says
  the same: a live-lane order with no matching quote (stale tab, expired or
  other postcode) is refused with "re-enter your postal code to get a fresh
  price", never the domestic "pick from the suggestions".
- **One currency fallback**: the lane's readiness (`wrong_currency`) and the
  checkout quote's currency filter both read `storeCurrencyOf` (saved
  currency, else the country's), so they can't disagree on a store with no
  saved currency.
- Arming one runs `assertCatalogueWeighed(…, "courier")`, and `weightPricingOf`
  answers `courier` for a live lane (the Delyva posture).

## Delivery at a glance

The top of Settings → Fulfilment (`delivery-at-a-glance.tsx`) has one row per
kind of order (*Within Singapore*, *To Malaysia*, *Pickup*), always in the
store's own countries. Each row says what the buyer pays and who carries it,
and links to its settings. With no lane, the overseas row offers both doors
(`?start=own` / `?start=live`); while a lane is held or paused, it says why.

## The doors

| Door | Rule |
|---|---|
| `retailers.updateSettings({ crossBorderLanes })` | Pro, delivery on, not the store's own country; arming a weight or live lane runs `assertCatalogueWeighed`. A NEW lane is stored `awaitingProducts`. `null` / `[]` always clears. |
| `delivery.quote({ country })` | Abroad: `no_lane`, `home_only` (the blocking products **named**), the lane's fee, or `live` (fetch EasyParcel's quote). Domestic: unchanged (EasyParcel bids on SG home deliveries too). |
| `orders.create` | `deliveryAddress.country` ≠ store country → `crossBorderLaneForOrder` (live lane or refuse) → address judged against the **destination**'s format → every line must `shipsAbroad` (refusal names them; the order is **never split**) → priced by the lane; a `live` lane redeems the held EasyParcel quote (`loadCheckoutDeliveryQuote`, postcode-bound) or refuses. Every new order's address is stamped with its country. |
| `orders.updateDeliveryAddress` | The order's country is fixed at checkout. An edit moves the address within it and re-prices on the lane; it refuses if the lane has closed. |
| `orderClaims.commit` | Claim links (a counter sale finished on the buyer's phone) deliver within the store's country only. |

## Products: inherit, opt out

- `hasParcelLeg`: a physical good without a fixed event moment. Services,
  bookings and events never cross the border (they're judged on how they're
  fulfilled, never on `ProductKind` alone).
- **Products → Overseas** (`/app/products/overseas`): the one-time pass right
  after the switch is turned on (`?first=true`), and the screen "Choose products"
  reopens later. It's grouped by category with a tri-state select-all; services
  and events are shown disabled with the reason. It saves through
  `crossBorder.setDomesticOnly` (bounded, all-or-nothing). Turning a product
  back on **clears** the field.
- The product editor asks **"Can it go to Singapore?"** under *At checkout*,
  only when a lane is saved and the product has a parcel to send.

## Buyers

- **Checkout**: a **Deliver to** switch (store country first) sits above the
  address. The address form, its zod arm (`deliverTo` in the form schema), the
  Places region and the saved-address slot all follow it. It's preselected from
  the edge geo (`useMarketplaceRegion`) when the store delivers there; the switch
  is always shown because geo is a guess. Abroad, checkout shows the
  import-tax line, and home-only items appear with a one-tap **Remove** each.
  The fee line reads **"Delivery to Malaysia"** on the checkout ticket, the
  buyer's tracking page and the seller's order page — one author,
  `overseasFeeLabel`. The WhatsApp number's
  country plate starts on the Deliver-to country and follows the switch while
  the number box is empty. It never rewrites a number already typed.
- **Storefront** (Zaki, 28 Oct): **every product is shown to everyone.** A visitor
  from a country the store delivers to sees **"Ships within Malaysia only"** on a
  product that can't go: as a card chip and on the product page
  (`HomeOnlyLabelProvider`). The same visitor reads **"Delivers to Malaysia"**
  in the store header's facts (`useAbroadVisitor`), so the store's reach isn't a
  checkout surprise. Nothing is hidden by geo. Geo-IP gets VPNs, carrier
  NAT and the Johor Bahru commuter wrong, a buyer in SG can order delivery to
  family in MY, and a shared link must show the same shelf to everyone.
- **/stores**: a store is listed in the other country's directory only while its
  lane is **live** and it has ≥1 visible product that can go. The card says
  **"Ships from Malaysia"** (`MarketplaceStoreCard.shipsFrom`). A paid highlight
  applies in the store's own market only.

### The date floor abroad (31 Oct 2026)

An order going abroad can't be for today whatever the store's own notice says:
the checkout offered "Today, 8 PM" for an SG→MY parcel in the staging pass, a
promise no courier keeps. `CROSS_BORDER_MIN_NOTICE_DAYS` (2, `convex/lib/crossBorder.ts`)
is folded into the same floor the store's and the cart's notice already share —
on the client (`overseasNoticeDays` in `checkout-form.tsx`, re-floored when the
Deliver-to switch flips) and at the order door (`orders.create`, pinned by a
test), so a stale tab can't bypass it. The buyer reads why under the date
("A parcel to Malaysia needs 2 days' notice"); the seller reads it on the
Overseas delivery page's "How overseas orders work". A store whose own notice is
already longer sees nothing change.

## Dispatch: which courier carries which order

`COURIER_DESTINATIONS` ([`convex/lib/courierProviders.ts`](../convex/lib/courierProviders.ts))
and `servesOrderDestination` judge each **order** by its address's country:

| Provider | MY store | SG store |
|---|---|---|
| Lalamove | domestic | domestic |
| Delyva | domestic | domestic (registry-closed anyway) |
| EasyParcel | **abroad only** | both |

- **EasyParcel on a MY store carries overseas orders only.** Delyva stays the MY
  domestic courier: it has cold chain, and it pays the 1% `source: "kedaipal"`
  commission. Frozen goods can't cross the border anyway, and the product opt-out
  covers them. The EasyParcel card is always visible on a MY store and
  connectable before the lane exists; **Deliver to Singapore** is a step in
  its setup list, linked to the overseas page.
- A provider that doesn't carry an order returns `destination_unsupported`. Its
  card hides on that order, like `country_unsupported` does.
- EasyParcel's quote and submit send the **real receiver country**. The receiver
  contact number is judged against the **destination** (`buyerContactPhone`), so
  an SG→MY parcel keeps the buyer's +60 number. The order card's "the courier
  gets your store's number" notice asks the same question through the same
  helper (`receiverCountryOf`), so it can't contradict the booking.
- With no integrated courier, the parcel ships through the existing manual
  courier + tracking number flow.

## Where an overseas address shows its country

`addressCountryLine` ([`convex/lib/address.ts`](../convex/lib/address.ts)) is
the one author. It prints the country only when the address is abroad, and not
when the city already says it ("048616 Singapore"). It's used by:

- the seller order page, which also shows an **Overseas · Singapore** chip
- the buyer's tracking page
- the buyer→seller WhatsApp message
- the despatch label, where the country is the last line, uppercased
  (pinned by `awb.test.ts`)
- the Deliveries destination column
- the CSV **Country** column

## Country switch

A switch **clears `crossBorderLanes`**. A lane points at the country that's now
home, its price is in the old currency, and it can't price the other
direction. It's the one exception to the 86eyqgujv "destroy nothing" rule. A
carried lane also leaked: a weight lane kept demanding product weights, and the
Delivery pricing page and the EasyParcel card read it as live or paused. Kept:
`products.domesticOnly` (it describes the product, not the country) and every
order's stamped address country (history). The EasyParcel pickup address
becomes a verifiable checklist row (`easyparcel_pickup`) rather than being wiped.

## Known gaps / follow-ups

- **EasyParcel live pricing on an SG store** can only be exercised with an SGD
  EasyParcel account: the MYR sandbox holds the lane as `wrong_currency`.
- The checkout quotes the dispatch card's DEFAULT service; a seller who books a
  pricier one absorbs the difference ("Buyer paid X" is shown beside every price).
- **Delyva international**: its API support is unconfirmed (Zaki is asking
  Delyva). Turning it on is one cell in `COURIER_DESTINATIONS` once support confirms.
- **EasyParcel SG sandbox**: the only sandbox available is the MY login's.
  SG→MY booking on an SGD account needs EasyParcel to set up an SG sandbox.
- Customs/duty: the buyer is told duty is theirs, collected by the courier.
  Kedaipal is never the importer of record. No HS code is sent (the field is optional).
- The product wizard doesn't ask the overseas question. A new product inherits
  the lane (goes abroad), and the editor's question is where it's changed.
