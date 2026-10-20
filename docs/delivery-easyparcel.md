# EasyParcel — Singapore parcel courier booking

> **Status:** built Oct 2026 (ClickUp
> [z8r3fdcje2](https://app.clickup.com/t/z8r3fdcje2), PR2 of the pair that
> started with the courier provider registry —
> [courier-providers.md](./courier-providers.md)). **Sandbox E2E is pending**:
> EasyParcel demo credit is a manual support top-up on a real account, so the
> wire shapes are verified against their docs + their own WooCommerce plugin
> source, and the first live run happens once the dev account exists.

The SG parcel lane: what Delyva is for Malaysia, EasyParcel is for Singapore
stores — J&T, SingPost, Qxpress, Ninja Van SG, Teleport and more, booked from
the order page on the seller's own EasyParcel account (BYO, locked posture:
no Kedaipal master account, no float). Delyva's SG tenant ships an empty
service catalogue, so when this landed, **Delyva SG retired**
(`COUNTRY_COURIER_BOOKING.delyva.SG = false` — the registry entry holds the
history) and SG sellers see exactly one parcel aggregator.

## The API (legacy "Individual API")

Verified 20 Oct 2026 against developers.easyparcel.com (MY Individual
1.4.0.0, SG Individual 1.1.0.0) and the `easyparcel-shipping` WooCommerce
plugin source. Everything wire-shaped lives in
[`convex/lib/easyparcel.ts`](../convex/lib/easyparcel.ts) (pure, unit-tested);
[`convex/easyparcel.ts`](../convex/easyparcel.ts) owns auth, network and the
`deliveryJobs` ledger.

- **Hosts:** one platform per country (`connect.easyparcel.sg` / `.my`), and
  a separate DEMO host per country (`demo.connect.easyparcel.*`). Same key
  format on both — **which host authenticates the key is how `isDemo` is
  resolved** at connect (production first, demo on an auth-class refusal).
- **Transport:** POST `application/x-www-form-urlencoded` in PHP
  `http_build_query` bracket notation (`bulk[0][pick_code]=…`) to
  `{host}/?ac={Action}`; auth is the `api` field. JSON is not accepted on the
  standard actions. Prices arrive as strings in major units (`"8.00"`).
- **Flow:** `EPRateCheckingBulk` (service list with prices) →
  `EPSubmitOrderBulk` (creates the order, returns `order_number`) →
  `EPPayOrderBulk` (pays from the PREPAID wallet; returns `awb`,
  `awb_id_link` — **the courier's label PDF** — and, on MY, `tracking_url`).
- **SG shape differences the builders encode:** no state tier at all in rate
  checks; submit takes `pick_unit`/`send_unit` and the literal
  `send_state: "Singapore"` (their own plugin's behaviour); 6-digit
  postcodes; thinner responses (no `rate_id`, no dropoff points, no
  `tracking_url` on pay).
- **MY state codes:** error 1005 is explicit that `*_state` takes Appendix
  III codes (`sgr`, `png`…), never names — `MY_EASYPARCEL_STATE_CODES` maps
  our canonical state names, kept current so the future MY lane
  (cross-border, z8r3fdr5yy) is a registry flip, not a rebuild.
- **Failures carry machine codes** (Appendix I): 3/4/5/8/9 auth, 1004/1005
  address, plus the one message-shaped verdict — pay's
  `"Insufficient Credit"` arrives INSIDE a Success envelope
  (`messagenow` is the verdict).

## Connect (Settings → Integrations → EasyParcel)

One pasted **Individual API key** (seller's own dashboard → Integrations →
Add New Store → API Key → Individual API). `easyparcel.connect` validates it
with `EPCheckCreditBalance` (their plugin's own auth ping), resolves
`isDemo` by host, stores the key `enc.v1.`-encrypted in the action (no
plaintext ever lands), and snapshots the wallet balance + currency for the
card. The card: 2-step setup checklist (account, pickup address — there is
no webhook step because the API has none), a **Wallet** section with refresh
(prepaid is the first thing that fails), the demo banner at the account step
and again at the point of spend (86eypncfy posture), and the **ambient-only
constraint said out loud** — EasyParcel prohibits chilled/frozen goods, the
reason it lost the MY evaluation to Delyva in Jul 2026.

The pickup address is its own structured field (unit + street + postcode for
SG), never a parse of `businessAddress`. `name`/`contact` are not stored on
it: submit takes them per-order from the store name + seller WhatsApp number.

## Dispatch (order page)

`EasyparcelDispatchCard` is the Delyva card's sibling: inline price-sorted
courier picker (no quotation id to hold, so no countdown), weight editable in
place (seeded from product weights via the same `summarizeCartWeight` the
weight/zone pricing uses), pickup summary + buyer-contact fallback said
before the first quote, empty list = a normal answer that hands off to the
manual-courier flow. EasyParcel-specific:

- **The wallet rides the rate list.** The quote response carries the balance
  snapshot; a pick the wallet can't cover turns the line amber and disables
  Book with the reason (the server re-reads the live balance and refuses
  too — belt and braces, because `EPPayOrderBulk` on an empty wallet leaves
  an UNPAID order in the seller's EasyParcel dashboard that no courier will
  ever collect).
- **Book = submit + pay in one tap.** A pay that still comes back unpaid
  RELEASES the reservation with the EasyParcel order number in the message
  (top up and rebook here, or cancel it in EasyParcel) — never a dangling
  active job. The AWB + label PDF + tracking URL mirror fill-if-unset onto
  the order's manual-courier fields (86eyehvk4), so a hand-typed entry is
  never overwritten.
- **The courier label PDF** (`awb_id_link`) links on the card — the first
  provider that gives us a real courier AWB (the deferred half of
  [despatch-labels.md](./despatch-labels.md) v2; Kedaipal's own despatch
  label is unchanged and still prints).
- **Cancel is honest.** The Individual API documents no cancel, so the card
  never pretends one: "Cancelled it in EasyParcel?" opens a dialog that says
  to cancel in their dashboard first, then marks the job cancelled here
  (which frees the order's one-booking slot).

The dispatch hub takes its providers from the registry — with three armed it
renders a 3-tab strip; a live booking's provider always wins the default and
other tabs show the one-booking-at-a-time notice.

## Status: polled, not pushed

No webhook exists on this API (a "Subscribe Webhook" link in their MY doc
points at an undocumented Postman collection — worth revisiting if it turns
real). Instead:

- A **30-minute cron** (`sync easyparcel job statuses`) sweeps active
  easyparcel jobs via the `deliveryJobs.by_provider_status` index, one
  `EPParcelStatusBulk` per retailer (bulk ≤300), applied through
  `applyStatusSync` — the `applyWebhookEvent` contract: idempotent, job
  follows provider truth, ORDER never regresses (`picked_up` → shipped with
  the AWB attached, `completed` → delivered, both behind the
  SHIPPABLE_FROM/DELIVERABLE_FROM guards), a seller-cancel story is never
  rewritten by a later poll, "On Hold" surfaces a reason without moving
  anything.
- The card's **"Refresh status"** polls one order on demand, so nobody waits
  half an hour on purpose.
- `ship_status` vocabulary → our `DeliveryJobStatus` in
  `normalizeEasyparcelShipStatus` (unknown strings move nothing — their enum
  can grow). `Expired (Unpaid)` → `expired`; `Returned` → `rejected`.

## Gating

Same posture as every courier: connecting/enabling is Pro
(`PLAN_FEATURES.delivery`), disconnecting/pausing never is, dispatch blocks
with the typed reason (`plan_gated` included) before any spend, and
`prepareBooking`/`confirmBooking` carry the per-order credit gate
(`creditLockCoverage.test.ts` classifies the whole module). Country gate:
`COUNTRY_COURIER_BOOKING.easyparcel = {MY: false, SG: true}` — MY is closed
on purpose (frozen prohibition + Delyva already serves MY incl. cold chain);
the MY column exists for the cross-border lane.

## Operator setup (dev/sandbox)

1. Register a free EasyParcel **SG** account (easyparcel.com/sg).
2. Dashboard → Integrations → Add New Store → API Key → **Individual API**.
3. Ask support (live chat/email) for **demo credit** on the Sandbox
   Environment — a manual top-up they confirm. The demo host pair is
   `demo.connect.easyparcel.sg` / `.my`.
4. Rate checks are free even in production; only submit/pay spend.

## Deliberate scope edges / follow-ups

- **No checkout live-quote yet** — SG stores price delivery flat or
  live-via-Lalamove; adding EasyParcel to `convex/liveQuote.ts` (postcode +
  weight-based buyer pricing) is the natural next slice once the booking
  lane has run live.
- **Marketplace API** (EasyParcel's platform-level integration — sellers
  connect under one Kedaipal registration instead of pasting keys) is the
  onboarding upgrade; requires registering with their integration team.
- **No print-ready setup guide page yet** (`public/guides/` parity with
  Delyva/Lalamove) and no brand mark under `public/img/` (marks are never
  redrawn — the card and landing badge carry the name until the approved
  asset lands).
- **Collect date** is left to EasyParcel's default (today); a pickup-date
  picker in the dispatch dialog is a follow-up if sellers ask.
