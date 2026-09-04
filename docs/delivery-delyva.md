# Delyva courier booking (86eyjpv6z)

Nationwide **parcel + cold-chain** courier dispatch through [Delyva](https://delyva.com)'s
aggregator API — the second provider behind the `deliveryJobs` seam, **additive
to Lalamove** ([delivery-lalamove.md](./delivery-lalamove.md)), never a
replacement. Lalamove = intra-city on-demand rider; Delyva = outstation
parcels and chilled/frozen goods (Walid, Haziq, WaDaFish, the frozen ICP).

Provider decision (Arif, 29 Jul 2026): Delyva over EasyParcel — EasyParcel
prohibits frozen goods. Verification history on ClickUp `86eyexp7p`.

## Commercials — the `source: "kedaipal"` attribution

Confirmed with Herrey (Delyva, Aug 2026): Delyva pays Kedaipal **1% per
confirmed/completed delivery order**, Delyva-funded — the seller pays the same
rate as booking direct in the Delyva app; no take-rate on sellers. The
commission only tracks when **`source: "kedaipal"` rides every
`POST /order`** — it is hardcoded in `buildCreateOrderBody`
(`convex/lib/delyva.ts`) and covered by a test, because dropping it is
invisible breakage: bookings keep working, the revenue silently stops.

## Model — BYO account, one API key

Same posture as Lalamove/HitPay: the **seller's own Delyva account**, booked
against the seller's credit. Kedaipal never holds float, never rebills, never
touches refunds.

The connect flow deviates from the ticket's "apiKey + apiSecret" AC on
purpose (locked 27 Aug): Delyva authenticates every API call with a **single
key** (`X-Delyvax-Access-Token`), and everything else is fetchable with it —
so the seller pastes **one key** and `delyva.connect` does the rest:

1. `GET /user` — validates the key, yields `apiSecret` (the webhook HMAC
   secret — the seller never sees or types it) and `companyId`.
2. `GET /customer` — yields the integer `customerId` that quote/order
   payloads require, and the account display name for the settings card.
3. Both secrets are encrypted (**`enc.v1.` envelope, in the action** — unlike
   the Lalamove/HitPay save-then-encrypt path, no plaintext credential ever
   lands in the DB or the mutation log).
4. Our webhook URL (`<CONVEX_SITE_URL>/webhook/delyva`) is auto-subscribed
   via `POST /webhook` for `order.created` + `order_tracking.update` +
   `order_tracking.change` — **zero portal steps for the seller**. A
   subscribe failure doesn't fail the connect (bookings work; status won't
   flow); `webhooksSubscribedAt` unset is the honest signal, and
   `resubscribeWebhooks` is the retry.

**There is no sandbox toggle, by design.** Delyva has one API host
(`https://api.delyva.app/v1.0`) and no key prefix — a "sandbox" is simply a
separate account registered at `demo.delyva.app`. The ticket's
"infer env from key prefix" AC is void; a key is just a key.

Gates: connect/enable is **Pro-gated** via `PLAN_FEATURES.delivery` (the same
flag as Lalamove booking; admin act-as bypasses for white-glove), and country
is checked via `delyvaBookingAllowed` (`convex/lib/delivery.ts`) — its own
table, never derived from pricing modes. Disconnect/disable is never gated
(downgrade never traps).

## Malaysia and Singapore (z8r3fdbqmc)

Delyva serves **both** countries, and this is the one place the two booking
providers disagree: Lalamove is Malaysia-only, Delyva is not. Deriving either
gate from the other — or from `COUNTRY_DELIVERY_MODES` — would have made that
impossible to express, which is why each provider owns its own table.

**Singapore needs this more than Malaysia does.** SG stores have no Lalamove
(`COUNTRY_RIDER_BOOKING.SG = false`) and only HitPay for payments, so before
this they had *no* courier automation at all — every parcel arranged by hand
with the tracking number typed in. Delyva is that market's whole answer.

What is country-shaped, and where it comes from:

- **Postal codes.** MY is 5 digits and called a *postcode*; SG is 6 and called
  a *postal code*. Both the pickup-address form and its server validator read
  **`postcodeRule(country)`** from `convex/lib/address.ts`, which already owned
  the rule — the feature first shipped with a hardcoded `/^\d{5}$/` on both
  sides, which silently made it Malaysia-shaped. Anything that asks a seller
  for a postcode should ask that helper. (`src/lib/schemas.ts` still keeps its
  own copies for the zod form schemas — pre-existing, worth folding in later.)
- **The state tier.** Singapore has none: the island is both the city and the
  "state", and the server arm enforces the `SG_STATE_LABEL` literal on both
  fields. So the SG form renders **neither** a state dropdown nor a city input
  — a dropdown with one option is not a choice — and `saveAddress` supplies the
  literal. `parseGoogleAddress` already returns it when handed `country`.
- **The country on the wire.** `getDispatchContext` stamps the store's country
  on both waypoints and `formatBuyerAddress` takes it as an argument. It was
  hardcoded `"MY"`, which on a Singapore parcel is exactly how a quote comes
  back empty with no error to explain it.
- **Coverage copy.** The cold-chain line no longer claims "West Malaysia only";
  it says cold-chain couriers cover less ground than ordinary parcels and to
  check with Delyva, which is true in both markets.

**Verified 2 Sep 2026:** a quote with `country: "SG"`, `state: "Singapore"` and
a 6-digit postal code returns a well-formed HTTP 200 — the payload shape needs
no change. It returned zero services only because the probing account is a
Malaysian demo account with no SG couriers enabled. **What is NOT verified is
that a real SG account returns real SG couriers** — that needs an SG Delyva
account, and it is the SG twin of the cold-chain gap below.

## Schema

- `retailers.delyva` — sibling credential arm next to `deliveryBooking`
  (Lalamove) and `hitpay`: encrypted `apiKey`/`apiSecret`, `apiKeyHint`,
  `customerId`, `companyId`, `accountName`, `defaultItemType`
  (PARCEL/CHILLED/FROZEN, store-level default with per-order override),
  `pickupAddress`, `connectedAt`, `webhooksSubscribedAt`.
- **`pickupAddress` is structured on the Delyva arm**, not parsed out of
  `businessAddress` — that field is one free-text label + coordinates (fine
  for a rider, useless for a parcel courier's postcode/state zone pricing).
  It is also the unit Delyva's **cold-chain activation** applies to, so a
  deliberate address is part of the setup story. Booking blocks with reason
  `no_pickup_address` until it's set.
- `deliveryJobs.provider` widened to `"lalamove" | "delyva"`; Delyva rows
  add `serviceName` (courier display name), `awb` (consignment number) and
  `itemType`. `quotationId`/`vehicleType` carry the **service code** (their
  quotes are indicative, not id-bound — see Dispatch below).
- `by_provider_order` index widened to `["provider", "providerOrderId"]` —
  two providers' order ids are both opaque strings, and the webhook lookup
  uses `.unique()`, so a provider-blind index would let a cross-provider
  collision throw inside a webhook handler.
- AWB mirrors into the existing `orders.courierName` / `orders.trackingNo`
  (86eyehvk4) + `carrierTrackingUrl` — **fill-if-unset**, so a seller's
  manual shipment entry is never overwritten, and the buyer's track page +
  shipped WhatsApp carry the tracking number with zero new plumbing.

## Dispatch flow (two-tap, mirrored on Lalamove's invariant)

Delyva differs from Lalamove in one important way: `POST
/service/instantQuote` returns a **list of courier services** (DHL, J&T,
Ninja Cold, …, each with price + service code), the prices are indicative,
and there is no quotation id — order create re-prices. So:

1. **`prepareBooking`** — live-quotes the parcel and returns the service
   list sorted by price (the dispatch card renders a picker, cheapest
   pre-selected). An **empty list is a normal answer** ("no courier takes a
   chilled 2.5 kg parcel to this address") and renders as an empty state
   with the manual-courier handoff, never an error.
2. **`confirmBooking`** — reserve → external calls → commit/release:
   - `reserveBooking` claims the order's **one-active-job slot atomically,
     counting jobs from EITHER provider** — an order can never have a rider
     and a courier racing for it.
   - `POST /order` creates a **draft** (`process: false`) with
     `idempotency-key: kp-<jobId>` (Delyva caches responses per key for
     24 h, so a network retry can never double-create).
   - `POST /order/process` with the picked `serviceCode` spends the credit.
     A failed process **cancels the draft best-effort** so the seller's
     Delyva dashboard doesn't fill with orphans, then releases the
     reservation into the amber failed card with a classified reason.
   - Price + AWB come from the process response, falling back to
     `GET /order/{id}`, falling back to the `order.created` webhook.

**Parcel weight** comes from `summarizeCartWeight` over the order's variants
(`parcelWeightG`, the 86eyeea1n field) — the same never-silently-underweigh
summariser the weight-zone pricing uses. When the cart is unweighable (a
custom line, or missing product weights) the dialog asks the seller to type
the packed weight (`weightKgOverride`); the seller can always override, since
they know the real packed weight best.

**Wire shapes were probed live** against a demo account (27 Aug 2026), not
assumed: the waypoint address rides *inside* `contact` (a top-level
`address1` is rejected), `inventory` is required on **both** waypoints, and
`POST /order/{id}/cancel` is the working cancel path (the ms2781 variant also
exists; both return `statusCode: 900`).

## Webhook (`POST /webhook/delyva`)

Signature: `X-Delyvax-Hmac-SHA256` = base64 HMAC-SHA256 of the **raw body**
with the account's `apiSecret`. Same trust posture as the Lalamove route:
no matching job → 200 ack + ignore (bookings made outside Kedaipal; we can't
verify them and don't act); matching job but no stored secret → **500 fail
closed**; bad signature → 401; signed but the payload's `customerId` doesn't
match the job retailer's stored one → 200 + log (defense in depth).

Status codes (verified against Delyva's own maintained WooCommerce plugin):

| Delyva | Meaning              | Job status  | Order effect                        |
| ------ | -------------------- | ----------- | ----------------------------------- |
| 100/110| created / ready      | `assigning` | AWB fills → courier fields mirror   |
| 200    | courier accepted     | `ongoing`   | —                                   |
| 400    | start collecting     | `ongoing`   | —                                   |
| 475    | failed collection    | `rejected`  | failure email, order untouched      |
| 500    | collected            | `picked_up` | → **shipped** (from confirmed/packed) |
| 600    | out for delivery     | `picked_up` | —                                   |
| 650    | failed delivery      | *(kept)*    | failureReason + email — the parcel is still WITH the courier (retry/return follows), so the job never goes terminal |
| 700/1000| completed           | `completed` | → **delivered** (from confirmed/packed/shipped) |
| 900    | cancelled            | `canceled`  | failure email if it was active      |

Idempotency + out-of-order: `lastEventAt` guard (older events only gap-fill
the AWB, never regress status); order transitions ride
`applyStatusTransition` behind the same `SHIPPABLE_FROM`/`DELIVERABLE_FROM`
guards as Lalamove — **the order never regresses**, and a cancelled order is
never touched. The manual-advance rider gate (`riderOwnsTransition` in
`convex/orders.ts`) now returns the owning **provider** and words the block
accordingly.

## Shared machinery

The provider-agnostic job-status rules (`DeliveryJobStatus`,
`isActiveJobStatus`, `TERMINAL_JOB_STATUSES`, `riderDrivesOrderStatus`,
`isRiderManagedTransition`) moved from `lib/lalamove.ts` to
**`convex/lib/deliveryJobs.ts`**; `lib/lalamove.ts` re-exports them so its
existing importers didn't change. Both provider modules import from the
shared file.

## Failure classification

Delyva errors carry no stable machine ids — only `{error: {message}}` — so
`classifyDelyvaFailure` matches phrases probed from the real API (the live
zero-credit refusal is a test fixture) and **"unknown" beats a wrong story**
(the 86eypncfy lesson). Classes: `credit` (top up in the Delyva app —
includes Delyva's own message with the balance), `not_activated` (cold-chain
pickup activation pending), `no_service`, `unknown`. Booking failures email
the seller through the same `notifyDeliveryJobFailed` template, now
provider-aware in all three locales.

## Settings IA — Integrations vs Fulfilment (2 Sep, Zaki)

The first cut shipped a **one-automated-provider-at-a-time** rule (Lalamove OR
Delyva, mutually exclusive). Zaki's test round overturned it, and the revised
reasoning is recorded here because the first version *sounded* right:

**The mutual exclusion solved a money-safety problem that doesn't exist.** The
buyer's delivery fee is collected at checkout, before any booking is made —
which tool sends the parcel afterwards changes nothing the buyer paid, only
the seller's margin, and the dispatch card shows "buyer paid X" beside every
courier price at the moment of choice. So the rule is now:

- **Charge mode** (Fulfilment → Delivery charge) answers "what does the buyer
  pay". Lalamove live-quote remains one of those modes; Delyva never is.
- **Courier booking** (Fulfilment → Courier booking) is **independent
  toggles**, not a radio — a seller may arm Lalamove riders AND Delyva
  couriers and pick per order (rider across town today, parcel across the
  country tomorrow). Arranging your own courier is the ever-present baseline,
  not an option. Each unconnected provider's toggle is disabled-with-reason
  plus a link to Integrations.
- **One coupling survives**: Lalamove live-quote pricing implies rider booking
  (the checkout quote runs on those credentials), so under that charge mode
  the rider toggle is locked on with the reason shown. Switching pricing AWAY
  no longer disarms rider booking — it's the seller's toggle now.
- Per ORDER, the **one-active-job reservation** (cross-provider) is what
  arbitrates: both cards may render, whichever books first takes the slot and
  the other card shows `job_active`.

**Settings → Integrations** (new tab) is one home for third-party ACCOUNTS —
Lalamove keys (with the 86eypncfy env badge + webhook row), the Delyva
account card (connect, pickup address, parcel type, webhook health), and the
HitPay card (moved from Payments; its country-switch checklist deep-link
retargeted). Keys are pasted once and rotated rarely; behavioural switches
are day-to-day — mixing the two is how the Fulfilment tab ended up carrying
credential forms inside a pricing section. Fulfilment/Payments link here
whenever a needed account isn't connected, and `riderOnlyStore` (not
`bookingEnabled`) now drives the "no parcels ever leave this store" surfaces,
since a weight-priced store can legitimately arm riders too.

## Getting an account per country (and why demo is Malaysia-only)

**Country is a property of the Delyva COMPANY (tenant), not of the account or
the address you type.** Delyva runs one tenant per market on a wildcard
domain — `my.delyva.app` (+60), `sg.delyva.app` (+65), `ph.`, `id.` — plus
`demo.delyva.app`, which is itself a **Malaysian** company (`GET /company`
returns `code: "demo"`, `country: "MY"`, a Setapak KL address). A hostname
with no company behind it renders "Company not found.", so the tenant list is
verifiable from outside.

That explains the trap (Zaki, 3 Sep): signing up a *second* demo account with
an SG phone and an SG address still creates a customer **under the Malaysian
Demo company**, so the wallet tops up in MYR, the dashboard offers no country
switch (there is no customer-level country to switch), and an SG→SG quote
comes back with `services: []` — no error, just nothing, because the company's
service providers only cover Malaysia. The same key quoting MY→MY returns
three services in MYR. IP/geolocation has nothing to do with it.

**Test tenants, and why both are Malaysian.** Delyva's own developer guide
names a sandbox portal at `trydx.delyva.app` ("try express") alongside
`demo.delyva.app` — and BOTH sign up at +60. There is no Singapore test
tenant under any name we could find, so an SG account is necessarily a live
one. `parseCompanyResponse` therefore treats `trydx` as non-production too
(code or website): the guide sends integrators there, and badging a sandbox
LIVE is the 86eypncfy failure exactly — a simulated booking looks real right
up until no courier arrives.

**Singapore looks dormant, not merely empty** (3 Sep): `delyva.com/sg/`
302-redirects to the global country chooser while `/my/` serves a full
product page, and a fresh SG account has an empty Service Providers panel.
The tenant is real (`sg.delyva.app` renders +65, the account connects, all
three webhooks register) but no courier is behind it. **If Delyva confirms
there are no SG partners to enable, the whole surface retires from SG stores
with a one-line change** — `COUNTRY_DELYVA_BOOKING.SG = false` in
`convex/lib/delivery.ts`: the settings toggle hides (`countryAllowed`) and
`delyvaSurface` returns `"none"` on `country_unsupported`, so no seller is
offered a courier we can't deliver.

**To test Singapore, the seller (or we) needs a key issued by the SG tenant:**
sign up at `https://sg.delyva.app/customer/signup`. Nothing in our integration
is host-aware — `api.delyva.app` is the single API host and the access token
carries the company — so an SG key needs no code change, and our demo
detection correctly reports it LIVE (`code` is not `"demo"`).

**Quoting is free.** `POST /service/instantQuote` spends nothing and works on
a zero-balance wallet (that is how the MY demo account quoted before it was
topped up); only `POST /order/process` draws credit. So connect → quote →
courier list can be verified end-to-end on a fresh SG account without paying
anything; only the final booking needs a top-up, in SGD.

There is no SG demo/sandbox tenant under any obvious name (`demosg`,
`sgdemo`, `demo-sg` all answer "Company not found."), and the two real test
tenants (`demo`, `trydx`) are both Malaysian. If a sandbox is wanted for SG
it has to come from Delyva support.

## Seller UI

Two surfaces, both vendor-side. **The buyer never sees Delyva** — they pay the
store's existing delivery charge (flat / weight-zone) at checkout and get the
tracking number on `/track/<token>` and in the shipped WhatsApp, through the
manual-courier pipeline that already existed. Decided 27 Aug, and it matches
where the market landed: Shopee removed buyer courier choice in 2020 and
assigns it now, Lazada/TikTok Shop show a tier rather than a brand, and
Shopify has the buyer pick a merchant-configured *rate* while the merchant
buys the label afterwards. It also protects the seller's margin, because the
booking spends **their** Delyva credit — the dispatch card shows what the
buyer paid right beside each courier's real price.

**Settings → Fulfilment → Delyva courier** (`src/components/settings/delyva-card.tsx`),
placed between the delivery *charge* card and the despatch *label* card —
the order the seller thinks in: what the buyer pays → how the parcel leaves →
the paper that goes on it. Booking is orthogonal to pricing (a flat-fee store
can still book couriers), so it is its own card, never a delivery-charge mode.
Unlike its HitPay sibling this card owns its own reads and actions rather than
taking a summary + `onSave`: Delyva has its own Convex namespace, so threading
four actions and a mutation through the tab would be five more props for no
gain. Act-as is honoured the way `useUpdateSettings` does it. It carries: the
one-key connect (with the "one key is all we need" line, because every other
integration asks for two), the connected proof (**account name** + key hint —
so a seller can see they pasted the *right* account's key), pause/replace/
disconnect, the structured pickup address with the 5-digit-postcode rule
mirrored from the server (**pre-filled at connect from the seller's Delyva
profile** — `GET /customer` already holds it, so `storeConnection` imports it
fill-if-unset; an address the seller saved here is never overwritten, since a
reconnect must not clobber a deliberate correction), the default parcel-type
tiles, the **cold-chain
activation note** (shown only for a chilled/frozen default — the single most
likely reason a frozen seller's first booking fails), and a **webhook-retry
warning** when `webhooksSubscribedAt` is unset, since a silent subscription
failure otherwise shows up only as orders that mysteriously stop updating.

**Order detail → Dispatch hub** (`src/components/order/dispatch-hub.tsx`):
when BOTH providers have a card to show on this order, a segmented switch
renders ONE provider's card at a time — two full cards stacked two spend
buttons a scroll apart, and a mis-tap books a rider when the seller meant a
courier. The switch is **grouped into the card it drives** — one bordered
shell, tabs sitting on top of the pane they swap, cards rendering `embedded`
(no chrome of their own) inside it; a segmented control floating above a
separate card read as two unrelated things.

"Has a card" is `src/lib/dispatch-surface.ts`, the SAME predicate the cards
use for their own early returns — the hub cannot be allowed to offer a tab a
card then declines to fill. That was a real blank pane: on a *delivered*
order carrying a cancelled Delyva booking, Delyva had history to show while
Lalamove had no job and a delivered order isn't bookable, so its card
returned null under a tab that promised something. The predicate is
tri-state, because a never-set-up provider's dashed discoverability **hint**
is a nudge, not a dispatch surface: `"none" | "hint" | "card"`, and only
`"card"` on both sides builds a tab strip.

The switch is a view control (localStorage, never server state); the
default follows the facts: a provider with a live job fronts (its card holds
tracking/cancel, and the other tab wears a live-booking dot), then the last
choice on this device, then rider-first for a live-quote store. While one
provider holds the active job, fronting the OTHER tab shows a **notice**
("A Delyva courier is already on this order — one booking at a time…") with a
jump back to the booking — the cards null themselves out under `job_active`,
and an empty pane reads as broken. Single-provider stores bypass the hub
entirely and see exactly what they saw before.

**Order detail → Delyva Courier** (`src/components/order/delyva-dispatch-card.tsx`) —
each card hides itself when its own provider isn't set up, so nobody sees two.
The picker is **inline on the card, not in a modal** — the deliberate
divergence from `BookDeliveryCard`. Lalamove returns one price bound to a
5-minute quotation id, so its flow is a modal with a countdown; Delyva returns
a list whose prices are indicative and never expire, so the task is a
comparison, and on a phone a scrollable courier list inside a scrollable
dialog is the worse of the two. Above the flow sits a one-line **"Collecting from <address> · Edit"** —
the imported profile address is prefill, not truth (live probe: Delyva held
43500 Semenyih where the seller had corrected to 43700 Beranang), so the
first booking doubles as the address check, with the fix one tap away in
Integrations. Flow: weight (seeded from the order, always
editable) → parcel-type pills (store default, per-order override; changing
either drops stale prices) → **Get courier prices** → the list, cheapest
pre-selected with the CTA repeating the choice and its price → book. Booked
state shows the courier, the AWB with one-tap copy, the cost, a tracking link
and cancel. A failed booking on an order that can no longer be booked (delivered,
cancelled) shows the failure **as history** — the amber banner plus the
disabled-with-reason line — rather than a "Try again" the server would
refuse. A booking failure on a still-bookable order renders **in place, not
as a toast** (the
86eypncfy lesson: the seller is coming back from a top-up and the reason must
still be on screen), with the picker intact so retrying is one tap.

**Copy that had to become provider-aware:** the client-side manual-advance gate
in `app.orders.$shortId.tsx` now subscribes to `api.delyva.getDispatchState`
alongside the Lalamove one and treats an active job from **either** provider as
"someone else owns this order's status" — without it the UI would offer a
manual *Shipped* the server then refuses, since `riderOwnsTransition` already
covers both. The gate's wording, the cancel/delete warnings that point at the
dispatch card by name, and the `deliveryJobFailed` email (all three locales)
follow the provider that actually owns the job.

**An empty courier list says WHICH kind of empty.** A quote with no services
has two causes that look identical on the wire, and the seller can only fix
one: no courier covers this parcel/route, or **the account has no courier
switched on at all**. The second is where every fresh DelyvaNow account
starts — its Service Providers panel is empty until Delyva enables their
market's partners or the seller connects their own courier contract — so a
brand-new account quotes nothing for every address (Zaki's live SG account,
3 Sep). Blaming the address there sends the seller re-typing addresses
forever. So when `instantQuote` returns zero services, `prepareBooking` makes
ONE extra `GET /service` call (empty path only, never on a successful quote)
and counts `status: 1` entries via `countActiveDelyvaServices`; zero means
the account is empty and the card says so, pointing at Delyva's own
Integrations screen instead of at this order. A failed or malformed lookup
leaves the flag unset and the generic route wording stands — "we couldn't
tell" must never render as an accusation.

**Cold chain gets its own diagnosis**, because it fails in a way that reads
as an address problem and it is the ICP's whole reason for being here.
Delyva filters item types SERVER-side — measured on the same KL route:
`PARCEL` → 3 services (accepting `FOOD`, `PACKAGE`, `PARCEL`), `CHILLED` → 0,
`FROZEN` → 0 — so a chilled quote on an account with no cold-chain service is
byte-identical to an unserviceable address. **We never filter by item type
ourselves**: the request carries `itemType` and the card renders every
service that comes back, so an empty cold list is always Delyva's answer, not
our filtering. To tell the two apart, an empty CHILLED/FROZEN quote re-runs
the SAME route as `PARCEL` (quotes are free, empty path only): couriers there
means the route is fine and the gap is the cold chain — a thing Delyva
support can switch on — and the card says exactly that instead of blaming the
address.

**Cross-currency quotes are never presented as comparable.** Prices come from
the Delyva COMPANY, so a Malaysian account quoting a Singapore store returns
MYR against an SGD order (Zaki's sandbox setup, 3 Sep — legitimate while
testing, and impossible once a store holds its own market's key). "Buyer paid
S$6.00" beside "RM 0.10" is a margin call out of thin air, so when any quoted
currency differs from the order's the line says which currency the quote is
in and that the two aren't directly comparable.

**Every hint names the RIGHT next step** (PR #247 review). A one-line nudge
replaces the card whenever booking isn't armed, and *which* nudge depends on
why: `not_connected` → connect in Integrations, `disabled` → the store paused
it, so resume it under Fulfilment → Courier booking, `plan_gated` → the Pro
pitch. Sending an already-connected seller to a connect screen hides the one
switch they need. The same sweep split Lalamove's `booking_disabled`, which
had meant *either* "toggle off" *or* "no pickup address on the store" — one of
those two fixes was always the wrong advice, so `no_business_address` is now
its own reason. A nudge also only renders on an order the seller can still
act on; on a delivered order it is noise.

**Discoverability** (the CLAUDE.md rule): the settings card explains the
feature before it is connected, the order card shows a one-line hint linking to
Settings when Delyva was never set up (rather than a disabled button for a
feature the seller has never heard of), and
`public/guides/delyva-setup.html` is the print-ready vendor walkthrough —
account → credit → cold-chain activation → API key → paste → one real test —
linked from the settings card, the `hitpay-setup.html` / `lalamove-setup.html`
precedent.

## Testing

- `convex/lib/delyva.test.ts` — pure client mechanics; fixtures are payloads
  captured live from the demo account (quote list, draft create, the
  insufficient-credit refusal).
- `convex/delyva.test.ts` — `convexTest` integration: webhook idempotency /
  out-of-order / order transitions / AWB fill-if-unset mirroring, the
  cross-provider reservation invariant, webhook correlation by
  `(provider, providerOrderId)`.
- `src/components/order/delyva-dispatch-card.test.tsx` — the picker flow plus
  every state that must not be a dead end: no couriers, an unweighable cart, a
  failed booking, each blocked reason.
- `src/components/settings/delyva-card.test.tsx` — one-key connect, the Pro
  gate (and that it never traps a downgraded seller), the postcode rule, the
  missing-address and unregistered-webhook warnings.
- Manual E2E: register a **demo account** at `demo.delyva.app` (same API
  host; the "sandbox" is just a separate account) and use their webhook
  simulator at `dx-integration-sandbox.pages.dev` to fire status updates.
  Note: the demo account exposes **no CHILLED services** — cold-chain
  quoting can only be verified end-to-end on a real account.

## Open / follow-ups

- **Visual check of the two dashboard cards** — they sit behind Clerk, so the
  render→look→iterate pass needs a signed-in session; behaviour is covered by
  the two component suites meanwhile.
- **Per-item parcel type** — ClickUp `86eyrmv1j` (backlog). Today the type is a
  store default with a per-order override (option 1, decided 27 Aug). Delyva's
  `itemType` applies to the **shipment**, not the line item, so even per-item
  flags must resolve to one value ("coldest wins"); build it when a genuinely
  mixed-temperature seller exists, as one optional variant field plus a
  derivation in `getDispatchContext` — the same pills UI, smarter
  pre-selection.
- **Live Delyva rates at checkout** — a new *pricing* mode (the Lalamove
  live-quote parallel), deliberately out of scope: buyer pricing stays
  weight-band. Its own ticket if weight bands prove too coarse.
- **An SG Delyva account** — needed to confirm a real Singapore account
  returns Singapore couriers, and to sanity-check SGD pricing end to end
  before the SG pilot (z8r3fdbqmc).
- **Cold-chain quote verification on a real account** — the `CHILLED`
  itemType is confirmed in Delyva's plugin and API enum, but the demo
  account returns no cold-chain services; verify pricing + the activation
  failure copy against the production account before the frozen-seller pilot.
- **`carrierTrackingUrl` fallback** (`my.delyva.app/customer/strack?trackingNo=…`)
  — used only when the courier isn't in our registry
  (`convex/lib/couriers.ts`); confirm the page is public during E2E.
- **Scheduled pickups** — Delyva waypoints accept `scheduledAt`; v1 books
  immediate collection (parcel couriers collect on their own cadence).
  Revisit if sellers ask for date-bound pickups.
- **Label printing** (`GET /order/{id}/label`) — the booked state's "Print
  shipping label" in the mockups; wire in PR2.
- Operational (with Herrey, tracked on `86eyjprqw`): 1% payout mechanics,
  pickup-address activation lead time, partner agreement.
