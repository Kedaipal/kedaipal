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
third arm `{ mode: "lalamove", onUnquotable: "arrange" | "block" }` next to
`flat`/`radius`, all resolved by the same pure `resolveDeliveryQuote`
(`convex/lib/delivery.ts`). **Pricing and booking are orthogonal**: a seller
can charge a flat fee yet still book riders (absorbing drift); live-quote
pricing additionally requires booking to be enabled (its vehicle +
credentials price the quote).

| Piece | Where |
| --- | --- |
| Pure client (HMAC signing, payload builders, RM→sen, status maps, credential resolver) | `convex/lib/lalamove.ts` |
| Webhook signature verification | `convex/lib/lalamoveSignature.ts` |
| Convex functions (network client, checkout quote, dispatch, webhook handler) | `convex/lalamove.ts` |
| Webhook route | `convex/http.ts` `POST /webhook/lalamove` |
| Buyer checkout wiring | `src/components/storefront/checkout-sheet.tsx` |
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

The reactive `delivery.quote` query answers `{ kind: "live", onUnquotable }`
for lalamove-mode stores; the checkout then calls the
`lalamove.quoteForCheckout` **action** once per picked address AND per
chosen date (debounced,
rate-limited per retailer — the quote-by-coordinates oracle gets the same
trilateration caution as the radius quote). The action records the fee in a
`deliveryQuotes` row and returns `{ quoteId, fee }`; **`orders.create` only
ever accepts the row id** — coordinate-matched (±~11 m), ≤30 min old,
consumed on use — so the browser can display the fee but never dictate it.
Missing/stale/mismatched quote → the store's `onUnquotable` policy:
`arrange` → the existing `deliveryFeePending` hold (payment ask held, seller
confirms the charge — same machinery as radius out-of-range), `block` →
checkout refused with clear copy. Kill switch: no credentials/config → the
quote query never says "live" and checkout behaves exactly as before.

**Pre-orders are priced for THEIR day (23 Jul):** when the buyer picks a
future fulfilment date, the quote is requested with Lalamove `scheduleAt` =
noon MYT on that day (the hour barely moves the price; the day can), so the
locked buyer fee reflects the delivery day, not checkout day. Changing the
date re-quotes exactly like changing the address. Today = immediate
pricing; the scheduleAt guard caps at Lalamove's ~30-day window and falls
back to immediate on anything odd. Dispatch on the day still re-quotes
immediate — variance is the vendor's, as everywhere.

Note: a buyer address edit (`updateDeliveryAddress`) re-prices through the
same resolver *without* a live quote, so under lalamove pricing it lands
fee-pending for the seller to confirm — deliberate (an address change means
the old price is wrong, and mutations can't fetch).

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
absorbs it); `confirmBooking` places the order within the 5-minute window
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
credentials, missing buyer/seller phone. Wallet-empty
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
| `WALLET_BALANCE_CHANGED` | vendor wallet balance moved | logged only (proactive low-balance banner = named follow-up) | — | — |
| `ORDER_CREATED` (undocumented but real) | at booking | logged only | — | — |

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
order just stays where it is until the seller advances it by hand. Dev
deployment URL: `https://qualified-chihuahua-441.convex.site/webhook/lalamove`.

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
must match what the webhook route verifies), then pass the booking's
`deliveryJobs.providerOrderId` (Convex dashboard → Data → `deliveryJobs`):

```bash
export LALAMOVE_API_KEY=pk_test_xxxx
export LALAMOVE_API_SECRET=sk_test_xxxx
# after tapping "Book delivery" on a confirmed delivery order:
node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs <providerOrderId> driver     # rider + tracking link
node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs <providerOrderId> ON_GOING   # "Rider on the way"
node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs <providerOrderId> PICKED_UP  # order → shipped  (real WhatsApp to buyer)
node --env-file=.env.local scripts/lalamove-simulate-webhook.mjs <providerOrderId> COMPLETED  # order → delivered (real WhatsApp to buyer)
```

Failure paths: `CANCELED` / `EXPIRED` / `REJECTED` (job fails + one-tap
rebook). `PICKED_UP` / `COMPLETED` really message the order's buyer number —
book a test order with your own number to see them land.

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
