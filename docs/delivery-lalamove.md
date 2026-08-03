# Lalamove Delivery — checkout quote, one-tap dispatch, auto tracking

ClickUp [`86eyb5hrf`](https://app.clickup.com/t/86eyb5hrf) · shipped Jul 2026 (dev) · Fruit Hut (Founding #4) is the launch seller.

End-to-end delivery fulfilment on the Lalamove Open API v3 (market MY): the
buyer pays the **real rider price** at checkout, the seller books the rider in
**one tap** from order detail, and the webhook drives `shipped` (with live
tracking link) and `delivered` automatically. No manual tracking handling
anywhere.

## Locked decisions

- **BYO-ONLY money model** (Arif, revised 21 Jul — supersedes the 18 Jul
  "master fallback" plan): the seller holds their own Lalamove Business
  account; their API key/secret live on the retailer and they pay Lalamove
  directly from their own prepaid wallet — mirroring the retailer-owned
  payment-gateway posture. **Kedaipal has no Lalamove account and never
  books or pays on a seller's behalf.** A seller without their own keys
  simply uses the flat/radius pricing modes and books riders however they
  do today. (The briefly-built master fallback — env keys, RM2k spend cap,
  billing-tab meter, admin rebill badge — was removed the same day; see git
  history if it's ever wanted back.)
- **Fee frozen at checkout; dispatch always re-quotes.** Lalamove honours a
  quotation for exactly 5 minutes, so the buyer-paid fee and the actual
  booking cost are different numbers by design. Drift is absorbed by the
  paying account and stored on the job row (`costActual`), never rewriting
  the order. The dispatch confirm dialog shows the variance before booking.
- **Provider is a seam.** `deliveryJobs.provider` is a literal union of one
  today; the client is one module; DelyvaX is the named provider-#2
  candidate (trigger: parcel couriers or courier choice).
- **Pro-gated** (`PLAN_FEATURES.delivery`): enabling booking + switching
  pricing to live-quote are Pro; disabling/clearing stays un-gated
  (downgrade never traps); buyer-side fee rendering is all-tier.

## Architecture

**No new field for the origin** — the ticket's `retailers.deliveryOrigin`
was stale: `retailers.businessAddress` (shipped with radius delivery,
86extzdr8) is already the seller's pinned origin and is reused as the
Lalamove pickup point. One address, two consumers.

Pricing rides the existing delivery-charge seam: `deliveryConfig` gained a
third arm `{ mode: "lalamove", onUnquotable }` next to `flat`/`radius`, all
resolved by the same pure `resolveDeliveryQuote` (`convex/lib/delivery.ts`).
**`onUnquotable` is VESTIGIAL since 27 Jul** (Zaki): lalamove mode always
behaves as block — see "No fee-pending under Lalamove" below; the field stays
so stored rows validate and `sanitizeDeliveryConfig` normalizes it to
`"block"` on save. **Pricing and booking are orthogonal**: a seller can
charge a flat fee yet still book riders (absorbing drift); live-quote
pricing additionally requires booking to be enabled (its vehicle +
credentials price the quote).

**No KEDAIPAL distance limit under Lalamove — by construction.** The pricing
modes are mutually exclusive, and the `lalamove` arm of
`resolveDeliveryQuote` never reads the radius bands, the business-address
distance, or any range cap of ours — we impose no delivery area. Raised by
Zaki 26 Jul ("Lalamove can deliver anywhere") — audited: nothing to disable
on our side. The settings copy SAYS so ("no delivery area to set…") and the
By-distance card is subtitled "Radius bands — you deliver" so the two modes'
mental models don't blur.

**But LALAMOVE has one — it's a city zone, not a radius, and it is the SAME
for every vehicle (27 Jul, measured live).** Lalamove is an intra-city
courier: both stops must sit inside one serviceable city zone
(`GET /v3/cities` for MY lists `KUL`, `JHB`, `MKZ`, `NTL`), or the quote is
refused with HTTP 422 `{"errors":[{"id":"ERR_OUT_OF_SERVICE_AREA"}]}`.
Head-to-head from a **Beranang, Selangor** origin (MY sandbox):

| Destination | ~Distance | MOTORCYCLE | CAR |
| --- | --- | --- | --- |
| Seremban | 42 km | RM 21.20 | RM 33.10 |
| Port Dickson | 77 km | out of service area | out of service area |
| Melaka City | 105 km | out of service area | out of service area |
| Alor Setar | 400 km | out of service area | out of service area |

Three conclusions that shaped the build:

1. **Vehicle ≠ range.** Bike and car share one coverage boundary — the city
   config differentiates them by dimensions/load only (10 kg vs 40 kg). So
   Zaki's proposed "bike failed → re-quote with car" fallback was
   investigated and **deliberately not built**: it can never rescue an
   out-of-zone address. Vehicle choice is parcel size + price, full stop.
2. **Cross-zone is refused even between two Lalamove cities** — Melaka is a
   served city (`MY MKZ`), yet Beranang (KUL zone) → Melaka fails. The rule
   is "same zone", not "near a Lalamove city".
3. **No km number can honestly be published** (the KUL edge sits somewhere
   in the 42–77 km band from Beranang and differs by direction/origin), so
   the UX never promises a range — the live quote answers, and the refusal
   is made legible.

**Buyer-facing failure taxonomy** — `classifyQuoteFailure` (pure,
`convex/lib/lalamove.ts`, unit-tested against the real captured 422 body)
maps every quotation failure onto three stories, because only one is
retryable:

| Status | Trigger | Buyer sees | Retry helps? |
| --- | --- | --- | --- |
| `out_of_range` | `ERR_OUT_OF_SERVICE_AREA` / `ERR_INVALID_MARKET` | "This address is too far — our delivery rider service doesn't cover it. Try an address closer to {store}[, or choose pickup]." | Never — change address |
| `store_unavailable` | HTTP 401/403 (revoked/typo'd seller key) **or** missing creds/pickup pin at quote time | "Delivery pricing isn't working for this store right now — it's on {store}'s side, not yours. [Choose pickup, or] message the store on WhatsApp." | Never — seller must fix |
| `unavailable` | Everything else (5xx, network, odd payloads, our rate limit) | "We couldn't calculate the delivery fee right now — re-pick your address to retry, or try again shortly." | Yes |

All three block submit (strict quote-or-refuse); `no_coords` (no pin picked)
keeps its own "pick a suggestion" line. The address-edit dialog carries the
same taxonomy. Coverage refusals are NOT logged as errors (expected business
outcome); broken-store and transient failures are. **Expectation is set up
front**, not just at the wall: the delivery-address field on a live-quote
store shows "Delivery is by rider, so the fee depends on your address…
Addresses outside the rider's coverage can't be delivered", and the
**seller's settings panel** now teaches the same rule from their side (city
zone around the pickup point, ~40–70 km, never cross-zone, vehicle doesn't
change it, keep self-collect on as the fallback).

**No fee-pending under Lalamove — strict since 27 Jul (Zaki).** A seller who
picked Lalamove must never be handed fee homework, and the buyer must always
see the real rider price before sending. So under lalamove pricing there is
NO "arrange" fallback anywhere: checkout requires a pinned, quotable address
(no pin / no quote → submit disabled with reason; `orders.create` enforces
the same), and the tracking page's **address edit** fetches a fresh live
quote for the new pin — the buyer sees the new fee before saving, the dialog
passes the quote row id to `updateDeliveryAddress`, and an unpriced edit is
refused. Shared client hook: `src/lib/use-live-delivery-quote.ts` (checkout
sheet + edit dialog, one debounce/seq/trust model). Accepted trade-off: a
Lalamove/API outage or broken key refuses delivery checkout on that store
until it recovers (copy says "try again shortly"; self-collect unaffected).
The seller card's `orders.deliveryFeePendingReason` (`out_of_range` |
`no_coords` | `unquotable`, 26 Jul) still drives reason-true copy — under
lalamove the `unquotable` reason is now **legacy-only** (rows from before
the strict rule). See
[`fulfilment.md`](./fulfilment.md#fee-pending-arrange-via-whatsapp--the-second-payment-hold).

| Piece | Where |
| --- | --- |
| Pure client (HMAC signing, payload builders, RM→sen, status maps, credential resolver) | `convex/lib/lalamove.ts` |
| Webhook signature verification | `convex/lib/lalamoveSignature.ts` |
| Convex functions (network client, checkout quote, dispatch, webhook handler) | `convex/lalamove.ts` |
| Webhook route | `convex/http.ts` `POST /webhook/lalamove` |
| Buyer checkout wiring | `src/components/storefront/checkout-form.tsx` |
| Seller dispatch card | `src/components/order/book-delivery-card.tsx` |
| Seller setup (4th pricing mode inside Delivery charge) | `src/components/settings/fulfilment-tab.tsx` (`DeliveryChargeSection`) |

Schema: `retailers.deliveryBooking { enabled, vehicleType, apiKey?, apiSecret? }`
(plain fields, accepted for v1 — flagged in the ticket), `deliverySnapshot`
gains mode `"lalamove"` + `quotationId`/`vehicleType`/`quotedAt` audit
fields, and two new tables: `deliveryQuotes` (transient server-side checkout
quote record) and `deliveryJobs` (the booking ledger — indexes `by_order`,
`by_retailer`, `by_provider_order`).

### Credential resolver

`resolveLalamoveCredentials(booking)` — the seller's own key pair on the
retailer row is the ONLY source; absent/half → `null` (feature unavailable,
checkout falls back gracefully). **No deployment env vars** — sandbox vs
production is inferred from Lalamove's own key prefix (`pk_test_…` →
sandbox, else production), so a key can never be pointed at the wrong API
host and one store can run sandbox keys while another runs prod.
`updateSettings` enforces: enabling requires business address + both key
parts; half a credential is refused at save time; clearing keys while
enabled is refused (nothing to fall back to); key fields follow the
logoStorageId convention (`undefined` = keep stored, `""` = clear).

**Settings prominence (24 Jul):** the delivery-charge picker is a 2×2
card grid with **Lalamove first** — branded with the official wordmark
(`public/img/lalamove-logo.svg`) ahead of Free/Flat/By-distance. For a
locked Starter the card stays **full-colour with a Pro chip + "upgrade to
Pro to turn on"** (disabled-with-reason, deliberately not a washed-out
ghost) so every tier sees rider delivery exists — the upsell surface for
the Pro tier. The settings vehicle is labelled as a *default* with a
helper noting the per-order switch in the booking dialog. Every mode card
(and the vehicle picker) carries a **radio-style corner dot** (`ModeRadioDot`,
27 Jul) — empty ring vs filled accent dot — because the tinted-border
selected state alone read as "these might all be on" when the grids in fact
choose exactly one option.

**IA (revised after first seller test):** Lalamove is NOT a separate card —
it's the 4th delivery-pricing mode (Settings → Fulfilment → Delivery charge:
Free / Flat / By distance / **Lalamove**). Picking it reveals the whole
setup inline — pickup address, vehicle, BYO keys (with a "How to set up"
link to the vendor guide at `/guides/lalamove-setup.html`) and, once keys
are saved, the deployment's **webhook URL with one-tap copy** (see Webhook
below). One save button writes `deliveryConfig` + `deliveryBooking`
together; switching to another pricing mode disables booking in the same
save (keys stay stored, so switching back is instant). The key inputs are
plain text with a CSS mask on the secret — deliberately NOT
`type="password"`, so Chrome never mistakes the form for a login and
autofills saved credentials into it.

### Checkout quote (trust model)

The reactive `delivery.quote` query answers `{ kind: "live" }` for
lalamove-mode stores; the client (checkout page + address-edit dialog, via
the shared `useLiveDeliveryQuote` hook) then calls the
`lalamove.quoteForCheckout` **action** once per picked address AND per
chosen date (debounced,
rate-limited per retailer — the quote-by-coordinates oracle gets the same
trilateration caution as the radius quote). The action records the fee in a
`deliveryQuotes` row and returns `{ quoteId, fee }`; **`orders.create` only
ever accepts the row id** — coordinate-matched (±~11 m), ≤30 min old,
consumed on use — so the browser can display the fee but never dictate it.
Missing/stale/mismatched quote → **checkout refused** with clear copy
(strict, 27 Jul — no quote, no order; see "No fee-pending under Lalamove"
above). Kill switch: no credentials/config → the quote query never says
"live" and checkout behaves exactly as before.

**Pre-orders are priced for THEIR day (23 Jul):** when the buyer picks a
future fulfilment date, the quote is requested with Lalamove `scheduleAt` =
noon MYT on that day (the hour barely moves the price; the day can), so the
locked buyer fee reflects the delivery day, not checkout day. Changing the
date re-quotes exactly like changing the address. Today = immediate
pricing; the scheduleAt guard caps at Lalamove's ~30-day window and falls
back to immediate on anything odd. Dispatch on the day still re-quotes
immediate — variance is the vendor's, as everywhere.

Note: a buyer address edit (`updateDeliveryAddress`) re-prices through the
same resolver. Under lalamove pricing the edit dialog fetches a **fresh
live quote for the new pin** (mutations can't fetch, so the dialog does —
same hook/trust model as checkout) and passes `deliveryQuoteId`; the buyer
sees the new fee before saving, and an unpriced edit is refused (27 Jul —
supersedes the earlier lands-fee-pending behavior).

### Dispatch (Book delivery)

**When can the vendor book?** From the FIRST in-progress status onwards:
`confirmed` or `packed` (custom seller stages ride on these canonical
anchors, so a store's own stage names change nothing). Pending orders can't
book (order not accepted yet); shipped/delivered/cancelled can't (rider
already moving or moot). Pre-order / mockup flows therefore work exactly as
expected: the vendor books whenever THEY are ready — after design approval,
after payment, on the morning of the fulfilment date — manually, or lets
auto-book fire on packed+paid+due-today.

Two-tap: `prepareBooking` re-quotes at today's price and the confirm dialog
shows it against the buyer-paid fee (variance called out, including who
absorbs it) **with a per-order vehicle switch** (Motorcycle ⇄ Car,
defaulted to the settings vehicle; switching re-quotes since prices are
per-vehicle — a bulky one-off order gets a car without a round-trip to
Settings, and the chosen vehicle is what lands on the ledger row); `confirmBooking` places the order within the 5-minute window
and writes the `deliveryJobs` row — the **one-active-job-per-order**
invariant is enforced by a **reserve → POST → commit** sequence (PR #127
review): `reserveBooking` atomically claims the slot with a placeholder
row (no `providerOrderId` yet) BEFORE the external `POST /v3/orders`, so
two concurrent confirms — even with distinct quotations from phone +
desktop — can never both dispatch a rider; the loser is rejected before
any money moves. `commitBooking` finalizes with Lalamove's order id, a
failed POST releases the reservation into the amber rebook card, and a
5-minute scheduled sweep expires a reservation orphaned by a crash
mid-call (copy points the seller at their Lalamove app, since in the
crash-mid-POST case the rider order may exist there untracked). Every blocked state renders disabled-with-reason on the
card (`DispatchBlock` map): wrong status, no map pin on the address (with a
fix path — never a dead end), booking off, plan gate (Pro chip), no
credentials, missing buyer/seller phone. That copy lives in
`src/lib/dispatch-block.ts` (`dispatchBlockCopy`) because the **mark-shipped
prompt** renders the same reasons — a rider vendor is never offered the manual
parcel-courier form, so this copy is their whole explanation before they choose
to ship without a rider (ClickUp `86eyff02p`, see
[`fulfilment.md`](./fulfilment.md#seller-ux)). Wallet-empty
booking failures surface Lalamove's error as "top up your Lalamove wallet,
then retry". `cancelBooking` (with a rider-fee warning) deliberately skips
the eligibility gates — cancelling must work even when booking wouldn't.

### Prompt to book on packed (opt-in)

Zaki's ask after weighing silent auto-book: don't spend the vendor's wallet
without them seeing the price. So there is **NO server-side auto-booking**.
Instead, `retailers.deliveryBooking.promptBookOnPacked` (opt-in toggle in the
Lalamove setup) makes the order page **auto-open the Book-delivery confirm
dialog** (today's re-quoted price + variance vs buyer-paid) the moment the
seller marks a **paid, due-today** delivery order **Packed** — one tap to
dispatch, or dismiss. Nothing books or charges until the seller confirms.

Client-side, in `BookDeliveryCard`: an effect watches for a live transition
INTO `packed` (a page load of an already-packed order never prompts — the
status is baselined first), then gates on promptBookOnPacked + payment
received + not future-dated + no active job + bookable (blockReason null),
and calls the same `prepareBooking` the manual button uses. Future-dated
(pre-order) and unpaid orders never prompt; the card's ⚡ hint tells the
seller what to expect. Scoped to the order-detail page — bulk/inbox packing
doesn't fire the dialog (no modal-spam). This replaced the briefly-built
silent auto-book (`autoBookForOrder`/`getAutoBookContext`, removed) — see
git history if a zero-tap option is ever wanted for high-volume sellers.

### Phones — Lalamove MY only accepts +60

Lalamove validates the rider-contact area code per market (a +65 buyer
422'd in testing — real JB cross-border case). `toLalamoveMyPhone`
normalizes to `+60…` or returns null: a non-MY **buyer** number falls back
to the seller as rider contact (buyer's real number in the rider remarks;
the confirm dialog says so up front), while a non-MY **seller** number
blocks dispatch with "add a Malaysian (+60) WhatsApp number in Settings →
Store". `friendlyBookingError` names phone rejections honestly if one ever
slips through.

### Webhook

`POST /webhook/lalamove` mirrors the WhatsApp route: raw body → resolve
secrets → verify → act → ack. Lalamove-specific twists:

- Auth lives **inside the JSON body** (`apiKey`/`timestamp`/`signature`),
  and the verifying secret is **per retailer** (BYO-only): the route
  resolves it through the `deliveryJobs` row (`by_provider_order`) — the
  job retailer's stored secret is the only candidate. Unmatched events are
  unverifiable by design and get ack+ignore.
- **Signature formula CONFIRMED against real sandbox traffic (21 Jul 2026)**:
  `hex(HMAC-SHA256("<ts>\r\nPOST\r\n<our-path>\r\n\r\n" + JSON.stringify(data), secret))`
  — the `data` variant. An `envelope` fallback candidate is kept
  defensively; the route logs which variant matched.
- Lalamove retries 10× over 24 h **and disables the URL after 10 failures**,
  so every handled-or-ignorable outcome acks 200 (including the empty-body
  registration ping). 401/500 are reserved for forged/misconfigured cases.
- Events arrive **out of order** and can **regress** (a matched driver
  bailing sends the order back to `ASSIGNING_DRIVER`). The job row follows
  provider truth via a `lastEventAt` guard; the **order never regresses** —
  `picked_up` → `shipped` only from confirmed/packed, `completed` →
  `delivered` only from confirmed/packed/shipped, cancelled orders are never
  touched, and transitions ride the exported `applyStatusTransition` so
  WhatsApp notify, stage vocabulary, activation stamping and orderEvents all
  come free.
### Event-by-event: when it fires, what we do, who is told

| Event | When Lalamove sends it | What we do | Vendor sees | Buyer sees |
| --- | --- | --- | --- | --- |
| `ORDER_STATUS_CHANGED: ASSIGNING_DRIVER` | booking placed / driver bailed and rematching | job pill | "Finding rider" on the order card (live) | nothing — matching churn is noise |
| `DRIVER_ASSIGNED` | a driver accepted | driver name/phone/plate + shareLink onto the job; link mirrored to `orders.carrierTrackingUrl` (fill-if-unset) | driver row + Call + Live tracking on the card | nothing yet — deliberate: drivers can still bail; the buyer promise starts at pickup |
| `ORDER_STATUS_CHANGED: ON_GOING` | driver is **heading to the VENDOR** to collect (not to the buyer yet) | job pill | "Rider on the way" (to *you*) | nothing |
| `ORDER_STATUS_CHANGED: PICKED_UP` | rider has the goods, now heading to the buyer | **order → `shipped`** via `applyStatusTransition` (which also drops a stale `currentStageId` — see note below) | inbox/status flips reactively + orderEvents row | **WhatsApp shipped message with the live-tracking link** — this is the moment the buyer's tracking starts |
| `ORDER_STATUS_CHANGED: COMPLETED` | goods handed to the buyer | **order → `delivered`** | inbox/status flips reactively + timeline row (no chime — see note); the dispatch card settles to a green **Delivered** summary — booking cost (seller's actual spend), rider name/plate, and a "Trip details" link — never an empty card | **WhatsApp delivered message** |
| `ORDER_STATUS_CHANGED: EXPIRED` | no driver found in Lalamove's matching window | job → failed + reason | **email** (`deliveryJobFailed`) + **browser alert** + amber card + one-tap Rebook | nothing (order unchanged — buyer was never told a rider existed) |
| `ORDER_STATUS_CHANGED: CANCELED / REJECTED` | booking cancelled (by vendor on Lalamove's side, by Lalamove, or step 1 of a clone) | job → failed + reason | same failure surfaces as EXPIRED | nothing |
| `ORDER_AMOUNT_CHANGED` | **after** matching/completion when the final charge differs from the quote — waiting-time fees, priority fee/tip added, toll adjustments | `costActual` updated on the job | the card's "Booking cost" updates reactively (the drift ledger vs buyer-paid fee) | nothing — buyer price is frozen |
| `ORDER_REPLACED` | Lalamove's **cancel-and-clone**: for post-match adjustments THEY cancel the original and re-create it under a new orderId (sequence: CANCELED old → ORDER_REPLACED → clone's own events) | job repointed to the new id, **revived** to "assigning", stale failure cleared | card returns to active; if the clone-cancel briefly emailed a failure, the booking visibly recovers (rare, self-healing) | nothing |
| `POD_STATUS_CHANGED` | rider uploaded the drop-off photo / signature | trigger only — the truth is read from `GET /v3/orders` by the idempotent `fetchPodImages` (also scheduled at COMPLETED, whichever lands first wins; the loser's blobs are cleaned) | photo thumbnails on the delivered dispatch card | **WhatsApp photo follow-up** to the delivered message ("Delivered! 📸 …", EN+BM) |
| `WALLET_BALANCE_CHANGED` | vendor wallet balance moved | logged only (proactive low-balance banner = named follow-up) | — | — |
| `ORDER_CREATED` (undocumented but real) | at booking | logged only | — | — |

**Proof of delivery (POD) — rider drop-off photo:** every placed order
requests POD (`isPODEnabled: true` in `buildPlaceOrderBody` — free, and
the photo is the seller's evidence in "never arrived" disputes). On
completion (`COMPLETED` and/or `POD_STATUS_CHANGED` — both trigger the
same idempotent fetch) `lalamove.fetchPodImages` reads
`GET /v3/orders/{id}` → `stops[].POD {status, image, deliveredAt}`, keeps
`DELIVERED`/`SIGNED` stops with an image, downloads the shots and stores
them as **our** blobs (`deliveryJobs.podImageStorageIds` — Lalamove's URL
lifetime is undocumented, never hotlink), retrying up to 3× at 2-min
intervals since the upload can lag the status event. Then: the **buyer**
gets the photo on WhatsApp as a follow-up to the delivered message
(`notifyDeliveryPhoto`, transactional, caption EN+BM) **and** a "Delivery
photo" card on the tracking page (`orders.get` resolves `podImageUrls` on
delivered delivery orders only — one indexed read on that end-state, the
hot tracking path pays nothing), and the **vendor** sees thumbnails on
the delivered dispatch card ("Delivery photo from the rider", tap for
full size). Races are settled in `storePodImages` (first
set wins, loser's blobs deleted); order/account delete cascades remove the
blobs. Sandbox never produces a POD (no riders), so the photo path is a
**first-prod-booking check**; all parsing/storage/race logic is
unit-tested.

**Stage-pointer consistency (bug found in live testing, 24 Jul):** a seller
tapping the stepper stores BOTH `orders.status` and `orders.currentStageId`;
webhook transitions previously advanced only `status`, so the stored stage
pinned the tracking page + order detail back to "Packed" on a delivered
order (display resolves stage-first). Fixed at both layers:
`applyStatusTransition` now clears a stale `currentStageId` on any real
status change (same-status replays keep within-anchor custom stages), and
`resolveCurrentStage` (both `convex/lib` + `src/lib` mirrors) ignores a
stored stage whose anchor is BEHIND the canonical status — which also heals
any already-stale rows with no migration.

**Why the buyer only hears at PICKED_UP and COMPLETED:** those are the two
promises a buyer cares about ("your food is moving" / "it arrived"), and
they're irreversible. Everything earlier (matching, assignment, rider
heading to the stall) can churn — notifying it would send the buyer
false-starts.

**Why COMPLETED doesn't chime the vendor:** `delivered` is the expected
happy path — the inbox shows it reactively and the interruption budget
(chime + system notification) is reserved for events needing ACTION: new
order, failed booking. Payment is orthogonal: a delivered-but-unpaid order
(cash on hand-over, pay-later) stays `unpaid` and the existing payment
machinery (claim buttons, reminder cron, manual reminder) carries it — the
rider never collects money for us (Lalamove COD is not enabled).

Terminal failures email the seller (EN+BM `deliveryJobFailed` template),
raise a browser alert on devices with order alerts on, leave the order
untouched, and the card offers one-tap rebook.

**Registration is per SELLER** (BYO-only): each vendor pastes OUR webhook
URL into THEIR Partner Portal → Developers → Webhook URL (Version 3). The
settings card surfaces the exact URL with a copy button and the vendor
guide walks it (Step E5). Graceful degradation if a seller skips it:
bookings still work, but shipped/delivered stop being automatic — the
order stays where it is until the seller advances it by hand, which since
3 Aug costs one confirm per transition while a booking is active (the
"Update manually" escape; see the manual-advance gate below). Dev
deployment URL: `https://qualified-chihuahua-441.convex.site/webhook/lalamove`.

**Manual-advance gate while the rider drives (26 Jul hotfix; tightened
3 Aug):** while an order has an **ACTIVE** rider job, the order-detail
stepper's advance into a **shipped- or delivered-anchored** stage renders
**disabled-with-reason** — a manual tap would message the buyer early and,
for shipped, without the live-tracking link. Confirm/packed advances are
never gated (pre-pickup work is the seller's), same-anchor custom-stage
moves stay free, and a **"Update manually" confirm-gated escape** stays
reachable so a dead webhook never strands the order (cancelling the
booking lifts the gate outright — a second way out).

The gate originally ALSO required `deliveryJobs.lastEventAt`, i.e. proof
the webhook was alive, so that webhook-less sellers kept manual control.
That left the gate **off during exactly the window it matters most** —
between placing the booking and the first event landing — and Zaki hit it
in live testing on 3 Aug: booked a rider, then clicked straight through to
"Collected" on a live trip. Since the escape already protects the
webhook-less seller, the `lastEventAt` condition was dropped; it now only
picks the honest wording ("moves on its own when the rider picks up" once
the booking has reported, vs "…as long as your Lalamove webhook is set
up" before that). Predicates: `isActiveJobStatus` +
`isRiderManagedTransition`; `riderDrivesOrderStatus` now only answers "has
this booking reported yet?" for copy.

Client-side UX guard only — the server mutation is unchanged (the seller
owns the order, and the webhook's same-status replays are already no-ops).
Known gap, deliberate: the inbox **bulk** status bar can still mass-mark
shipped without job awareness (needs a per-order job lookup in
`searchOrders` — follow-up, not hotfix material). NOTE the collection gate
below is different: that one IS server-enforced on every write path,
because it protects a business rule (goods that aren't there yet) rather
than message timing.

### Hygiene + lifecycle guards (pre-ship audit, 22 Jul)

- `deleteOrderCascade` (hard delete) also removes the order's `deliveryJobs`
  rows; the delete dialog warns first when a booking is still ACTIVE (same
  warning as cancel — the rider still shows up unless cancelled on Lalamove).
- Account deletion cascades `deliveryJobs` + `deliveryQuotes` (new
  `by_retailer` index on quotes).
- Abandoned `deliveryQuotes` rows are purged daily
  (`purgeStaleCheckoutQuotes` cron, >24h old — far past the 30-min consume
  window).
- Buyer address edits are pending-only (`updateDeliveryAddress` guard), so an
  address can never change under an active rider booking — verified, not new.
- Webhook handler null-guards deleted/cancelled orders (acts on neither).
- Per-product fulfilment notice (`products.minNoticeDays`) raises the
  checkout date floor for made-to-order items — see
  docs/fulfilment-date.md; custom carts label the field "Requested date".
- Seller-side awareness: browser order alerts (new order + booking failed)
  — see docs/order-notifications.md.

## Collection service — Leg 1, rider collects FROM the buyer (86eyg0n8e)

Bearcamp (tent/gear cleaning) runs the trip in **reverse**: the rider picks
up at the **customer's address** and drops off at the seller's outlet. One
store-level switch flips the whole feature:
`retailers.deliveryBooking.deliveryDirection: "standard" | "collection"`
(undefined = standard — every existing seller; toggle lives in the Lalamove
settings section above prompt-on-packed). It sits on `deliveryBooking`, NOT
the ticket's `deliveryConfig.lalamove` arm, because pricing-mode switches
rebuild that arm wholesale while the booking object merges per-field
(`promptBookOnPacked` precedent) — so a month on Flat pricing and back can
never silently reset a collection store to standard. **Every branch is gated
on `=== "collection"`, so standard-direction stores are behaviourally
untouched.**

Three freezes, one setting:

- **`orders.deliveryDirection`** — stamped at create (pickupSnapshot
  posture) so buyer surfaces stay true if the store toggles later. Drives:
  checkout copy (section title "Collection address", "where should we
  collect from?" flavour intro, rider-fee expectation line, date question
  "When should we collect it?", fee lines "Collection"), the wa.me message
  ("🚚 Collect from:", "Collection fee:", "🗓️ Collect from me on:"), the
  WA confirm's method line ("We'll update you once collection from your
  address is arranged." EN/MS/ZH — packed/shipped/delivered defaults stay
  ship-flavoured on purpose: a collection store's real vocabulary is custom
  stages, e.g. collected → cleaning → ready), the tracking page ("Collect
  from", "Collection from your address", "We collect on", "Collection
  fee") and the seller order page ("Collect From"). The public slug payload
  carries the one-bit `deliveryCollectsFromCustomer` for checkout. **CSV is
  the deliberate exception**: the *Fulfilment* cell reads `collection`, but
  the header row is untouched (still "Delivery fee"). One export can hold
  both directions — a store that switched modes, and routinely once
  direction varies per order — so a per-row column NAME is impossible, and
  a seller's bookkeeping template keys on names. Value-level, not
  header-level.
- **`deliveryJobs.deliveryDirection`** — snapshotted at `reserveBooking` so
  the webhook obeys what was BOOKED, not the live setting.
- **Dispatch swap** — `dispatchContextForOrder` swaps stops AND contacts:
  origin/sender = buyer (same +60 fallback → seller number, buyer's real
  number in remarks), destination/recipient = the outlet. The checkout
  quote (`quoteForCheckout`) prices the same buyer→store direction (route
  prices aren't guaranteed symmetric), so buyer-paid fee and dispatch
  re-quote can't systematically drift.

**The webhook only moves the JOB on a collection booking.** `picked_up`
means "rider took the goods FROM the buyer" and `completed` means "they
reached the seller" — neither is shipped/delivered *to the customer*, so
order status stays the seller's to advance by hand (their custom stages
tell the story). Three side-channels are closed with it:

- **No `carrierTrackingUrl` mirror** (DRIVER_ASSIGNED + commitBooking): a
  later manual shipped-anchored advance would otherwise present the stale
  Leg-1 collection trip as shipment tracking. Instead the buyer gets the
  **live collection-rider strip** (3 Aug, Zaki's ask after first local
  test): while a job is ACTIVE, `orders.get` returns `collectionRider`
  (trip state, driver name + plate, Lalamove share link — never the
  driver's phone, cost or provider ids) and `/track` renders a transient
  card above the timeline ("Finding a rider…" → "{driver} is on the way to
  your address" + plate → "Collected — on the way to {store}"). It reads
  the live job row, so it can't go stale and vanishes the moment the trip
  ends — deliberately a strip, not a status: the order lifecycle stays the
  seller's. Verified against a real sandbox booking on dev.
- **POD photo is seller-only**: it shows the rider dropping the buyer's
  gear at the seller's own doorstep, so `fetchPodImages` skips the buyer
  WhatsApp follow-up and `orders.get` never exposes `podImageUrls` on
  collection orders (even after the seller manually marks delivered — the
  caption "taken by your rider at drop-off" would read as nonsense). The
  dispatch card keeps the thumbnails, labelled "kept for your records".
- **The manual-advance gate lifts** (`riderAutoUpdates` in order detail):
  the "moves to Shipped on its own" disabled-state would both lie and
  strand a collection seller. The mark-shipped rider prompt is also
  skipped — offering "book a rider" at the shipped moment would dispatch
  ANOTHER buyer→store collection; the return journey is **Leg 2, out of
  scope** (Bearcamp raises a separate order for it).
- **`orders.collectedAt`** — the webhook stamps WHEN the goods arrived (a
  timestamp, never a status change). It exists because a collection order's
  `fulfilmentDate` is the day the rider COLLECTS — the start of the seller's
  work, not a deadline — so the inbox/date badge would otherwise show red
  **"Overdue" for the entire healthy service window** on every collection
  order, and (being a strict priority list) would suppress every other
  contextual badge under it. Keyed on the goods arriving rather than on
  status, because a seller may anchor their own "Collected" stage at
  `confirmed`. Before collection a passed date still reads red — that
  genuinely means nothing came in. The same stamp gives the buyer a
  persistent "Collected on …" line once the live rider strip retires, so
  their page is never silent mid-service.
- **The seller cannot move a collection order until the goods arrive**
  (3 Aug, Zaki's second catch). On a collection order the rider brings the
  goods IN, so "packed" / "cleaning" / "ready" cannot be true beforehand —
  yet the stepper let him mark Packed with no rider even booked, and
  prompt-on-packed then offered to dispatch one, which is backwards
  (packing happens AFTER arrival). Now `isCollectionGateClosed`
  (`convex/lib/order.ts`, beside `isMockupGateClosed` and shaped like it)
  blocks every advance into a packed-or-later anchor while
  `deliveryDirection === "collection"` and `collectedAt` is unset.
  **Server-enforced on all three seller write paths** — `advanceToStage`
  and `updateStatus` throw, `bulkUpdateStatus` SKIPS (one ineligible order
  must not fail a batch, the mockup-gate posture) — with the stepper
  mirroring it as disabled-with-reason pointing at "Send rider to collect".
  Cancelling is never gated. The escape is **"I already have the items"**,
  for a seller who fetched them in person or whose webhook never reported:
  it rides `advanceToStage({ markCollected: true })`, which stamps
  `collectedAt` in the same transaction — so the question is asked once,
  not at every stage. **prompt-on-packed never fires on a collection
  order** and its ⚡ hint is hidden, since the promise it makes is one this
  flow must never keep. One-shot `orders:backfillCollectionCollectedAt`
  stamps orders whose rider completed before the field existed (dev only —
  production has no collection orders yet; ran on dev 3 Aug, 1 stamped).
  Standard delivery is untouched by construction: the predicate is false
  for every non-collection order (verified against all 130 dev orders).
- **A completed collection is TERMINAL for the card** (`collectionDone`,
  3 Aug — bug found by Zaki in local testing). Because the order never
  advances, it sits at confirmed/packed forever, so `bookable` stayed true
  and the card re-offered "Send rider to collect" after the goods had
  already arrived — a second, paid, pointless trip. Worse, the
  prompt-on-packed effect had the same hole: marking the collected order
  **Packed** (the natural next step in a wash workflow) would have
  AUTO-OPENED the booking dialog. Both are now stopped on
  collection + `job.status === "completed"`; a **failed** collection still
  offers Rebook (no rider ever came), and standard orders are untouched
  (they self-close by reaching `delivered`). The settled card answers the
  question that state raises — "how do I get it back to them?" — with the
  honest Leg-2 answer: book the return in your own Lalamove app, since a
  return order raised here would just be another collection.

Seller card copy flips throughout ("Lalamove Collection", "Send rider to
collect", pills Finding rider → Heading to customer → Collected → Arrived,
"Buyer paid for collection"). Pricing (`resolveDeliveryQuote`) is untouched
— distance is symmetric; `deliveryFeePending`, radius/flat modes and the
no-fee-pending-under-Lalamove rule all apply unchanged.

## Sandbox E2E — verified 21 Jul 2026

Real sandbox pass with test keys (then platform-env-based; the same keys
now simply live on a retailer row as BYO): webhook URL registered via API → quote
(KLCC→PJ, RM13.30 → 1330 sen, stopIds, 18.3 km) → order placed (shareLink
returned at create, status `ASSIGNING_DRIVER`) → GET → cancel (204). All
request signing accepted first try; webhook events landed at the dev route
and verified under the `data` variant. Remaining before prod: driver-status
progression (sandbox has no riders — `PICKED_UP`/`COMPLETED` paths are
covered by hand-signed-payload tests in `convex/lalamove.test.ts`; first
prod booking is the live confirmation), and Fruit Hut's own account: Naim
registers, tops up his wallet, pastes his `pk_prod_` keys into Settings →
Fulfilment and registers the prod webhook URL in his Partner Portal
(Arif walks him through it — subtask `86eyb5w24`; the vendor guide is the
handout).

## Local testing — driving a booking through its lifecycle

Lalamove's sandbox never dispatches a rider, so `PICKED_UP` / `COMPLETED`
(and our `shipped` / `delivered` auto-transitions) never fire naturally.
`scripts/lalamove-simulate-webhook.mjs` replays a **signed** webhook to your
deployment so you can walk a booking forward by hand. It's **sandbox-only**
— it refuses to run unless `LALAMOVE_API_KEY` is a `pk_test_…` key, so it
can never touch production.

Supply the same sandbox key/secret the test store has saved (the signature
must match what the webhook route verifies) via `--key`/`--secret` flags or
env vars, then pass the booking's `deliveryJobs.providerOrderId` (Convex
dashboard → Data → `deliveryJobs`):

```bash
# after tapping "Book delivery" on a confirmed delivery order:
node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs <providerOrderId> driver \
  --key pk_test_xxxx --secret sk_test_xxxx
# then: ON_GOING → PICKED_UP (order → shipped) → COMPLETED (order → delivered)
```

Failure paths: `CANCELED` / `EXPIRED` / `REJECTED` (job fails + one-tap
rebook); `POD` fires the proof-of-delivery trigger (sandbox has no rider
photo, so the fetch comes back empty — the photo path is a
first-prod-booking check). `PICKED_UP` / `COMPLETED` really message the
order's buyer number — book a test order with your own number to see them
land.

To actually see the **POD photo** on its three surfaces (buyer WhatsApp,
buyer tracking page, vendor card) without a real rider, inject a stand-in
through the same pipeline — no Lalamove credentials needed:

```bash
npx convex run lalamove:devInjectPodImage '{"providerOrderId":"<providerOrderId>"}'
```

Full step table, credential rules + the POD injector: [`dev-scripts.md`](./dev-scripts.md).

## Follow-ups (named, not built)

- Low-balance banner from `WALLET_BALANCE_CHANGED` (store last-known
  balance, warn before a booking ever fails).
- Prompt to cancel the Lalamove job inside the order-cancel flow (today the
  job card's cancel button is the path).
- Multi-outlet origin (per-dispatch origin picker) — dispatch already reads
  the origin from one resolver point.
- DelyvaX as provider #2 (parcel couriers / courier choice).
- Vendor onboarding guide (PDF): drafted with real Partner Portal
  screenshots; finalize once Kedaipal-side settings screenshots exist.
- Collection Leg 2 (return journey after the seller's work) — today a
  separate manual order; a "book return trip" that clones the order with
  the direction flipped is the natural v2.
- Per-product collection flag for mixed catalogs (a store selling goods
  AND a collection service): `products.collectionService` constrains the
  cart (no mixing directions in one order — one order = one trip) and
  `orders.deliveryDirection` derives from the items instead of the store
  toggle. Everything at the order/job layer is already direction-keyed, so
  this slots in without rework. Tracked in ClickUp; build when the first
  real mixed-catalog seller appears.
