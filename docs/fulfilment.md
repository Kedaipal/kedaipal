# Fulfilment (Delivery + Self-Collect) — Implementation Reference

Reference doc for how buyers receive their orders. Kedaipal has **two symmetric, optional
fulfilment methods**: **delivery** (the buyer types an address; optionally charged — see
[Delivery charge](#delivery-charge--flat-fee--radius-bands-2026-07-16-clickup-86extzdr8)) and **pickup**
(a retailer-managed library of points the buyer collects from). Pickup points come in two
kinds — **self-collect** (the seller's place) and **drop-off** (an agreed meetup point); see
[Pickup grouping + drop-off points](#pickup-grouping--drop-off-points-2026-06-30-clickup-86ey30yhr).
A seller can offer delivery only, pickup only, or both — with one hard guarantee: **the
storefront always keeps at least one _working_ method.**

> The bulk of this doc (everything from "Self-collect pickup locations" onward) covers the
> self-collect subsystem, which shipped first. The section immediately below covers making
> **delivery optional** (ClickUp `86exu4grm`) and the cross-method invariant that ties the
> two together.

> **Related:** the **fulfilment date** captured at checkout (the buyer's "when do you need
> this?", applies to both methods) has its own reference: [`fulfilment-date.md`](./fulfilment-date.md).
> The `retailers.minFulfilmentNoticeDays` setting lives in the same Fulfilment settings tab.

## Delivery charge — flat fee + radius bands (2026-07-16, ClickUp `86extzdr8`)

Delivery was free by definition until this: `total === subtotal` for every delivery order,
which was **wrong** for any seller who charges postage/rider fees. A seller now picks a
**delivery-charge mode** in Settings → Fulfilment (inside the Delivery card):

- **Free** (default — unset config, zero behaviour change, no migration),
- **Flat** — one fee per delivery order + optional **free-above-subtotal threshold**
  (boundary inclusive: subtotal exactly == threshold → free). **All-tier** — a wrong
  total is a correctness bug, not an upsell.
- **Radius bands** *(Pro)* — distance bands from the seller's **business address**
  (e.g. 0–5 km RM5, 5–15 km RM15), priced by **straight-line (haversine) distance** to the
  buyer's address. Spec from the 15 Jul 2026 Sue (FM #3) + Arif comment: no Distance Matrix
  API — the buyer's coordinates already come free from the Google-autocomplete address
  capture at checkout, and the origin is geocoded once in Settings. The settings copy says
  "as the crow flies" so sellers pad bands for real roads. A band fee of RM0 = free inner
  zone. Beyond the last band the seller chooses per store: **block** the order, or
  **arrange** — accept it with the charge "to be arranged via WhatsApp" (the manual-close
  model), which lands the order **fee-pending** (below).

### Schema (additive, dev-only widen)

- `retailers.businessAddress` — `{ label, latitude, longitude, placeId? }`, captured via the
  shared `GoogleAddressAutocomplete` in Settings. **PRIVACY: owner-only** — many sellers run
  from home, so it's never in the public storefront payload; buyers only ever see the
  resolved fee. Can't be cleared while a radius config depends on it.
- `retailers.deliveryConfig` — discriminated union
  `{ mode: "flat", fee, freeAbove? } | { mode: "radius", bands: [{ maxKm, fee }], outOfRange: "block" | "arrange" }`.
  Validated by `sanitizeDeliveryConfig` (fees integer sen with the RM10k ceiling; flat fee
  must be > 0 — "free" has one spelling, a cleared config; bands sorted ascending, ≤10,
  duplicate bounds rejected).
- `orders.deliverySnapshot` — `{ fee, mode: "flat" | "radius" | "manual", distanceKm?, bandMaxKm? }`,
  **frozen at create** (pickupSnapshot posture: later config/address edits never rewrite a
  placed order); `distanceKm`/`bandMaxKm` audit the radius math (2dp). Order-level mirror
  `orders.deliveryFee` for cheap CSV/inbox/tracking reads. `0` never stored.
- `orders.deliveryFeePending` — the "arrange" hold (below).

### The buyer's address — the Google pin is the single source of truth

ClickUp `86eye50qv`. The delivery-address block used to show a Google search **and**
a parallel manual form — two competing address bars, where hand-editing a field after
picking a suggestion could leave the order priced for one place and addressed to
another. (The stale-pin half was closed first, by `86eyb5hrf`: editing a
location-bearing field clears the pin, so the quote falls back to "pick a suggestion"
instead of silently keeping the old coordinates.) The form now makes the drift
structurally impossible. `AddressFieldset` has two faces:

- **Locked** — a pin is set. Street/postcode/city/state collapse into a read-only
  **"Location confirmed"** card. Only **unit/floor** and **delivery notes** stay
  editable: neither can move the building. **"Wrong address? Search again"** clears
  the whole location (notes survive — they describe *how* to deliver, not *where*)
  and returns to the search. A restored `kedaipal:lastAddress` **with** a pin mounts
  straight into this state.
- **Searching** — no pin. The Google search is the only address input.

**Manual entry is an explicit escape hatch**, behind a "Can't find your address?"
disclosure, for addresses Google genuinely doesn't know (new tamans, kampung
addresses) — not an API-down detector. It auto-opens for a restored address that
never had a pin, so returning buyers still see their own data. The pin-invalidation
listeners stay on those fields as defence in depth.

**Store-mode split.** The hatch is hidden where a pin-less address is a dead end —
**live-quote (Lalamove)** and **radius + block** stores, which price from
coordinates and would refuse the order anyway. The checkout derives this from the
quote it already subscribes to: while the buyer has no pin, a store that answers
`blocked` is exactly a store that can't price a hand-typed address (flat / free /
radius-arrange answer `fee`/`free`/`pending` and keep the hatch). No extra server
field. The tracking-page `AddressEditDialog` passes `allowManualEntry={!isLiveMode}`
for the same reason — `liveSaveBlocked` already refuses a pin-less save there.

### Resolution — one pure function, three callers

`resolveDeliveryQuote({ config, subtotal, origin, destination })` in **`convex/lib/delivery.ts`**
(pure, unit-tested) returns `free | fee | pending | blocked` and is called by:

1. **`delivery.quote`** (public query) — the checkout page quotes live once the buyer picks
   an address suggestion, so the fee is visible **before** "Send order" (ticket AC).
   **Privacy: the public quote strips `distanceKm`/`bandMaxKm`** — returning raw distances to
   arbitrary probe coordinates would let a caller trilaterate the seller's home; band-coarse
   fees are the accepted exposure (any zone price list reveals as much). The **buyer's
   `orders.get(token)` path strips the whole `deliverySnapshot` for the same reason** (the
   buyer UI only reads the `deliveryFee`/`deliveryFeePending` mirrors); the authenticated
   seller/admin `shortId` path keeps the full snapshot for the order-detail km audit.
2. **`orders.create`** — the authoritative resolve + snapshot. The create result **echoes
   `deliveryFee`/`deliveryFeePending` back** so the client builds the `wa.me` message from
   the STORED numbers, never its preview.
3. **`orders.updateDeliveryAddress`** — the buyer's pending-only address edit **re-prices**
   (the surface `updatePickupLocation` taught us tickets miss): band change moves the fee,
   out-of-range flips to fee-pending, blocked destinations throw (old address + total stand).
   Customer `totalSpent` aggregates adjusted on every re-price.

Totals ride the `computeOrderTotals` extras seam — now `{ quotedAmount, pickupFee, deliveryFee }`,
independent additive charges; every recompute site (mockup submit/re-price/decline, pickup
switch) carries the delivery fee through. Fail-open rule: a radius config whose business
address somehow vanished resolves **free** (logged), never a blocked storefront.
`self_collect` orders never reach the resolver — pickup has its own per-location fee.
**Counter checkout untouched** (no delivery concept there).

### Fee-pending ("arrange via WhatsApp") — the second payment hold

An out-of-range (or coordinate-less) order on a **radius** "arrange" store lands with
`deliveryFeePending: true` and an **incomplete total**, so payment is held exactly like the
mockup gate. **Lalamove-priced stores never land here** (strict since 27 Jul — no live
quote means checkout/address-edit is refused, so the buyer always sees the real rider
price and the seller never calculates a charge; see
[`delivery-lalamove.md`](./delivery-lalamove.md)). The **why** is frozen alongside the
flag as `orders.deliveryFeePendingReason` (`out_of_range` | `no_coords` | `unquotable` —
the last only on legacy lalamove rows from before the strict rule), written at create +
the address re-price and cleared by `setDeliveryFee`; the seller card's explanation keys
on it, so it never claims "outside your delivery bands" when bands weren't the cause
(26 Jul hotfix; orders from before the field show a mode-neutral generic line).

- **WhatsApp confirm** sends `deliveryFeePendingConfirm` (EN+BM) — branded, no transfer
  reference / payment block / "I've paid" CTA. **This is the legacy free-form reply only**
  (a store with no confirmation template, answering an inbound `ORD-`). On the push path
  the order is stamped `confirmationPushStatus: "deferred"` and **nothing is sent yet** —
  the buyer's single message waits for the charge, and their order page tells them so.
- **`claimPayment` + `markPaymentReceived` reject** while pending (tracking page shows a
  disabled "Awaiting delivery charge"; order detail disables mark-received with reason).
  ~~The payment-reminder cron skips pending orders~~ — that cron no longer exists
  (`86eyd63r8`; see [`payment-reminder.md`](./payment-reminder.md)).
- The seller resolves it via **`orders.setDeliveryFee(orderId, fee)`** — an amber
  **"Delivery charge to confirm"** card on the order detail (with a one-tap "Discuss with
  buyer on WhatsApp" deep link). `fee: 0` = deliver free. Sets snapshot `mode: "manual"`,
  recomputes the total, clears the flag, and **releases the order's one WhatsApp message**
  via `claimDeferredPush` — the confirmation template, now carrying the charge and a true
  final total. (It used to schedule `notifyDeliveryFeeSet`, a separate held payment ask;
  that send is deleted — `86eyd63r8`.) Also usable pre-payment as typo insurance;
  **locked once payment is claimed/received**.
- **Double-hold ordering:** an order held by *both* the mockup quote and the delivery
  charge sends its one message when the **second** hold clears, whichever that is.
  This is no longer two send-sites each skipping while the other gate is shut — it is a
  single **transactional claim** (`claimDeferredPush`, `convex/orders.ts:391`) that flips
  `deferred → sending` only when no hold remains, so racing releases still send exactly
  once. See [`one-message-per-order.md`](./one-message-per-order.md#the-claim-mechanism).
- The seller learns about a pending charge three ways: the new-order/confirmed **email**
  gains a "Delivery charge to confirm" action line (EN+BM), the order-detail amber card, and
  the totals row ("To be set — see above").

### Pro gate (`radiusDelivery` in `PLAN_FEATURES`)

Setting a **radius** config is Pro+ (`assertPlanFeature` in `retailers.updateSettings`;
admin act-as bypasses). **Flat is all-tier** and **clearing any config is always allowed**
(chargeablePickup posture — downgrade never traps a seller charging fees they can't turn
off). A downgraded seller sitting on radius bands sees them read-only with a note + can
switch to Free/Flat.

### Surfaces (fee line everywhere the total appears, hidden when free)

Checkout footer breakdown (Subtotal / Delivery fee / Total, plus "FREE for this order size"
when a threshold earns it, "Confirmed by seller after checkout" + `Total … + delivery` when
pending, and a destructive "outside the delivery area" note + disabled submit when blocked);
the `wa.me` order message (fee line / "to be confirmed by seller", total from the create
result); WhatsApp confirm fee line (`renderDeliveryFeeLine`, EN+BM — sits where the pickup
block would); tracking page + seller order detail (detail annotates "— 7.4 km" or "— set by
you" from the snapshot); receipt/invoice PDF totals row (+ "Delivery charge: To be
confirmed" note on pending invoices); CSV export **"Delivery fee"** column (prints `0.00`
when free so `Subtotal + Pickup fee + Delivery fee = Total` sums).

### Tests

`convex/lib/delivery.test.ts` (haversine, band selection incl. the inclusive bound,
threshold boundary, fail-open, sanitizer), `orders.test.ts` ("orders — delivery charge":
create/flat/threshold/radius/block/arrange lifecycle, setDeliveryFee incl. the
payment-in-motion lock, address re-price, extras independence, authz),
`planGating.test.ts` (radius Pro gate, flat all-tier, clear-when-downgraded, admin bypass,
address↔config coupling), plus the paymentReminder + orderCsv + plans/subscriptions
feature-matrix additions.

### Parked / future

- **`weight_tiers` — SHIPPED as the weight/zone rate card** (Aug 2026, `86eyeea1n`) — the
  demand returned exactly as predicted (frozen sellers with national J&T demand); see the
  section below. `productVariants.parcelWeightG` is now load-bearing.
- **Provider-quoted shipping — SHIPPED for Lalamove** (Jul 2026, `86eyb5hrf`): exactly the
  predicted evolution — `deliveryConfig` gained a `mode: "lalamove"` arm +
  `deliverySnapshot.mode: "lalamove"`, same resolver, same totals seam. Live rider quote at
  checkout + one-tap dispatch + webhook auto-transitions; flat/radius stay for self-delivery
  and parcel-postage sellers. See [`docs/delivery-lalamove.md`](./delivery-lalamove.md).
- Sue's routing-accurate map integration stays parked until 3+ customers ask.

## Delivery charge — weight/zone courier rate card (2026-08-11, ClickUp `86eyeea1n`)

The fourth `deliveryConfig` pricing mode: the seller copies their **parcel courier's
published rate card** (J&T ambient, DD Cold Chain, Ninja Cold, Celsius…) into Kedaipal as
**zones of Malaysian states × ascending weight bands**, and checkout prices every order from
the buyer's address **state** and the cart's summed **variant parcel weight**. Built for the
frozen/outstation cohort (Lopes Viral JB + Wagyu Walid, both shipping ambient J&T with
polystyrene + ice — Lalamove is intra-city only, radius prices distance not courier zones).
**No courier API, no wallet, no booking** — dispatch stays manual and pairs with the manual
courier + tracking number flow (`86eyehvk4`, section below). **All-tier** (decided with Arif
11 Aug 2026): a pricing mode with zero provider cost is the correctness fix for outstation
sellers, exactly like flat; radius stays the Pro row.

### Shape (`convex/lib/delivery.ts`)

```
{ mode: "weight",
  zones: [{ name, states: MyState[], bands: [{ maxKg, fee }], freeAbove? }],
  onOutOfBands:  "block" | "arrange",   // state in no zone, or cart beyond the last band
  onUnpriceable: "block" | "arrange" }  // weight unknowable: missing weights / custom line
```

- **Zones partition states** — a state lives in at most ONE zone (`sanitizeDeliveryConfig`
  rejects overlaps; the settings chips make them unrepresentable). States in no zone are
  **unserved** (peninsular-only couriers exist) and follow `onOutOfBands`.
- **Bands mirror courier box tiers** ("up to 5 kg = RM30"; S 5 / M 10 / L 20). `maxKg` is
  1dp-sanitized and **inclusive**, compared in integer grams (`grams <= round(maxKg*1000)`)
  so 3.1 kg vs an up-to-3.1 band can't lose to float noise. Fee 0 = free band (radius
  precedent). Caps: `DELIVERY_ZONES_MAX` 8, `DELIVERY_BANDS_MAX` 10/zone, kg ≤ 1000.
- **Cart weight** = `summarizeCartWeight` over `{parcelWeightG, quantity, isCustom}` lines:
  Σ grams × qty, but **never a silent underweigh** — one custom/price-on-quote line →
  `custom_item` (weight unknowable by design), one weightless non-custom line →
  `missing_weights`; both resolve per `onUnpriceable`.
- **Per-zone `freeAbove`** (the marketplace-parity lever — "free shipping above RM150 to
  West MY", funded from the ~14% TikTok take a direct order escapes): checked after the zone
  match, **before** weight — the promise is deliberately unconditional, waiving the fee even
  for overweight/unweighable carts (settings copy says so). Never applies to unserved states.
- **No coordinates anywhere**: the state is already canonical on every delivery address
  (`assertValidAddress` enforces `MY_STATES`; Google picks normalize via `normalizeMyState`,
  manual entry has a state select) — so **manually-typed addresses price fine**, unlike
  radius/lalamove. The checkout's manual-entry escape hatch stays open for every weight-mode
  reason (`pinRequiredBlock` in checkout-form.tsx lists the pin-shaped reasons only).

### Resolution + order plumbing

Same one-resolver-three-callers seam as flat/radius: the public `delivery.quote` (args grew
`state?` + `items: [{variantId, quantity}]` — the server reads variant weights itself, so a
tampered client only mispriced its own preview; response still fee-only), `orders.create`
(weights collected in the existing variant-validation loop; authoritative), and
`updateDeliveryAddress` (re-weighs the order's frozen lines against live variant weights —
a state change can land in another zone's bands). Snapshot: `deliverySnapshot.mode:
"weight"` + audit `zoneName`/`chargeableKg` (gram precision)/`bandMaxKg`; buyer reads strip
it like the radius km audit. `DeliveryQuoteReason` gained `no_state` (quote-preview before
an address; reaches an order only via address-less protocol callers), `unserved_state`,
`over_bands`, `missing_weights`, `custom_item` — all stored on `deliveryFeePendingReason`
with cause-true copy on the seller's fee-pending card (missing_weights names the fix: set
weights in Products) and per-reason blocked copy at checkout (an overweight cart never
tells the buyer to "fix" a good address).

### Seller UX

Settings → Fulfilment → Delivery charge gains the **"By weight & zone"** card: zone cards
(name, MY_STATES membership chips — claimed states grey out with a visible legend, no
hover-only tooltip), band rows ("Up to _ kg → RM _"), per-zone free-above, an **uncovered
states** summary line that phrases the consequence per `onOutOfBands`, two block/arrange
radio groups (out-of-card vs can't-weigh), and a **"Use the J&T template"** seeder
(`src/lib/weight-zone-seed.ts`: West/East MY pre-filled from J&T's published ambient rates,
Aug 2026, seeded slightly ABOVE the public card so an unedited template never undercharges;
a test pins that the template survives the sanitizer byte-identical). Volumetric weight is
explicitly out of scope; the helper copy says to pick the safer band.

**Parcel weight got a real UI** (it was CSV-import-only before this): `VariantRow` carries
`parcelWeightG`, editable per choice under the product editor's **Advanced** disclosure —
and on weight-mode stores (`ProductForm.weightMode`, from the dashboard retailer's
`deliveryConfig.mode`) it's **promoted to its own "Parcel weight" block** above Advanced,
since a missed weight strands checkout on `missing_weights`. Blank = 0 = unset, submitted
explicitly (never `undefined`, which would hit `saveVariantGrid`'s preserve-on-update
path); new grid combos inherit row 0's weight. The wizard stays weight-free by design
(create-only; sellers set weights on edit or via the import sheet's `weight_grams`).

### Tests

`convex/lib/delivery.test.ts` (resolver: zone match, gram-exact inclusive bounds,
over/unserved/no-state/missing/custom holds, unconditional threshold, zero-fee band;
sanitizer: partition/dedupe/caps/rounding; `summarizeCartWeight`), `convex/orders.test.ts`
("orders — weight/zone delivery charge": coordless create + audit snapshot + buyer strip,
arrange holds w/ frozen reasons, block messages, custom-line hold, freeAbove boundary,
re-zone address re-price, public quote incl. garbage-state → `no_state`),
`convex/planGating.test.ts` (weight saves on Starter — pins the all-tier call),
`src/lib/weight-zone-seed.test.ts` (template partition/ascending/sanitizer-stable).

### Deliberately out of scope (v1)

- **Local rider layer** (radius-style bands inside the Lalamove zone + zone×weight beyond
  it — the ticket's layered revision): follow-up PR after this lands; gating it Pro
  (`radiusDelivery`) keeps the radius gate honest, since the local layer IS radius pricing.
- EasyParcel booking/AWB = phase 2 (`86eyehvnj`), volumetric weight, live courier rates.

## Manual courier + tracking number on shipped (2026-07-29, ClickUp `86eyehvk4`)

Sellers shipping outstation via parcel couriers (J&T ambient, DD Cold Chain, Ninja Cold,
Celsius) book the courier **themselves** and get a consignment number — this feature lets
them attach it when marking shipped, so the buyer gets TikTok-style tracking through the
existing WhatsApp update + tracking-page pipeline. No booking, no courier API, no status
polling (EasyParcel integration is the separate phase-2 card). Driver: Haziq (Lopes Viral
JB) + Wagyu Walid, 28 Jul.

> The courier name + consignment number captured here are what the printed **despatch
> label** carries (as text and as a Code 128 barcode) — see
> [`despatch-labels.md`](./despatch-labels.md). That label is Kedaipal's own, never a
> courier-issued AWB; an order with no consignment number yet still prints, just without
> the barcode row.

### Data model

Two new optional order fields beside the pre-existing `orders.carrierTrackingUrl`:
`orders.courierName` + `orders.trackingNo` (dev-only widen, no backfill — absent on old
orders). `carrierTrackingUrl` stays the **single resolved-link surface**: auto-derived
from courier + number for registry couriers, hand-pasted for "Other", or mirrored from a
Lalamove job's `shareLink` — every pre-existing link surface (WA shipped copy, track-page
CTA) keeps working unchanged. The ticket's `deliverySnapshot` suggestion was wrong — that
object is the frozen create-time **pricing** snapshot; courier info is fulfilment-time
data and lives at order level like the URL it feeds.

### Courier registry — `convex/lib/couriers.ts`

Pure module (no Convex imports) imported by BOTH the backend and the dashboard picklist.
Registry couriers with best-effort tracking deep links (J&T Express, Pos Malaysia, Ninja
Van, SPX Express, Flash Express, City-Link Express) + name-only cold-chain entries
(Celsius Express, DD Express, Ninja Cold — no public URL pattern; the ICP's carriers get
one-tap picks, not "Other" typing). `resolveShipmentFields` is the one shared
trim/cap/URL-derivation resolver used by every write path: an explicitly pasted URL wins
over derivation; all-blank input resolves to all-cleared. A stale deep-link pattern only
costs the buyer a landing on the courier's tracking form — the number is always shown
copyable beside the link.

**URL scheme is enforced (PR #151 review).** A pasted link only survives if it's
`http(s)` — the tracking page renders it in a buyer-facing `<a href>`, where a
`javascript:`/`data:` URL would execute on click (a seller attacking their own customer,
but cheap to close now that one resolver owns every write). A scheme-less paste
(`tracking.example/123`) gets `https://` rather than being silently dropped; any other
scheme is refused, which can fall through to the derived link. `isSafeTrackingUrl` is
exported and also called at **both render sites** (buyer track page + seller card), so
rows written before this sanitize existed — the old `setCarrierTrackingUrl` accepted any
string — are neutralised on the way out instead of needing a backfill. Lalamove's
`shareLink` writes its own provider-generated https URL directly and is untouched.

**Shipment tracking is delivery-only.** Courier fields are ignored (not fatal) on a
self-collect `shipped` transition — moving the status is that path's real job — while
`setShipmentTracking` **refuses to set** on a self-collect order and **always allows the
all-blank clear**, so an order that changed fulfilment method can never be trapped
holding tracking it shouldn't have (the set-gated/clear-un-gated posture used for
chargeable pickup).

### Write paths

- **`updateStatus` / `advanceToStage`** accept `courierName`/`trackingNo` (+ the existing
  `carrierTrackingUrl`) on shipped(-anchored) transitions only; ignored otherwise.
- **`setShipmentTracking`** (replaces `setCarrierTrackingUrl`) — set/clear any time from
  the order-detail card; sellers often receive the slip after marking shipped.
- Lalamove webhook path untouched (patches `carrierTrackingUrl` directly from
  `shareLink`; a rider order never opens the manual prompt — the advance button is
  disabled under rider auto-updates).

### Seller UX

- **Mark-shipped prompt** (`MarkShippedDialog` in
  `src/components/order/shipment-tracking.tsx`): tapping the advance button into a
  shipped-anchored stage on a **delivery** order with no tracking attached opens an
  optional courier-picklist + tracking-number dialog (skippable via Cancel→the card;
  confirming with "No courier" ships without tracking). The last-used courier is
  remembered per device (`localStorage`) since sellers ship with one courier. Helper
  line states exactly what the buyer gets (auto link vs copyable number vs nothing) —
  no hidden behavior. **"No courier" collapses the form** (number/link inputs hide, and
  `draftToFields` treats the state as an explicit clear so hidden leftovers never save).
- **Manual courier is for parcel sellers only** (ClickUp `86eyff02p`, corrects the
  two-tab prompt this feature first shipped with). The gate is
  **`getDeliveryJob.bookingEnabled`** = `retailers.deliveryBooking.enabled` — Settings
  couples it 1:1 with the Lalamove delivery-charge choice (picking Lalamove enables
  booking, switching to Free/Flat/Radius disables it), so it answers the seller-facing
  question "do I send riders or parcels?". It is deliberately **not**
  `deliveryConfig.mode`: booking-enabled is what every other dispatch guard already
  keys on, and it's the behavioural truth. A rider vendor gets **no courier picklist
  anywhere** — the prompt is rider-only and the card below goes read-only. The
  suppressions from Zaki's 29–30 Jul test pass still hold: the prompt never opens on an
  order with tracking attached or an **active rider booking** (belt-and-braces —
  booking mirrors its `shareLink` onto `carrierTrackingUrl`, which suppresses it
  anyway), and webhook-driven orders never get there at all (the advance button is
  disabled under rider auto-updates).
  - **Rider bookable now** (`blockReason === null`): **this prompt never opens.** The
    advance button bumps `bookRequestToken` directly and the seller lands in
    `BookDeliveryCard`'s **own** quote→confirm dialog — the same one prompt-on-packed
    opens, with today's live price, the Motorcycle/Car switch, the variance against
    what the buyer paid and the scheduled-vs-now line. The first cut put a
    `Book a rider` CTA in an intermediate prompt in front of it; that was pure chrome
    for a rider vendor (revised 4 Aug), and a second booking CTA is a competing door
    onto the same spend. Both entrances still run the same bookability guards
    (bookable status, keys ok, no active job, never a collection order).
    - The booking modal then carries the **`advanceWithoutRider`** action — a quiet
      (`variant="link"`) `Mark as {stage} without a rider` in its footer — because
      dismissing the modal would otherwise leave an order the seller is dropping off
      themselves exactly where it was. It renders **only on this path**: the card
      tracks whether the quote flow started from an advance (`fromAdvance`), so the
      packed prompt and the card's own button stay a plain book-or-not rather than
      smuggling a status change into a spend confirmation.
    - If the quote itself fails (out of service area, provider down) there's no modal
      to show, so `onAdvanceBookUnavailable` hands the seller back to this prompt —
      a tap that produced nothing but a toast would be a dead end.
  - **Rider not bookable** (plan downgrade, keys cleared, missing phone, legacy
    address with no map pin): the prompt says so in the seller's words via the shared
    `dispatchBlockCopy` (moved out of `book-delivery-card.tsx` into
    `src/lib/dispatch-block.ts` so the card and the prompt can't drift — a
    `Record<DispatchBlock, string>`, so a new block reason is a compile error, not a
    silent fallback), names the fix path, and offers the choice the owner asked for —
    Cancel to go fix it, or `Mark as {stage} anyway` for an order going out another
    way. Never a silent advance, and still no courier picklist **in the prompt**: the
    copy points at the Shipment tracking card below, which is where an add-later
    consignment number has always belonged and which stays editable in exactly this
    state (see the card bullet).
  - **Server stays permissive** (deliberate): `advanceToStage` / `setShipmentTracking`
    still accept courier fields from a rider vendor. Nothing is at risk if they arrive,
    a hard reject would fight the Lalamove webhook that writes `carrierTrackingUrl`
    itself, and it would trap an order whose vendor switched delivery mode after
    shipping. This is a UI-shape rule, not a security boundary.
- **"Shipment tracking" card** on order detail (upgrade of the old URL-only "Carrier
  Tracking" card): shows courier + mono tracking number with one-tap copy + "Track with
  courier" link; edit mode reuses the same fieldset ("Other" adds free-text name +
  optional pasted link). Legacy URL-only rows (incl. Lalamove links) still render.
  The card is `readOnly` while **a rider is actually handling the delivery** —
  `lalamoveVendor && (blockReason === null || hasActiveRiderBooking)`: it still shows
  what the buyer sees (the number/link a booking mirrored onto the order, copyable) but
  drops Add/Edit, and renders **nothing at all** while no tracking is attached, since
  dispatch for them lives in the Lalamove Delivery card above.
  **Deliberately not keyed on vendor type alone** (PR #154 review): nothing clears
  `deliveryBooking.enabled` on a Pro→Starter downgrade, `PLAN_FEATURES.delivery` gates
  only *enabling*, and the Lalamove checkout quote is all-tier — so a downgraded store
  keeps taking rider-priced orders with `blockReason` permanently `plan_gated`. Since
  `setShipmentTracking` has no other caller in `src/`, a vendor-type gate would leave
  that store with **no way to record a consignment number anywhere**, silently and
  store-wide. Same shape per-order for `no_coords` (legacy pinless address) and
  `no_buyer_phone` (anonymous counter order). The "a rider vendor never picks a
  courier" thesis holds while a rider is on the table; the moment the product says it
  can't book one, the parcel that went out instead still needs its number — the
  downgrade-never-traps-the-seller line `chargeablePickup`/`categories`/`radiusDelivery`
  already hold.

### Buyer surfaces — the order page, and only the order page

Meta bills every outbound message from 1 Oct 2026, so this feature shipped with
**zero new sends** (owner call, 29 Jul): tracking entered at mark-shipped rode the
shipped WhatsApp update that was already going out. **That update no longer exists**
([`86eyd63r8`](https://app.clickup.com/t/86eyd63r8), 4 Aug) — an order sends the buyer
exactly one message, the confirmation — so the feature's delivery channel is now
uniform and simple: **courier + tracking number always land on the buyer's order page,
whenever they're entered, and nothing is ever sent.**

That deleted the `📦 {courier} — tracking no. {number}` line along with the copy it rode
in: the `status` catalog in `whatsappCopy.ts`, `renderStageUpdate`, and the
`{courierName}`/`{trackingNo}` template placeholders are gone with the per-status
templates themselves. **Nothing about the feature's value changed** — the ticket's whole
point was TikTok-style tracking the buyer can follow, and `/track/<token>` was already
carrying it: a courier + number card with one-tap copy (works for cold-chain couriers with
no link) above the "Track with carrier" CTA, updating live. The at-ship and after-ship
paths simply collapsed into one behaviour instead of two.

**The seller is told, at both entry points** (this was a real behaviour change, so it is
not left to inference): the mark-shipped prompt's helper line and the Shipment tracking
card both state that the number appears on the buyer's order page — *"The buyer's order
page gets a {courier} tracking link automatically"* / *"…has no public tracking page — the
buyer's order page shows the number to copy instead."* No resend button, because there is
nothing to resend.

CSV export gains "Courier" + "Tracking no" columns beside Fulfilment (unchanged).

Tests: `convex/lib/couriers.test.ts` (the registry + `resolveShipmentFields` — the
part that survived), end-to-end transition/set/clear/auth cases in
`convex/orders.test.ts` ("86eyehvk4" describe), CSV columns in
`convex/lib/orderCsv.test.ts`. Rider-vendor prompt shapes + the read-only card in
`src/components/order/shipment-tracking.test.tsx`, block copy in
`src/lib/dispatch-block.test.ts`.

## Chargeable pickup location — flat per-location fee (2026-07-07, ClickUp `86ey5tywf`)

A seller can attach an **optional flat fee** (minor units / sen) to any pickup location —
Bearcamp's paid tent drop-off point was the driver; generalises to any host-stall charge or
collection-run cost. Unset (or 0) = free; every legacy row reads as free, no backfill.

- **Schema (additive, dev-only widen):** `pickupLocations.fee`, `orders.pickupSnapshot.fee`
  (frozen at create — a later fee edit/deactivate never rewrites a placed order's total), and
  the order-level mirror `orders.pickupFee` (same frozen number, cheap CSV/inbox reads
  without unpacking the snapshot). `0` is normalized to *unset* at every write so "free" has
  exactly one spelling.
- **Totals seam:** `computeOrderTotals(items, extras)` in `convex/lib/order.ts` now takes
  `{ quotedAmount, pickupFee }` — the mockup quote and the pickup fee are independent
  additive extras (`total = subtotal + quote + fee`). Every recompute site passes the extras
  it must keep: `submitMockup`, `updateMockupQuote`, `declineMockupItem` (fee survives — the
  buyer still collects the remainder at the paid point) and **`updatePickupLocation`** (the
  ticket-missed surface: switching point while pending re-prices — paid→free drops the fee,
  free→paid adds it, customer `totalSpent` aggregates adjusted).
- **Validation:** `sanitizeFee` in `convex/pickupLocations.ts` — integer sen, ≥ 0, ceiling
  `PICKUP_FEE_MAX` (RM10,000; mirrors the mockup-quote guard, an order of magnitude tighter).
- **Pro gate (`chargeablePickup` in `PLAN_FEATURES`):** *setting* a non-zero fee on
  create/update requires Pro+ (`assertPlanFeature`; admin act-as bypasses). **Clearing is
  always allowed** — a downgraded seller is never trapped with a fee they can't remove — and
  a frozen fee on an existing order displays on every tier (it's inherent to the order).
  Starter sellers see the fee input disabled-with-reason + Pro chip in the edit dialog; when
  the locked point *already carries* a fee, the dialog surfaces a self-serve **"Remove fee"**
  control (stages `fee: null`, applied on Save, reversible via "Keep fee") so the un-gated
  server clear is actually reachable — no "contact us" dead-end.
- **Surfaces (fee line everywhere the total appears, hidden when free):** storefront picker
  chip ("+ RM5.00 fee") + checkout footer breakdown (Subtotal / Pickup fee / Total) + the
  `wa.me` order message; tracking page + seller order detail ("Pickup fee — <label>");
  WhatsApp pickup block (`renderPickupBlock` fee line, EN+BM, needs `currency` threaded);
  receipt/invoice PDF labelled totals row; CSV export "Pickup fee" column (prints `0.00`
  when free so Subtotal + Pickup fee = Total always sums). Payment reminder + all payment
  asks read `order.total`, so they're fee-inclusive automatically.
- **Counter checkout: intentionally NO fee.** Counter orders have no pickup location at all
  (hardcoded `self_collect`, no snapshot) — a walk-in at the counter incurs no collection
  cost. Confirmed with Arif 2026-07-07 (the ticket's AC #8 assumed a counter location picker
  that doesn't exist). "Counter order fulfilled at a paid drop-off later" would be its own
  feature.

## Pickup grouping + drop-off points (2026-06-30, ClickUp `86ey30yhr`)

Buyers receive an order one of two ways: **Delivery** (we come to you) or **Pickup** (you
collect at a point). **Pickup is an umbrella** over two *location kinds*:

- **Self-collect** — the seller's own place (shop, home, warehouse).
- **Drop-off** — an agreed meetup/common point (pasar, surau, LRT station), usually at a
  recurring time.

The key information-architecture call: **drop-off is a _kind of pickup location_, not a
third `deliveryMethod`.** From the buyer's POV self-collect and drop-off are the same action
(go to a labelled point at a set time and collect), so they share the *entire* pickup
subsystem — the location library, the [working-method invariant](#the-invariant), the buyer
picker, the snapshot. Only a badge, a grouping heading and a schedule field differ.

### What this added

- **Schema (additive, no migration):** `pickupLocations.locationType`
  (`"self_collect" | "drop_off"`, `undefined → "self_collect"`) + `pickupLocations.scheduleNote`
  (≤120 char free text). Both also **frozen onto `orders.pickupSnapshot`** so a re-tag or
  schedule edit never rewrites a placed order. `orders.deliveryMethod` is **unchanged**
  (`"delivery" | "self_collect"`) — `"self_collect"` is the internal name for "pickup"; the
  kind distinction rides on the snapshot. `retailers.offerSelfCollect` likewise keeps its
  data name but the settings card is labelled **"Pickup"**.
- **Snapshot freeze** happens at **both** write sites via `buildPickupSnapshot()` in
  `convex/orders.ts`: `orders.create` *and* the buyer's `orders.updatePickupLocation`.
- **Settings → Fulfilment:** the old Self-collect toggle card + Pickup-locations card are
  merged into **one "Pickup" card** (toggle over the locations list); each row shows a kind
  badge ("Self-collect" / "Drop-off") + its schedule note. The edit dialog leads with a kind
  selector and reveals a "When are you there?" field for drop-off.
- **Storefront:** the top-level picker shows **Delivery / Pickup**. Inside the Pickup form,
  points are grouped under **Self-collect** / **Drop-off** sub-headings — but **only when
  both kinds exist**; a single-kind seller (the legacy 100%-self-collect case) sees a flat
  list, identical to before. The chosen point's `scheduleNote` is surfaced **at the date
  picker step** (advisory, no hard date constraint — decision locked with the CTO) so the
  buyer picks a sensible day for a recurring meetup.
- **Render surfaces:** the WhatsApp confirm (`renderPickupBlock`, kind-aware header +
  `🗓️ scheduleNote`), the seller new-order/confirmed email (kind-aware `Method:` label +
  point/schedule/maps block), and `/track/<token>` ("Meet at" vs "Pick up at" + kind badge +
  schedule note) all carry the kind + note.

### Kind-aware copy sweep (2026-07-03, ClickUp `86ey570am` — bug fix)

The first live drop-off test (Bearcamp) surfaced surfaces that still said
"collect"/"pickup" for drop-off orders. All copy now branches on the frozen
`pickupSnapshot.locationType` (legacy `undefined` → self-collect, as everywhere):

- **Checkout date step** (`checkout-form.tsx`): label "When should we meet?" +
  helper "Pick the date you'll meet at the drop-off point." (was "When will you
  collect?" for both kinds).
- **WhatsApp status copy** (`convex/lib/whatsappCopy.ts`, EN + MS): `CopyVars`
  gained `pickupKind`, and the `packed` / `shipped` / `delivered` copy branched on
  it. **Those status messages were deleted in `86eyd63r8`** (an order sends one
  message), taking the drop-off wording with them; `pickupKind` survives on
  `CopyVars` for the copy that remains — the `confirm` reply ("ready at the
  drop-off point") and the pickup block. `getOrderWithRetailer` still returns the
  snapshot's kind so the confirm compose can pass it. The drop-off vocabulary
  the buyer now reads at every other step lives on their order page (next bullet),
  which was always the richer surface for it.
- **Tracking page + seller order detail**: fulfilment chip "Drop-off" (was
  "Self Collect"), date label "Meet on" (was "Collect on"), and the seller
  card's "Pick up at" heading → "Meet at" (matching the buyer page).

### Vocabulary (one language, both sides)

"Self-collect" / "Drop-off" everywhere — seller settings badge **and** buyer sub-headings.
(The ticket's "My place" / "Meetup point" wording was dropped to avoid two vocabularies for
the same two kinds.) `minFulfilmentNoticeDays` stays its **own** settings card (it governs
both methods), not folded into the Delivery card.

### Edge cases covered

- Legacy rows / snapshots with `locationType` undefined render as **Self-collect** (no blank
  badge) — `?? "self_collect"` at every read.
- A seller with **only drop-off** points is still "working" — the invariant counts *any*
  active pickup location regardless of kind (no special-casing of self-collect).
- The snapshot is frozen at create, so a stale storefront tab whose point's kind changed
  after load is safe.
- `scheduleNote` is free text → escaped on render, line-clamped on storefront + tracking.

## Optional delivery + the working-method invariant (2026-06-23)

Originally delivery was implicitly always-on and self-collect was the only opt-in method
(`retailers.offerSelfCollect`). Delivery is now a first-class toggle
(`retailers.offerDelivery`), so the two methods are symmetric.

### The invariant

A storefront must always keep **≥1 _working_ fulfilment method**. "Working" ≠ "toggled on":

- **Delivery works** when `offerDelivery` (effective) is on.
- **Self-collect works** when `offerSelfCollect` (effective) is on **AND** the retailer has
  **≥1 active pickup location**.

Three actions are rejected when they would leave zero working methods:

1. Turning **delivery off** with no active pickup location → *"Add an active pickup location
   before switching to pickup-only…"*
2. Turning **self-collect off** while delivery is also off → blocked.
3. **Deactivating the last active pickup location** while delivery is off → blocked.

Enforced **server-side** (the source of truth) in `retailers.updateSettings` and
`pickupLocations.setActive`, mirrored in the **Fulfilment settings UI** as a
disabled-toggle-with-reason, and defended a third time on the **storefront checkout** (a
*"not accepting orders right now"* state instead of an empty picker). `orders.create` also
rejects a `delivery` order when the retailer doesn't offer delivery, closing the
stale-storefront-tab gap.

### Default asymmetry (the one subtle bit)

| Field | New-retailer default | Legacy row (`undefined`) effective | Why |
|---|---|---|---|
| `offerSelfCollect` | `true` | `false` | Opt-in; legacy rows never had it. |
| `offerDelivery` | `true` | **`true`** | Every pre-existing retailer always had delivery — `undefined` must read as on or every live storefront breaks. No migration. |

Effective reads everywhere: `offerDelivery ?? true`, `offerSelfCollect ?? false`.

### Surfaces

- **Settings → Fulfilment** (renamed from "Pickup"; `?tab=pickup` deep-links redirect):
  Delivery toggle card + Self-collect toggle card (both wired to the invariant) above the
  pickup-locations list. Component: `src/components/settings/fulfilment-tab.tsx`.
- **Storefront checkout** (`checkout-form.tsx`): drills `offerDelivery` through
  `$slug.tsx` → `cart-bar.tsx`. Shows the two-button method picker only when **both** are
  offered; a single method drops straight to its form (address / pickup picker).
- **Dashboard checklist** (`app.index.tsx`): the optional "Add a pickup location" step
  became **"Set up delivery & pickup,"** shown to *every* retailer (so a delivery-only
  seller discovers pickup-only is possible). Done = `pickupSetupSeen || hasPickupLocation`.
- **Tests:** `retailers.test.ts` (default + the four invariant transitions),
  `pickupLocations.test.ts` (`setActive` last-location guard),
  `orders.test.ts` (delivery-off rejection + legacy pass-through).

---

## Self-collect pickup locations

Reference for the multi-location self-collect feature. **Backend + dashboard + storefront + tracking UI + Google Places autocomplete + WhatsApp location pin shipped.** This section documents what exists, why it was built this way, and what depends on it next.

## Context (2026-05-29)

Self-collect is a real F&B home-seller pattern (cake collection, kuih, frozen-supplier pickup), and a Founding-10 frozen supplier asked for it by name. Before this:

- `orders.deliveryMethod` already supported `"self_collect"` (since the original schema), but **no pickup address was ever captured on the order**.
- Buyers received the confirmation message with no collection details, forcing a back-and-forth in WhatsApp chat that recreates the #1 universal pain ("order info buried in chat").

A retailer-managed library of pickup locations + a buyer-side picker + an inline pickup block on the confirm message closes the loop and unblocks the supplier demo.

## What got built

### Schema

New `pickupLocations` table — retailer-managed library, soft-deleted (never hard-deleted) so historical order snapshots remain meaningful:

```
pickupLocations: {
  retailerId,
  label,            // 1–60 chars
  address,          // 3–500 chars (Google formattedAddress when autocomplete used)
  mapsUrl?,         // legacy fallback; strict Waze + Google Maps allowlist, ≤500 chars
  notes?,           // ≤200 chars
  latitude?,        // captured from Google Places autocomplete
  longitude?,       // — both written together or not at all
  placeId?,         // Google's stable place identifier
  isActive,         // soft-delete flag
  sortOrder,        // ascending; drag-and-drop reorder writes 0..N-1
  createdAt, updatedAt,
}
```

Indexes: `by_retailer`, `by_retailer_active`.

`orders` table gained pickup + delivery coordinate fields:

```
pickupLocationId?:  v.id("pickupLocations"),
pickupSnapshot?:    { label, address, mapsUrl?, notes?, latitude?, longitude?, placeId? },
deliveryAddress?:   { line1, line2?, city, state, postcode, notes?, mapsUrl?, latitude?, longitude?, placeId? },
```

Both `pickupSnapshot` and `deliveryAddress` carry `placeId` so derived maps URLs deep-link to the named Google place page (clean, "Eco Majestic" in the search bar) instead of falling back to raw lat/lng search. `placeId` is captured by Google Places autocomplete on both the seller-side pickup form AND the buyer-side delivery form, then frozen onto the order at create time.

The pickup snapshot (and the buyer's chosen `deliveryAddress`) is **frozen at order create / `updatePickupLocation`** and never mutated afterwards — editing the source location does not rewrite history.

`retailers` table gained two fields:

- `offerSelfCollect?: v.optional(v.boolean())` — the explicit toggle that gates the storefront, checkout invariants, and dashboard checklist visibility. **New retailers default to `true`** (set in `createRetailer`) so the Pickup checklist step is discoverable during onboarding. Pre-existing rows stay undefined and are treated as `false` — no migration, no surprise nag.
- `pickupSetupSeen?: v.optional(v.boolean())` — set the first time the seller opens the Pickup settings tab. Drives checklist step-4 dismissal so a seller who deliberately skips self-collect isn't nagged. See **Visibility gating** below.

### Files

| Path | Purpose |
|---|---|
| `convex/google.ts` | Server-side proxy for Google Places API (New). `autocompleteAddress` + `getPlaceDetails` actions. API key (`GOOGLE_MAPS_API_KEY`) never reaches the browser; results scoped to `includedRegionCodes: ["my"]`; session-token billing pattern; field mask locked to Essentials tier. Rate-limited via `googleAutocomplete` (30/min) and `googlePlaceDetails` (10/min) buckets, keyed by Clerk subject (settings caller) or `retailerId` (storefront). |
| `convex/google.test.ts` | 10 tests — short-input no-op, payload normalization, header/body/region forwarding, error handling (403/404/missing key/missing rate key/missing coordinates). Stubs `globalThis.fetch` to assert exact wire payloads. |
| `convex/lib/mapsUrl.ts` | Pure shared validator — `assertValidMapsUrl`, `isValidMapsUrl`, `ALLOWED_MAPS_HOSTS` (no Convex imports). Also the canonical maps-URL builders, importable from Convex + client: `deriveMapsUrl` (single link: `mapsUrl` → `placeId` → lat/lng) for the WhatsApp confirm + single-link callsites, and `googleMapsNavUrl` / `wazeNavUrl` for the buyer's two-button pickup nav (`PickupNavButtons`). **Google** opens on the named place via `placeId` (`…/maps/place/?q=place_id:…`) — clean on web + mobile. **Waze** has **no web named-place URL** we can build (a named destination needs a Waze venue id `to=place.<id>`, not derivable from a Google `placeId`), so `wazeNavUrl` sends both `q=<label, address>` (the Waze **mobile app** searches this → can show the name) and `ll=<lat>,<lng>` (keeps the pin exact; on desktop web Waze rewrites it to `to=ll.…` → correct pin, coords label, `q` ignored there). Falls back to coords-only nav when no query. |
| `src/lib/google-address.ts` | Pure client helpers — `parseGoogleAddress` maps Google `addressComponents` into our `{ line1, city, state, postcode }` shape; `normalizeMyState` resolves Federal Territory variants ("Wilayah Persekutuan Kuala Lumpur" → "WP Kuala Lumpur") and alternate spellings ("Penang" → "Pulau Pinang", "Malacca" → "Melaka") into our `MY_STATES` enum. |
| `src/lib/google-address.test.ts` | 10 tests covering both helpers — Federal Territory variants, alt spellings, case-insensitive matching, named-building line1 fallback, `postal_town` fall-through, unknown-state graceful empty. |
| `src/components/forms/google-address-autocomplete.tsx` | Reusable combobox shared by the pickup-settings dialog and the buyer-checkout `AddressFieldset`. Debounced (300ms), session-token managed internally, keyboard/mouse navigation, loading/error/no-results/escape states. Public storefront callers pass `retailerId` for rate-limit scoping; authenticated callers omit it (action falls back to Clerk subject). |
| `convex/pickupLocations.ts` | Queries (`listForRetailer`, `listActivePublicBySlug` — surfaces lat/lng for the storefront picker, `hasAnyActive`), mutations (`create`, `update`, `setActive`, `reorder`). `create`/`update` accept `latitude`/`longitude`/`placeId`; `update` accepts `null` for those fields to explicitly clear coords. `sanitizeCoords` enforces WGS84 ranges; lat/lng are all-or-nothing (silently dropped when only one is provided). |
| `convex/pickupLocations.test.ts` | 26 integration tests — CRUD, soft-delete/restore, bulk `reorder`, tenant isolation, `hasAnyActive`, and the Google-autocomplete field group (create stores coords, range rejection, all-or-nothing drop, `update` with null clears, public listing surfaces coords, order snapshot freeze including coords). |
| `convex/orders.ts` | `create` extended with the pickup invariants; new `updatePickupLocation` mutation (pending-only, mirrors `updateDeliveryAddress`). |
| `convex/orders.test.ts` | +10 tests — strict-branch enforcement, snapshot freeze, inactive/foreign-tenant id rejection, legacy zero-info path preservation, full `updatePickupLocation` lifecycle. |
| `convex/retailers.ts` | `updateSettings` accepts `offerSelfCollect`; `createRetailer` defaults it to `true`. Idempotent `markPickupSetupSeen` mutation called from the Pickup tab on mount. `RetailerPublic` surfaces `offerSelfCollect` everywhere and `pickupSetupSeen` on `getMyRetailer` only. |
| `convex/retailers.test.ts` | +6 tests covering the default-true behaviour and `markPickupSetupSeen` (auth, missing retailer, first-call patch, idempotency, per-user scoping). |
| `convex/lib/whatsappCopy.ts` | `PickupSnapshot` type now carries optional `latitude`/`longitude`. `renderPickupBlock` **suppresses the inline `mapsUrl`** when lat/lng are set — the WhatsApp location pin sent as a follow-up replaces the inline URL, keeping the confirm text clean. Legacy snapshots without coords still get the URL inline. |
| `convex/lib/whatsapp.ts` | New `sendLocation(toPhone, lat, lng, name, address)` calling Meta's `/messages` endpoint with `type: "location"`. Stringifies lat/lng per Meta's spec. |
| `convex/lib/channels/types.ts` | `OutboundMessage` union gained `kind: "location"` variant — channel-neutral so any future adapter (Telegram, WeChat) implements a `location` send or degrades to text. |
| `convex/lib/channels/whatsapp/adapter.ts` | Adapter `send` switch handles the new `location` kind by delegating to `sendLocation`. |
| `convex/whatsapp.ts` | `getRetailerLocaleForOrder` surfaces `deliveryAddress` so the confirm-flow can read its coords. New `resolveLocationPin(meta)` helper picks the right pin (pickup snapshot for self-collect, delivery address for delivery) and returns `undefined` when no coords were captured. Confirm flow sends the pin after the CTA — isolated `try/catch` so a location-send failure doesn't break the rest of the confirm. |
| `convex/lib/whatsappCopy.test.ts` | +6 tests for `renderPickupBlock`. |
| `convex/whatsapp.ts` | `getRetailerLocaleForOrder` surfaces `pickupSnapshot`; confirm send layers the pickup block between the confirm body and the transfer-reference line. |
| `src/lib/schemas.ts` | `pickupLocationFormSchema` (Zod, refines `mapsUrl` via the shared validator); `checkoutFormSchema` gained `pickupLocationId: z.string()`. |
| `src/components/settings/pickup-locations-tab.tsx` | Settings tab body — `offerSelfCollect` toggle card + locations list (up/down arrows, edit, active toggle, "show inactive" collapsible). |
| `src/components/settings/pickup-location-edit-dialog.tsx` | Bottom-sheet add/edit modal, mirrors `address-edit-dialog.tsx`. |
| `src/routes/app.settings.tsx` | New `"pickup"` tab wired into the tab bar + search validator. |
| `src/routes/$slug.tsx` | Sidecar `listActivePublicBySlug` query passed through `CartBar` to `checkout page (CheckoutPage)`. |
| `src/components/storefront/cart-bar.tsx` | Drills `offerSelfCollect` + `pickupLocations` through. |
| `src/components/storefront/checkout-form.tsx` | Self-Collect button hidden when unavailable; 0/1/2+ branching (auto-confirm card for 1, required radio for 2+); pickup block inlined into the `wa.me` prefilled text. |
| `src/routes/track.$token.tsx` | "Pick up at" card for self-collect orders, rendered from the frozen snapshot. |
| `src/routes/app.index.tsx` | Dashboard checklist step 4 (only when `offerSelfCollect` is on); marked "Optional" via the pill in both expanded and collapsed row variants. Done logic: `pickupSetupSeen \|\| hasAnyActive`. |
| `src/routes/app.orders.$shortId.tsx` | Seller order detail — "Pick up at" card mirroring the delivery address block, plus a "Notify store manager" panel with a pre-built copy-to-clipboard snippet for forwarding to whoever runs the pickup spot. |

### Visibility gating (toggle + count)

Self-collect surfaces on the storefront **only when both gates are open**:

```
shopperSeesSelfCollect = retailer.offerSelfCollect && activePickupLocations.length > 0
```

When either is closed, the Self Collect button is hidden entirely — buyers never see a non-functional option. The same rule governs:

- **`orders.create`** strict-branch — when `deliveryMethod === "self_collect"` and `offerSelfCollect === true` and ≥1 active location exists, `pickupLocationId` is **required** and is verified to belong to the retailer and be active before the snapshot is frozen onto the order.
- **`orders.create`** legacy-zero-info path — when either gate is closed, a `self_collect` order is accepted with no pickup info (matches the historical behaviour — preserved deliberately).
- **Dashboard checklist step 4** — appears for every retailer with `offerSelfCollect === true` (which is the default for new retailers) so the feature is discoverable during onboarding. Pre-existing retailers with `offerSelfCollect` unset don't see it. The step is marked "Optional" via a small pill so sellers know they can skip without consequence.

### Onboarding & checklist dismissal

Step 4 has two independent paths to "done":

1. **Visited dismissal** — when the seller opens the Pickup settings tab for the first time, `PickupLocationsTab` fires the idempotent `markPickupSetupSeen` mutation. `retailer.pickupSetupSeen` flips to `true` and step 4 renders as strikethrough done, even if the seller didn't add any locations.
2. **Completion** — adding at least one active pickup location flips `hasAnyActive` to `true`, which also strikes the step through.

Step 4 `done = pickupSetupSeen || hasPickupLocation`. Either signal is enough — a seller who's clearly seen the feature and chose to skip it doesn't get nagged, and a seller who configured a pickup point is rewarded for completing it.

The mutation uses a `useRef` guard in the React layer to prevent re-firing on re-renders. The server-side mutation is also idempotent (no-op when already `true`), so a stale double-call is harmless.

### Pickup snapshot lifecycle

`pickupSnapshot` is the **single source of truth for all buyer-visible pickup details** after order creation. It is written by:

- **`orders.create`** — copies the resolved `pickupLocations` row at insert time.
- **`orders.updatePickupLocation(token, pickupLocationId)`** — public mutation, pending-only, rate-limited under `addressUpdate`. Same trust model as `updateDeliveryAddress` (the tracking token is the capability; `shortId` is not a secret — see [`infra-cost-scaling.md` §6](./infra-cost-scaling.md)). Mirrors `updateDeliveryAddress`'s pending-only guard and writes a `pickup_location_updated` `orderEvents` audit row.

It is read by:

- **`convex/whatsapp.ts`** confirm flow — surfaced via `getRetailerLocaleForOrder` and rendered into the WhatsApp confirmation message via `renderPickupBlock`.
- **`src/routes/track.$token.tsx`** — the "Pick up at" card.

Edits to the source `pickupLocations` row (label, address, mapsUrl, notes) **never propagate** to existing orders. Deactivating the source row (`isActive = false`) also leaves the historical snapshot intact; the only effect is that `updatePickupLocation` will refuse to switch a pending order to that now-inactive id.

### Google Places autocomplete (sellers + buyers)

Both the pickup-settings address input and the buyer's delivery address form use a **shared `<GoogleAddressAutocomplete>` component** that calls the Convex action proxy (`autocompleteAddress` → `getPlaceDetails`). The API key lives only in the Convex deployment env (`GOOGLE_MAPS_API_KEY`), never in the client bundle.

**Architecture decisions:**

- **Convex action proxy** instead of a referrer-restricted browser key. Cleaner key rotation, central rate-limiting via the existing `rateLimiter` (`googleAutocomplete` 30/min, `googlePlaceDetails` 10/min), and one place to add future logging/cost accounting. Per-request cost is the Convex action invocation (cheap) plus Google's bundled session price.
- **Session tokens** — the client component generates a UUID per "type → see suggestions → pick" cycle and passes it to both actions. Google bundles autocomplete queries + one Place Details call into a single billable session at the Essentials tier (~$17/1000 sessions). A new token is generated after each successful pick to start a fresh session.
- **Malaysia only** — `includedRegionCodes: ["my"]` on autocomplete so we never get suggestions from SG/TH.
- **Essentials field mask** — `id,formattedAddress,addressComponents,location` only. The cheapest billable tier and all we need.
- **Graceful manual-entry fallback** — buyers who type a not-on-Google address can still submit; their order just gets no location pin (everything else works).

**State normalization:** `parseGoogleAddress` (in `src/lib/google-address.ts`) maps Google's `addressComponents` into our structured form. The trickiest bit is the state field — `normalizeMyState` resolves:

- Federal Territories: `Wilayah Persekutuan Kuala Lumpur` / `Federal Territory of Kuala Lumpur` / `Kuala Lumpur` all → `WP Kuala Lumpur` (same for Labuan/Putrajaya)
- Alternate spellings: `Penang` → `Pulau Pinang`, `Malacca` → `Melaka`
- Everything else: case-insensitive match against `MY_STATES`

Unknown states return `undefined`, in which case the form leaves the state field blank for the buyer to pick.

### Legacy `mapsUrl` allowlist

Pickup locations had a stricter allowlist than delivery addresses (Waze + Google Maps share-sheet hosts only). After the autocomplete migration, the `mapsUrl` field is **no longer user-facing for new captures** — coordinates from Google drive the maps experience instead. The field stays on the schema for legacy rows; the strict validator in `convex/lib/mapsUrl.ts` and its allowlist are retained for any rare legacy edit path.

### WhatsApp confirm composition

Single-message confirm. The pickup info (label, address, **clickable maps URL**, optional notes) is embedded directly into the confirm CTA body so the buyer gets everything they need in one tap:

```
1. Confirm text + CTA:
   {confirmBody}                  // retailer-overridable template
   \n
   📍 Pickup details              // renderPickupBlock — non-overridable
   {label}
   {address}
   {mapsUrl}                      // deriveMapsUrl: mapsUrl → place_id → lat/lng
                                  //   - mapsUrl form: seller-pasted (legacy)
                                  //   - place_id form: opens NAMED place page
                                  //   - lat/lng form: search by coords
   \n
   {notes?}
   \n\n
   {transferReferenceLine}        // system message, non-overridable
   \n
   💳 Payment details             // renderPaymentInstructions, if any
   [I've paid button]             // CTA

2. Payment QR image (separate)    // if configured
```

The pickup block is appended *after* the user-overridable confirm template — retailers can customise their own copy without being able to break the pickup info. No new template variables were added to the override surface.

**Maps URL inline (not a separate location pin):** `renderPickupBlock` always includes a clickable Google Maps URL derived via `deriveMapsUrl`. The placeId-based URL form opens the **named place page** in Google Maps (shows "Eco Majestic" in the search bar, not raw coordinates) — that's the prettiest experience the buyer gets without us having to send a follow-up message.

**Why no follow-up location pin:** an earlier iteration sent a WhatsApp `type: "location"` message after the confirm CTA, giving the buyer a tappable map preview. We pulled that — sending two messages per order felt noisy, the second one had no body text, and the embedded URL in the confirm body gives the same one-tap navigation outcome. The `sendLocation` adapter helper and `OutboundMessage.location` variant were removed alongside the call site.

**Delivery side:** the confirm text for delivery orders doesn't include the buyer's own address — they know where they live. So nothing to embed for delivery; the confirm message stays unchanged.

### Tracking page navigation buttons

For self-collect orders the tracking page (`/track/<token>`) renders **two side-by-side buttons** when the pickup snapshot has lat/lng:

- **Open in Waze** → `https://waze.com/ul?ll=<lat>,<lng>&navigate=yes`
- **Open in Google Maps** → `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`

Both URLs are derived from stored coordinates — no app-specific data is captured separately. Legacy snapshots without coords fall back to the single "Open in maps" link from the retailer's `mapsUrl`. If neither is present, no buttons render.

### Storefront checkout branching

`checkout-form.tsx` branches on the active-location count when self-collect is selected:

- **0 active locations** (or `offerSelfCollect` off): the Self Collect tile is hidden entirely; the row collapses to a single full-width Delivery button.
- **1 active location**: the tile shows; selecting it renders a `PickupSummaryCard` (auto-confirmed, no input). The id is resolved at submit time from the single option.
- **2+ active locations**: the tile shows; selecting it renders a required `PickupLocationRadioList`. Submit refuses to proceed without a chosen id, with the message *"Please choose a pickup location to continue."*

The `wa.me` prefilled text now inlines `📍 Self Collect at: <label>\n<address>\n<mapsUrl>\n<notes>` so the buyer sees pickup details immediately, before the bot replies.

### Settings UI

- **"Pickup" tab** added to `/app/settings`, between Payments and Integrations.
- **Top card:** `offerSelfCollect` toggle. Amber callout when the toggle is on but zero active locations exist ("buyers won't see the option until you add one").
- **Main card:** locations list with **drag-and-drop reorder** (`@dnd-kit/core` + `@dnd-kit/sortable`). Each active row exposes a `GripVertical` handle on the left — drag listeners are bound to the handle only, so tapping Edit / the active toggle never starts a drag. Sensors: `PointerSensor` (8 px distance), `TouchSensor` (250 ms hold + 5 px tolerance), `KeyboardSensor` (arrow-key reorder for a11y). `touch-none` on the handle prevents mobile scroll-while-drag.
- **Optimistic drop:** dropping a row applies the new order to local state immediately, fires the `reorder` mutation in the background, and reverts + toasts on failure. Convex's reactive query then ships the authoritative order back on success — same as the optimistic state, so no flicker.
- Each row also shows: label, address, optional "Open in maps" link, notes, edit button, active/hidden toggle. Inactive rows live behind a "Show inactive (N)" collapsible. Empty state with a CTA when no locations exist.
- **Reactivating** a soft-deleted row sends it to the end of the active list so it doesn't ambush the retailer's current ordering.

### `reorder` mutation invariants

`pickupLocations.reorder(retailerId, orderedIds)` rewrites `sortOrder` to the index of each id (0..N-1) so the result is gap-free. Validates that `orderedIds` is **exactly** the set of currently-active ids for the retailer:

- Length must match the active set (catches a stale client whose cache lost or gained a row after someone else added/deactivated a location).
- No duplicates.
- No foreign or inactive ids.
- Tenant-scoped via `requireRetailerOwner`.

Inactive rows' `sortOrder` values are intentionally untouched — preserving them keeps `setActive(true)`'s "push to end" semantics (`Math.max(allSortOrders) + 1`) robust against drift.

### Dashboard checklist

Setup checklist on `/app` gains a 4th step `"pickup"` when `retailer.offerSelfCollect === true` (default for new retailers). Marked "Optional" via a small pill in both the expanded and collapsed row variants. Done logic: `pickupSetupSeen || hasAnyActive`. Deep-links to `/app/settings?tab=pickup`. Pre-existing retailers with `offerSelfCollect` unset keep the original 3-step checklist unchanged.

### Orders list (seller view)

`/app/orders` shows a small `DeliveryMethodBadge` next to the status badge on every order card — `📦 Pickup` or `🚚 Delivery` (icon-matched to the storefront checkout toggle for visual continuity). Muted styling so it doesn't compete with the status badge; the goal is at-a-glance triage info. Pickup orders typically need a different ops flow (notify store manager, prepare for collection), so spotting them in the list without opening the detail page matters.

### Order detail (seller view)

`/app/orders/$shortId` for self-collect orders renders two extra blocks. The "Pick up at" card reads from the **frozen** `pickupSnapshot`; the "Notify store manager" panel pulls the **live** pickup location row via `pickupLocations.getOwnedById` so it routes to the *current* manager (not whoever was on the snapshot at order create).

- **"Pick up at" card** — label, address, optional notes, with Copy and Maps buttons (Maps only when the snapshot has a `mapsUrl`, `placeId`, or lat/lng). Mirrors the existing "Delivery Address" section visually.
- **"Notify store manager" panel** — pre-built message snippet in a `<pre>` block with a `Copy` button. When the live pickup location has a `managerWaPhone`, the panel also renders a primary **`Notify <managerName> on WhatsApp`** button that opens `https://wa.me/<phone>?text=<encoded snippet>`. One tap → WhatsApp opens with the message already filled in to the manager's chat → seller hits Send. Falls back gracefully to Copy-only with an inline hint pointing at Settings → Pickup when no manager phone is set.
- **Snippet format:**

  ```
  📦 New pickup order ORD-AB23 — Main Store
  Customer: Ali (+60 12-345 6789)

  Items:
  • 1× Mango Kush Seed (RM 50.00)

  Total: RM 50.00

  Please prepare for collection.
  ```

  Customer line resolves `name → phone → "Anonymous"`; phone runs through the shared `formatPhone` helper. Fixed format for v1 — per-retailer override is future work, only revisit if retailers ask. Seller can edit the message after the wa.me link opens WhatsApp (or after pasting from the Copy button).

### Store manager contact (per pickup location)

Sellers can optionally attach a `managerName` + `managerWaPhone` to each pickup location from Settings → Pickup. The fields are:

- **Not frozen onto the order snapshot** — fetched live at order detail render time via `pickupLocations.getOwnedById`. Reason: if a seller swaps managers, today's pending pickup orders should route to the *new* manager. Snapshot pattern only applies to buyer-facing data (label, address, lat/lng).
- **Not exposed on the public storefront query** — `listActivePublicBySlug` filters them out. Manager info is operational, not buyer-facing.
- **Validated server-side** — `managerWaPhone` runs through the same `assertValidWaPhone` used by the retailer's primary contact number (8–15 digits, country code required). `managerName` trimmed, ≤60 chars.
- **Empty string = clear** on `update`, matching the existing optional-field convention.
- **Phone is the gate, name is cosmetic.** The Notify button on the order detail page renders whenever `managerWaPhone` is set — the wa.me link only needs the phone. `managerName` is purely the button label: present → "Notify Aishah on WhatsApp", absent → "Notify on WhatsApp". The two fields are independently optional; sellers can set either, both, or neither.

The seller order detail page uses these fields to render either the primary "Notify Aishah on WhatsApp" button or the Copy-only fallback with a hint linking to Settings.

## Env requirements

- **`GOOGLE_MAPS_API_KEY`** (Convex deployment env, set via `npx convex env set`). Server-side only — never `VITE_`-prefixed. Required for Google autocomplete; absence causes the proxy actions to throw a sanitized error. Owner-managed; restricted to "Places API (New)" and the Kedaipal HTTP referrer allowlist.
- Everything else (WhatsApp Cloud API, etc.) unchanged.

## Tier gating (deferred)

The pricing plan caps Starter at **1 active pickup location** and lets Pro+ have unlimited. **Not implemented in v1** — there's no plan/tier field on `retailers` yet (subscription billing is Sprint 1–3). All retailers currently get unlimited locations. The cap will be added inside `pickupLocations.create` (and a "N locations hidden — upgrade to Pro" banner in `listForRetailer`) when the subscription-billing task lands.

## Known limitations

- **Delivery distance trusts the buyer's chosen coordinates.** Radius pricing measures to the lat/lng from the buyer's Google-autocomplete pick — there's no server-side geocode of the typed address (the deliberate no-Distance-Matrix design). A buyer could pick a *nearer* suggestion than their real address to land a cheaper band. Mitigations: the seller sees the real address label on the order, and the frozen `deliverySnapshot.distanceKm` audits what was charged, so a mismatch is catchable at fulfilment. Acceptable for v1 given the manual-close model; a server geocode is the escape hatch if abuse shows up.
- **No hard-delete.** Soft-delete only. A retailer cannot permanently remove a location, even one with zero orders against it. Acceptable for v1; revisit if the inactive list becomes cluttered.
- **`channelUserId` migration not part of this feature.** Identity is still keyed by `waPhone` on `orders.customer` and `customers`. The channel-adapter Phase 4–6 migration is independent and unblocked separately.
- **No React component tests.** Same constraint as the customer-database feature — pure helpers are unit-tested, UI components are verified via `tsc` + manual end-to-end in the browser.

## Future work

- **Tier cap enforcement** when subscription billing lands (Starter = 1 active, Pro+ = unlimited) — single check inside `pickupLocations.create`, plus a soft over-cap banner in `listForRetailer` for retailers downgraded from Pro.
- **Pickup time slots / appointments** — currently a free-form `notes` field. A structured slot picker (Mon–Sat 10am–6pm, etc.) would unlock the cake/kuih cohort's actual workflow.
- **Pickup location attached to a specific product** — for retailers where only some products are pickup-eligible (e.g. frozen-only). Not requested yet; flag the use case if it surfaces.
