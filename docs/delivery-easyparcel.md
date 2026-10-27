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
   `courierOAuthStates` row — crypto-random `nonce`, 10-minute TTL — and
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
   (sign-in took >10 min), `failed` — is written on the state row, and the
   card states it on return. No URL parameters.

The pickup address EasyParcel holds is imported as a **prefill** (fill-if-unset,
same-country only); a reconnect keeps the seller's own address and switch.

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

**Sandbox vs live:** no API response reports it. `environment` is set only if
the token itself is a JWT carrying the claim (`tokenEnvironment`); otherwise it
is unknown and rendered as unknown — never as live. The account name on the
card is the human check.

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
{MY: false, SG: true}` — MY stays closed (the 29 Jul 2026 frozen-prohibition
finding; Delyva serves MY incl. cold chain); the MY column exists for the
cross-border lane (z8r3fdr5yy). Account deletion clears both tables.

## Why the Open API (not the legacy Individual API)

The legacy API needed each seller to copy a key from their dashboard, had no
webhooks (status was polled), no cancel endpoint, and a separate pay step that
could leave an unpaid order orphaned in the seller's dashboard. The Open API
replaces all four with a sign-in, pushed status, a refunding cancel and a
single book-and-charge call — and it is the generation EasyParcel's developer
platform issues credentials for.

## Follow-ups

- **Webhook signing** — ask EasyParcel whether they sign deliveries; if so,
  verify in the route (the refetch design stays as defence in depth).
- **Wallets** — `courierWallets` is Lalamove-shaped (fingerprint-attributed
  push events); generalising it would put EasyParcel on the Deliveries page
  and the Home low-wallet banner. Today the balance lives on the connection
  row and shows on the settings + dispatch cards.
- **Checkout live-quote** via EasyParcel (`convex/liveQuote.ts`).
- Brand mark asset and a print-ready setup guide page (`public/guides/`).
