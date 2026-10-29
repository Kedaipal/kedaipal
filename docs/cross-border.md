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

`effectiveLanes` / `lanePause` decide at **read time** whether a stored lane is
taking orders. That way a downgrade or a pricing change pauses it everywhere at
once, without a settings write, and an upgrade brings it back untouched.

| Pause | Why | What the seller sees |
|---|---|---|
| `plan` | Not on Pro/Enterprise (`PLAN_FEATURES.crossBorder`) | Pro badge + Upgrade on the switch |
| `delivery_off` | `offerDelivery === false` | "Turn on delivery" link |
| `live_pricing` | Domestic pricing is a live courier quote (`live` / legacy `lalamove`) | "Change delivery pricing" shortcut |

Live courier pricing pauses the lane because the providers behind it are
domestic. Lalamove takes one `Market` per request. Delyva's API can't be shown to
price an international route: dev runs on its flat-rate demo account, and the docs
only show MY→MY. The Delivery pricing page warns **before** a seller saves live
pricing while a lane is stored.

A lane pointing at the store's own country (left behind by a country switch) is
filtered out of the live lanes. It stays stored and has no effect.

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

There is **no live courier quote** on a lane. EasyParcel prices at dispatch
only. Checkout's live quotes come from Lalamove/Delyva, which are domestic, so a
lane is always seller-priced. Pricing a buyer from EasyParcel at checkout would
be new work (and would need its own fallback).

## The doors

| Door | Rule |
|---|---|
| `retailers.updateSettings({ crossBorderLanes })` | Pro, delivery on, own pricing, not the store's own country; arming a weight lane runs `assertCatalogueWeighed`. `null` / `[]` always clears. |
| `delivery.quote({ country })` | Abroad: `no_lane`, `home_only` (the blocking products **named**), or the lane's fee. Domestic: unchanged. |
| `orders.create` | `deliveryAddress.country` ≠ store country → `crossBorderLaneForOrder` (live lane or refuse) → address judged against the **destination**'s format → every line must `shipsAbroad` (refusal names them; the order is **never split**) → priced by the lane. Every new order's address is stamped with its country. |
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
- **Storefront** (Zaki, 28 Oct): **every product is shown to everyone.** A visitor
  from a country the store delivers to sees **"Ships within Malaysia only"** on a
  product that can't go: as a card chip and on the product page
  (`HomeOnlyLabelProvider`). Nothing is hidden by geo. Geo-IP gets VPNs, carrier
  NAT and the Johor Bahru commuter wrong, a buyer in SG can order delivery to
  family in MY, and a shared link must show the same shelf to everyone.
- **/stores**: a store is listed in the other country's directory only while its
  lane is **live** and it has ≥1 visible product that can go. The card says
  **"Ships from Malaysia"** (`MarketplaceStoreCard.shipsFrom`). A paid highlight
  applies in the store's own market only.

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
  covers them. The EasyParcel card only appears on a MY store once a lane is saved.
- A provider that doesn't carry an order returns `destination_unsupported`. Its
  card hides on that order, like `country_unsupported` does.
- EasyParcel's quote and submit send the **real receiver country**. The receiver
  contact number is judged against the **destination** (`buyerContactPhone`), so
  an SG→MY parcel keeps the buyer's +60 number.
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
- the Deliveries destination column
- the CSV **Country** column

## Known gaps / follow-ups

- **Live courier quote on a lane** (EasyParcel at checkout) is unbuilt. Lanes are
  seller-priced.
- **Delyva international**: its API support is unconfirmed (Zaki is asking
  Delyva). Turning it on is one cell in `COURIER_DESTINATIONS` once support confirms.
- **EasyParcel SG sandbox**: the only sandbox available is the MY login's.
  SG→MY booking on an SGD account needs EasyParcel to set up an SG sandbox.
- Customs/duty: the buyer is told duty is theirs, collected by the courier.
  Kedaipal is never the importer of record. No HS code is sent (the field is optional).
- The product wizard doesn't ask the overseas question. A new product inherits
  the lane (goes abroad), and the editor's question is where it's changed.
