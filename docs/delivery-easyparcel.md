# EasyParcel — Singapore parcel courier booking (Open API)

> **Status:** built Oct 2026 (ClickUp
> [z8r3fdcje2](https://app.clickup.com/t/z8r3fdcje2)), PR2 of the pair that
> started with the courier provider registry
> ([courier-providers.md](./courier-providers.md)). Built on EasyParcel's
> **Open API 2026-09** (OAuth). An earlier draft targeted the legacy
> "Individual API" (pasted per-seller key, form-encoded `?ac=` actions); it was
> rebuilt before merge once the developer platform was confirmed as the
> current generation — see "Why the Open API" below.

The SG parcel lane: what Delyva is for Malaysia, EasyParcel is for Singapore
stores — J&T, SingPost, Qxpress, Ninja Van, Teleport and more, booked from the
order page on the **seller's own EasyParcel account and prepaid wallet**.
Kedaipal never books or pays on a seller's behalf. Delyva's SG tenant ships an
empty service catalogue, so **Delyva SG retired** in the same change
(`COUNTRY_COURIER_BOOKING.delyva.SG = false`); SG sellers see one parcel
aggregator.

## The API

Reference: **easyparcel.github.io/OpenAPI** (the Developer Hub at
developer.easyparcel.com is the app console, not the docs). Pure wire logic is
[`convex/lib/easyparcel.ts`](../convex/lib/easyparcel.ts); OAuth, tokens,
network and the `deliveryJobs` ledger are
[`convex/easyparcel.ts`](../convex/easyparcel.ts).

- **One host, JSON, Bearer:** `https://api.easyparcel.com/open_api/2026-09/…`
  for every country and both environments.
- **OAuth 2.0 authorization code.** Kedaipal registers ONE app per Convex
  deployment (client id + secret); each **seller** signs in at EasyParcel,
  picks which of their accounts (Live or Demo) Kedaipal may book with, and
  allows. The token is bound to that account.
- **Batch-shaped answers:** HTTP 200 even when an item fails — every parser
  reads the item's `status`, never the HTTP code. Four different 401 bodies
  are documented, so auth is judged on the HTTP 401 itself.
- **Submit books AND charges** the prepaid wallet in one call — there is no
  pay step.
- **Webhooks exist and are UNSIGNED** (the docs define no signature).

## Configuration (operator)

| Where | What |
|---|---|
| Convex env (per deployment) | `EASYPARCEL_CLIENT_ID`, `EASYPARCEL_CLIENT_SECRET`. Absent ⇒ the integration is off on that deployment: every EasyParcel surface hides (`not_configured`), nothing half-works. `CONVEX_SITE_URL` + `SITE_URL` are already set everywhere. |
| Developer Hub → app → Configuration | **Allowed Redirect URI** = `https://<deployment>.convex.site/oauth/easyparcel/callback`. Platform URL: the app's homepage (field undocumented by EasyParcel). |
| Developer Hub → app → Webhook | URL `https://<deployment>.convex.site/webhook/easyparcel`, topics `shipment.status.update`, `shipment.awb.update`, `shipment.tracking.update`. Register only AFTER the route is deployed — the hub validates the URL on save. |

**One app per deployment.** Webhooks are configured per APP, and dev and prod
Convex deployments have different site URLs, so the dev app ("Kedaipal Dev")
and the production app are separate registrations with separate secrets. The
same app serves both Live and Demo seller accounts — the environment is chosen
per connection, not per app. A production app is needed for real sellers to
connect at all: in OAuth the app credentials are Kedaipal's, and sellers
authorize it.

## Connect

1. **Settings → Integrations → EasyParcel → Connect EasyParcel** calls
   `startConnect`, which (Pro-gated, country-gated, configured-gated) mints a
   `courierOAuthStates` row — crypto-random `nonce`, 30-minute TTL (EasyParcel's own sign-in state lives 30 minutes, and a new seller may sign up mid-flow) — and
   returns EasyParcel's sign-in URL. `returnTo` is the card's own URL, pinned by
   `allowedReturnTo`: the app's SITE_URL origin always; localhost origins only
   when SITE_URL is itself localhost (dev worktrees each run their own port).
2. EasyParcel sends the browser to **`GET /oauth/easyparcel/callback`**
   (`convex/http.ts` → `completeConnect`). The state redeems **exactly once**
   (a replayed or forged callback never reaches the token exchange); the code
   is exchanged server-side with HTTP Basic client auth; account info + wallet
   are read; tokens are `enc.v1.`-encrypted in the action and stored in
   **`easyparcelConnections`**; the browser is 302'd back to `returnTo`.
3. Every outcome — `connected`, `denied` (the seller declined), `expired`
   (sign-in took >30 min), `failed` — is written on the state row, and the
   card states it on return. No URL parameters.

The pickup address EasyParcel holds is imported as a **prefill** (fill-if-unset,
same-country only); a reconnect keeps the seller's own address and switch.

**Connecting arms booking; the switch pauses it.** A first connect stores
`enabled: true` (the Delyva posture). The on/off lives where every courier's
does — **Settings → Delivery pricing → Courier booking**, an "EasyParcel
couriers" row beside Lalamove/Delyva (`courier-booking-section.tsx`), and the
Fulfilment row's glance names it while it's armed (`easyparcelBookingOn`, the
client mirror of `easyparcelBookingArmed`). Switching it on is Pro-gated;
switching it off never is. Signed out at EasyParcel's end (`needsReconnect`),
the row reads **Paused** with a reconnect link rather than a switch that
claims "on". EasyParcel never quotes the buyer's live charge, so it is never
the "last live bidder" that locks Lalamove on, and it doesn't wait on parcel
weights (the dispatch card asks per order). The Integrations "N of M" counts
the card wherever the card shows (`easyparcelCardShown`).

**Why a table, not `retailers.easyparcel`:** the access token refreshes every
~10h and the wallet snapshot moves on every booking — a retailer patch re-runs
every open storefront tab; tokens stay off every retailer read; and new
`retailers` fields break other branches' deploys to the shared dev deployment.
`storeBooksCouriers` callers load the one-bit summary with
`loadEasyparcelArming` (`convex/lib/easyparcelArming.ts`).

## Tokens

`withToken` (in `convex/easyparcel.ts`) refreshes **ahead of** expiry
(5-minute skew) and once more on any 401. Expiry is computed from
`expires_in`, never the response's `expires_at` (the documented sample's
timestamps disagree with its own durations). A refresh EasyParcel refuses
stamps **`revokedAt`** — after a re-read, because a concurrent action may
already have rotated the token being held. A dead grant makes dispatch block
with `reconnect_needed` and the card read **Reconnect needed**; a fresh connect
clears it. A refresh that doesn't rotate the refresh token keeps the old one.

**Sandbox vs live:** no API response reports it, and EasyParcel's sign-in
never asks — its account picker offers **"SG or MY"**, not "sandbox or live".
`connectionEnvironment` reads a JWT claim when the token has one, else the
account **name** (EasyParcel names sandbox accounts "… Sandbox Account" in the
Developer Hub); anything else is unknown and rendered as unknown — never as
live. The account name on the card is the human check.

**Sandboxes: one per login, in the login's home country (found 28 Oct 2026,
/test-code).** The Developer Hub's *Account Connection → Add New Connection*
creates a single sandbox per EasyParcel login ("App has already been installed
in this account" on a second try), and the tester's came out a **ringgit (MY)**
account. EasyParcel's sign-in lists every account under the login — MY
business, SG business, and the sandbox — so picking "SG" connected the **live**
SG account (real courier prices; only a S$0 wallet stood between the run and a
real courier). **What works:** connect the MY sandbox to the SG store. It
quotes and books SG-to-SG services normally, priced and charged in RM test
credit — the full book → label → cancel → refund loop ran on it. Its shipment
status never advances (EasyParcel's docs), so Collected → Delivered was
exercised through `applyStatusSync`, the function the webhook re-read and the
hourly sync feed, which proves everything after the status read.

**The account must belong to the store's country — sandboxes excepted.** An
account's country isn't in the account read; its **wallet currency** is
(`accountCountryFromCurrency`). `completeConnect` refuses a LIVE account from
the other country before storing anything, naming the row to pick instead;
`dispatchBlockReason` returns `wrong_country` for one connected before the
check existed. A sandbox from the other country is allowed — it's the only way
to test SG — and the card says its prices are in RM.

## Dispatch

`EasyparcelDispatchCard` (order page) — the Delyva card's sibling:

- **Weight + box** set the price. Weight is seeded from product weights
  (`summarizeCartWeight`, the same rule as weight/zone pricing and Delyva);
  the **box** (S 20×15×10 / M 30×25×15 / L 40×30×25 cm) exists because the API
  requires dimensions and couriers bill volumetric weight. Changing either
  drops stale prices.
- **`/shipment/quotations`** → inline picker, cheapest first, priced at what the
  SELLER pays (`seller_payable_amount`). Pickup vs drop-off is named per
  service, with a note when the seller must drop the parcel at a point.
- **What a service promises is read, not guessed** (`describeEasyparcelService`,
  /test-code F9–F13). The quote has no structured field for where the BUYER
  receives the parcel or for a minimum parcel count, and `delivery_duration`
  arrives null; every SG service name carries them in one convention —
  `Ninja - Standard [1-3 Days] (Pick Up) (From Door to Door | 5 MOQ)`. The
  structured `service_tag` wins when present, then the name; neither saying
  means the fact is undefined and the card claims nothing. The row shows a
  clean label plus chips — **Buyer collects at a point**, **Pickup needs N+
  parcels**, **May miss / Arrives after <buyer's date>** — so a phone never
  truncates the part that matters.
- **Pre-selection keeps the order's promise** (`defaultRateId`,
  `src/lib/easyparcel-rates.ts`): the cheapest service that reaches the door,
  takes one parcel and makes the buyer's date; else the cheapest door service;
  else the cheapest. The trap it closes: on the first live quote the cheapest
  was *Point to Point* — a delivery order would have been parked at a locker.
- **20+ services, the cheap end first.** A quote holding both door and point
  services splits them (`To the buyer's door (n)` / `Buyer collects (n)`, the
  latter warning the buyer chose delivery); six rows show, the rest behind
  **Show all N**, and the pick always stays on screen.
- **Booking copy follows the pick**: a drop-off service says to drop it at a
  point; only a pickup service says EasyParcel arranges collection today.
- **After booking**, the card shows the clean service label, and a **drop-off**
  booking states the seller's next job ("Next: drop the parcel off" — print the
  label, hand it in at the courier's point) until the courier scans it in. A
  booked job keeps only the service NAME, so the drop-off fact is read from it
  (`sellerHandoff`). Delivered says the buyer's order page shows it — never
  that the buyer was "notified" (one message per order). A seller-cancelled
  booking offers **Book again**; the cancel dialog's way out reads **Keep
  booking**.
- **The wallet rides the quote**: a pick it can't cover is amber and Book is
  disabled-with-reason. `confirmBooking` re-reads the wallet and refuses
  server-side too.
- **`/shipment/submit_orders`** after reserving the order's single booking slot
  (cross-provider). `providerOrderId` = the **`shipment_number`** (ES-…),
  which details, cancel and webhooks all key on; the reference is the order
  shortId. An item-level refusal releases with EasyParcel's own words; a
  failure we can't classify AFTER the request left (timeout, 5xx) may still
  have booked, so the reservation releases with "check your EasyParcel
  dashboard for <shortId> before booking again".
- The **AWB, the courier's label PDF** (A6 preferred) and EasyParcel's tracking
  link mirror fill-if-unset onto the order (86eyehvk4); when the AWB isn't
  issued at submit, a re-read is scheduled at +60s as a backstop to the AWB
  webhook.
- **Cancel** is real: `/shipment/cancel`, refunded to the wallet. EasyParcel's
  own refusal sentence (e.g. "cancellation period is over (7 days from
  collection date…)") is shown verbatim.
- Every block names its fix (`easyparcel-dispatch-block.ts`); `not_configured`
  and `country_unsupported` hide the card, `reconnect_needed` shows it with a
  Reconnect link.

## Status — webhooks are nudges

`POST /webhook/easyparcel` takes **only the shipment number** from the body
(`parseWebhookShipmentNumber`), finds the job via `by_provider_order`,
rate-limits per job (`easyparcelWebhookSync`), and schedules **`syncJob`** —
a `/shipment/details` re-read with the seller's own token. Only the re-read is
applied (`applyStatusSync`). A forged event can at most cause one extra read; a
forged "delivered" moves nothing. The route always answers 200 fast
(EasyParcel's 30-second rule), and `GET` answers 200 too for the hub's
save-time probe.

`applyStatusSync` keeps the webhook-apply contract: idempotent, the job
follows provider truth, the ORDER never regresses (`picked_up` → shipped with
the AWB, `completed` → delivered, behind SHIPPABLE_FROM / DELIVERABLE_FROM),
a seller-cancel story is never rewritten, On Hold (8) states a reason and
moves nothing. Status codes: 7/2 → assigning, 3/11/4 → picked_up,
5 → completed, 0 → canceled, 6 → rejected (returned); unknown codes move
nothing.

Backstops: an **hourly cron** re-reads every active easyparcel job (the
`by_provider_status` index), and the card has **Refresh status**.

**Sandbox caveat (EasyParcel's own docs):** shipment status never updates in
sandbox, so shipped/delivered auto-transitions can only be exercised by tests
and simulated reads, not a sandbox booking.

## Gating

Connect / enable: Pro (`PLAN_FEATURES.delivery`) + active subscription;
disconnect, pause and cancel never are. `prepareBooking`/`confirmBooking`
carry the per-order credit gate (`creditLockCoverage.test.ts` classifies the
module); view-only stores are refused on every write
(`sellerLockCoverage.test.ts`). Country: `COUNTRY_COURIER_BOOKING.easyparcel =
{MY: true, SG: true}` with `COURIER_DESTINATIONS.easyparcel = {MY: "abroad",
SG: "both"}` — a MY store books EasyParcel for its OVERSEAS orders only (the
cross-border lane, z8r3fdr5yy); MY domestic stays Delyva (the 29 Jul 2026
frozen-prohibition finding, cold chain, commission), and a MY domestic order
reads `destination_unsupported`. The card shows on a MY store only once an
overseas lane is saved. See [cross-border.md](./cross-border.md). Account
deletion clears both tables.

## Why the Open API (not the legacy Individual API)

The legacy API needed each seller to copy a key from their dashboard, had no
webhooks (status was polled), no cancel endpoint, and a separate pay step that
could leave an unpaid order orphaned in the seller's dashboard. The Open API
replaces all four with a sign-in, pushed status, a refunding cancel and a
single book-and-charge call — and it is the generation EasyParcel's developer
platform issues credentials for.

## Brand mark

`public/img/easyparcel-logo.svg` is EasyParcel's own `logo_horizontal.svg`
(`easyparcel.com/sg/wp-content/uploads/2022/03/`), untouched — marks are never
redrawn or recoloured. It renders through **one component**,
`EasyparcelLogo` (`src/components/ui/easyparcel-logo.tsx`); a test fails if any
other file references the asset, the same rule as `DelyvaLogo`. It is a single
brand pink that reads on light and dark cards, so unlike Delyva's black ink it
needs no dark-mode plate. Surfaces: the Integrations card header (wordmark +
`sr-only` heading), the Courier booking row, and the landing dispatch badge.
The order's dispatch card stays text-only, like the Delyva and Lalamove ones.

## Follow-ups

- **Webhook signing** — ask EasyParcel whether they sign deliveries; if so,
  verify in the route (the refetch design stays as defence in depth).
- **Wallets** — `courierWallets` is Lalamove-shaped (fingerprint-attributed
  push events); generalising it would put EasyParcel on the Deliveries page
  and the Home low-wallet banner. Today the balance lives on the connection
  row and shows on the settings + dispatch cards.
- **Checkout live-quote** via EasyParcel (`convex/liveQuote.ts`).
- A print-ready setup guide page (`public/guides/`).
