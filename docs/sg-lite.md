# SG-lite — Singapore stores on Kedaipal

**Status:** all three SG-lite build slices are in — Phase 1 (country field +
currency correctness, [`86eynw27f`](https://app.clickup.com/t/86eynw27f)),
Phase 2 (phone +65 — buyer checkout
[`86eynw28q`](https://app.clickup.com/t/86eynw28q) + seller-side fields
[`86eynw2dy`](https://app.clickup.com/t/86eynw2dy), one PR), and Phase 3
(address variant + Places unlock + delivery-mode guard,
[`86eynw29u`](https://app.clickup.com/t/86eynw29u)).

The first SG merchant (SG WhatsApp number, SG buyers, SGD pricing) goes live on
the shared +60 WABA — Meta delivers internationally, so the messaging layer is
untouched. What changes is every place the app assumed *Malaysia*: phone shapes,
address shapes, the Places region, and which currency a store is born with.

## The one switch: `retailers.country`

`country: v.optional(v.union(v.literal("MY"), v.literal("SG")))` —
**undefined is MY everywhere** (every pre-existing store, zero migration).
The closed set lives in `convex/lib/country.ts` (`COUNTRIES`, `DEFAULT_COUNTRY`,
`COUNTRY_LABELS`, `COUNTRY_CURRENCY`, `isCountry`/`assertCountry`), shared
client + server like `SUPPORTED_CURRENCIES`. Every per-country branch should be
an exhaustive `Record<Country, …>` lookup so a third country is a compile
error, never a silent MY fallback (the `Locale` posture).

### Where it's readable

- **Owner + admin reads** (`getMyRetailer` / `getRetailerForAdmin`): resolved
  `country` on `RetailerPublic`.
- **Public storefront read** (`getRetailerBySlug`): same resolved field —
  checkout keys the phone plate/validator arm and address variant off it.
  Public-safe: which country a storefront operates in is not seller data.
- **Order-token read** (`orders.get` payload, `retailerCountry`): the tracking
  page's ONLY retailer read — the buyer phone-repair flow and the address-edit
  dialog can't see `getRetailerBySlug`, so the field rides the order payload
  too. Both plumbing paths must stay in sync when country-driven behaviour
  grows.

### Where it's settable

- **Onboarding** (`/onboarding`): a Malaysia/Singapore picker, default MY.
  Deliberately BEFORE the store exists — see "currency is born from the
  country" below.
- **Admin invite links** (`admin billing → Onboard a client`): a country
  toggle rides the prefill token (`country: "SG"` only when SG — old links
  stay valid), so an SG client's form opens pre-set.
- **Settings → Store**: `CountryForm` card directly above the Currency card.
  Changing country does NOT cascade onto currency — the card shows an amber
  hint when the two disagree instead of silently rewriting what prices mean.

## Currency correctness (the part the ticket called "zero work")

SGD was already in `SUPPORTED_CURRENCIES` and the money pipeline is
currency-parametric end-to-end (wa.me message, WhatsApp copy, emails, PDFs,
CSV, HitPay mint — all read `order.currency`). Three real gaps got fixed here:

1. **Currency is born from the country.** `createRetailer` used to hardcode
   MYR; it now stamps `COUNTRY_CURRENCY[country]`. This matters because
   **products freeze their currency at create** and `orders.create` hard-throws
   on an order-vs-product currency mismatch — an SG seller who added products
   before flipping Settings → Currency had a store that could not take a
   single order.
2. **Changing currency re-stamps every product.** `updateSettings` syncs all
   product rows (archived included — restore must not resurrect a mismatch) to
   the new currency and returns `productsCurrencySynced`; the settings card and
   toast say exactly what happened. Amounts keep their numbers (RM 12 becomes
   S$ 12) — repricing is the seller's own pass, and the card copy says so.
   Bounded by the 200-product cap. Orders keep their frozen currency
   (historical truth).
3. **`formatPrice`/`formatPriceCompact` pin SGD to `S$`.** The `en-MY` Intl
   locale renders SGD as the bare code (`SGD 41.00`) while the PDF renderer
   maps `SGD → "S$"` — the web now matches the receipt via the same
   `CURRENCY_SYMBOL_OVERRIDE` idea (`src/lib/format.ts`), MYR byte-identical on
   the Intl path. Also fixed in passing: the track-page address-edit dialog
   hardcoded `"MYR"` on the live rider-price line — it now takes the order's
   frozen currency.

## Address (SG variant) — `86eynw29u`

### The shapes

One country-keyed validator on each side, MY byte-identical to pre-SG:

- **Server** — `convex/lib/address.ts` `assertValidAddress(addr, country)`
  (country omitted = MY, so every legacy caller/test is untouched). The MY arm
  keeps `MY_STATES` + 5-digit postcode. The SG arm takes a **6-digit postal
  code** and requires `state` to be the literal **`"Singapore"`**
  (`SG_STATE_LABEL`, accepted case-insensitively, normalized on store).
  Country resolves from the RETAILER row at both call sites —
  `orders.create` and `updateDeliveryAddress` — never sniffed off the address.
- **Client** — `src/lib/schemas.ts` `strictAddressSchemaFor(country)` /
  `checkoutFormSchemaFor(country)` / `addressEditFormSchemaFor(country)`,
  built once per country at module load (exhaustive over `COUNTRIES`).
  Checkout reads the country off `getRetailerBySlug`; the tracking-page edit
  dialog reads `order.retailerCountry`.

### No state/city fields for SG

Singapore has no state tier and one city, so the SG form renders **line1 + a
6-digit postal-code input only** (`AddressFieldset`'s `country` prop) — no
state dropdown, **no city field**. Both `city` and `state` are stamped with
`"Singapore"` by the submit handlers (checkout's `sanitizeAddress`, the edit
dialog's payload) — never read off form state — so downstream consumers keep
the same required-string shape as MY. Display sites dedupe the repetition
via `src/lib/address-display.ts` (`displayAddressState`: the state line is
skipped when it merely repeats the city), so nothing prints
"123456 Singapore, Singapore" — applied on the tracking/dashboard address
block, the wa.me message, both live-quote address labels, and the confirmed
card. Google picks parse through `parseGoogleAddress(components, formatted,
country)` — the SG arm returns the literal for city/state, keyed off the
country arg, never guessed from components.

### Places region unlock

`convex/google.ts` `autocompleteAddress` takes an optional `country`
(validated `"MY" | "SG"`, default MY) mapped through
`REGION_CODES: Record<Country, …>` → `includedRegionCodes` `["my"]`/`["sg"]`.
Threaded from the buyer fieldset AND the three seller surfaces (business
address ×2 in Settings → Fulfilment, the pickup-point dialog — whose
placeholder now names the store's country). Place-details fetches carry no
region (a place id is unambiguous).

### Saved address is namespaced per country

`src/lib/saved-address.ts`: MY keeps the original `kedaipal:lastAddress` key
(existing buyers' saves survive), SG uses `kedaipal:lastAddress:SG`. This
kills the cross-contamination bug (an MY save restoring `state: "Selangor"`
+ a 5-digit postcode invisibly into an SG form) while keeping BOTH prefills
for a buyer who shops in both countries — chosen over discard-on-mismatch,
which destroys a valid save to fix the same bug.

### Delivery-mode allowlist: SG = `unset (free) | flat`

`convex/lib/delivery.ts` `COUNTRY_DELIVERY_MODES` / `deliveryModeAllowed` is
the one author; radius/weight/Lalamove are MY-shaped (zone lookups key off
MY states; `LALAMOVE_MARKET = "MY"`), so on an SG store they'd strand every
order fee-pending or kill checkout. Three enforcement points:

1. **Write (primary)** — `retailers.updateSettings` refuses storing an
   MY-only mode on an (effective) SG store — checked BEFORE the
   mode-specific requirements, so an SG seller picking Lalamove hears "the
   mode is MY-only", not "configure booking first" — and refuses flipping
   `country` → SG while such a config is stored ("switch to Free or a Flat
   fee first"; a same-call config replacement is judged against the incoming
   mode, so flip-and-fix lands in one save). The `CountryForm` surfaces the
   refusal via its existing `convexErrorMessage` toast.
2. **Settings UI** — SG stores render only the Free + Flat cards with a
   one-line reason; a store somehow stuck on a stored MY-only mode gets an
   amber repair note instead of a silently unselected grid.
3. **Read (belt-and-braces)** — the public `delivery.quote` answers
   `{kind: "blocked", reason: "store_unavailable"}` (the existing
   "it's on the store's side" buyer copy) and `orders.create` /
   `updateDeliveryAddress` refuse via `resolveDeliveryForOrder`, so bad data
   can never silently strand an order as fee-pending forever.

### Deferred

Lalamove SG market, SG weight zones (would need an SG-region concept — the
current zones are sets of MY states), and Delyva/courier-registry SG entries.

## Phone (+65) — `86eynw28q` + `86eynw2dy`

The MY phone validation grew a country-keyed SG arm. **Which arm applies is
always the retailer's country** — never a permissive both-countries regex and
never sniffing the typed digits — so each side keeps its full typo protection:
an SG store's checkout rejects a `+60` buyer with the SG message
("Enter a Singapore mobile number (e.g. 9123 4567)"), an MY store rejects
`+65` exactly as before. SG mobiles are 8 digits starting 8 or 9, stored as
`65[89]\d{7}` (the form Meta delivers inbound); accepted input shapes are
`+65 9123 4567`, `65…`, and the bare `9123 4567` the plate asks for (SG has no
trunk 0; a bare `6…` is invalid).

### One normalization author

`convex/lib/slug.ts` now owns everything, per country, and the client imports
it (it's a pure module — the `convex/lib/country.ts` precedent), so the
client-fails-fast schemas and the server authority literally share code and
cannot drift (the tickets' named danger zone):

- `STORED_MOBILE_PATTERN` / `MOBILE_MESSAGE` — `Record<Country, …>` of the
  accept shape + rejection copy (the message previously lived in four places).
- `assertValidWaPhoneForCountry` — the LOOSE arm (counter manual bind): brings
  local forms to international digits, passes anything else through (a cashier
  may key a foreign walk-in's number). **The M3 CRM-fork fix lives here**: an
  SG store's bare `81234567` is prefixed to `6581234567`; before, it was
  stored unprefixed while an inbound scan stored `6581234567`, forking the
  `(retailerId, waPhone)` customer. MY's loose arm is byte-identical to before
  (trunk-0 bridge only — deliberately no bare-NSN fold there).
- `assertValidMobileForCountry` — the STRICT arm behind every plated field
  (checkout, buyer repair, seller `waPhone`/`notifyWaPhone`, pickup manager
  contact): loose bridging + the country's mobile shape, one message.
- `normalizeMobileDigits` — the non-throwing sibling the client schemas and
  dirty-checks run.
- `assertValidMyWaPhone` / `assertValidMyMobile` survive as MY-fixed
  delegates for Kedaipal's own always-Malaysian numbers (the support line in
  `convex/lib/contact.ts` stays MY on purpose — platform data, not seller
  data).

### Server consumers (each resolves the retailer's country)

`orders.create` (retailer row now loads before the phone check),
`orders.updateBuyerPhone` (via the order's retailer),
`counterCheckout.bindSessionManualPhone` (loose arm),
`retailers.createRetailer` (**the same-call `args.country`** — the row doesn't
exist yet), `retailers.updateSettings` (`args.country ?? retailer.country ??
"MY"`, so "switch to SG + save the SG number" in one call validates
coherently), and `pickupLocations` create/update (manager contact — audit M9).
The WABA send path is phone-agnostic (sends whatever's stored) and was
verified to re-validate nothing.

### Client

- `MyPhoneInput`/`MyPhonePrefix` grew a `country` prop (default `"MY"` so
  untouched call sites compile unchanged): SG flag SVG, `+65` plate,
  `MOBILE_PLACEHOLDER` record ("9123 4567"). The plate remains a promise —
  every call site threads the same retailer country the save path validates
  by. Threaded at: storefront checkout (retailer payload), the track page's
  number repair (`order.retailerCountry`), Settings → WhatsApp contact +
  WA-order-alerts card + pickup-point manager field, onboarding (reacts live
  to the country picker), and the admin Onboard-client card (follows its
  toggle).
- `src/lib/schemas.ts`: `waPhoneCheckoutSchema` / `waPhoneFormOptionalSchema` /
  `settingsWaPhoneFormSchema` / `checkoutFormSchema` are now
  `Record<Country, schema>` maps built from the server's own
  patterns/messages/normalizer.
- `src/lib/phone.ts`: re-exports `normalizeMobileDigits`;
  `toNationalPhoneInput(value, country)` peels only the plate's own dial code
  (M5 — a stored `6591234567` renders as `9123 4567` beside a `+65` plate),
  and a number from the *other* country falls through as bare digits so a
  country switch never silently reshapes a stored value.
- `src/lib/format.ts`: `formatMyMobile` → `formatMobile` with an SG grouping
  arm (`6591234567` → `+65 9123 4567`). Display keys off the STORED digits,
  not a country parameter — a stored number already says what it is, so the
  checkout echo / failed-push card / alerts card stay truthful even for a
  number saved before a country switch. Same for the hand-mirrored
  `formatPhone` pair (`src/lib/customer.ts` + `convex/lib/customer.ts`, audit
  M7 — both updated).
- Counter manual bind stays **loose and plate-less** (cashiers key foreign
  numbers); its helper copy + placeholder are country-aware records.

### What stayed MY on purpose

- `convex/lib/contact.ts` — Kedaipal's own support line (platform, not seller
  data).
- **Lalamove** (`toLalamoveMyPhone`) — the integration is Lalamove MALAYSIA
  and validates area codes per market; `6581234567` → `null` routes dispatch
  to the seller-contact fallback instead of a 422. Pinned by a regression test
  in `convex/lib/lalamove.test.ts` so a future sweep can't "fix" it.
- Rider copy in `src/lib/dispatch-block.ts` / the Lalamove error strings — the
  `+60` requirement there is Lalamove-true.

## Payment rails — `86eyph341`

An SG store's "Mark payment received" dialog offered **DuitNow** and **Touch 'n
Go** (neither exists in Singapore) and **no PayNow**, so a seller who was
genuinely paid by PayNow had to file it under **Other** — after which the
Insights donut and the inbox Method filter told them nothing.

### The enum is not the picker

The one distinction to hold on to, stated in `convex/lib/paymentMethod.ts` and
pinned by `paymentMethod.test.ts`:

- **`ORDER_PAYMENT_METHODS` — what may be STAMPED on an order.** A closed set
  spanning every country, now `cash | duitnow | tng | bank_transfer | fpx |
  card | other | paynow | paylah | nets | grabpay`. It has to span countries
  because **the HitPay gateway stamps whatever rail the buyer actually used** —
  an MY order settled through GrabPay is tagged `grabpay` and must render its
  label, even though MY's picker never offers GrabPay by hand.
- **`COUNTRY_PAYMENT_METHODS: Record<Country, readonly OrderPaymentMethod[]>` —
  what the seller is OFFERED to hand-pick**, in the order they see it.

So: **never gate a label, a filter match, or a stamp on the country list — only
the pickers.** `PAYMENT_METHOD_LABELS` stays a `Record` over the whole enum,
and `paymentMethodLabel` is country-blind.

| Country | Offered, in order |
|---|---|
| **MY** | `cash, duitnow, tng, bank_transfer, fpx, card, other` — **byte-identical to pre-SG-lite**, frozen by a hand-written literal in the test. |
| **SG** | `cash, paynow, paylah, nets, grabpay, bank_transfer, card, other` |

**GrabPay is deliberately absent from MY's picker.** HitPay MY can stamp it, but
no MY seller has asked to hand-pick it; it's one line to add when one does.

**PayLah! is its own option** even though a PayLah!-to-PayLah! transfer usually
settles over PayNow underneath. The tag is the seller recording *what they saw*,
and an SG seller says "he PayLah-ed me" — the seller's vocabulary beats rail
purity for a hand-picked tag. Do not "correct" it into a PayNow alias.

**NETS is picker-only** — a terminal or NETS QR at the counter, not a rail we
mint through HitPay, so it never appears in the connect card's pitch.

### Where the country list is read

Three seller surfaces, each resolving the country off the dashboard retailer
(`RetailerPublic.country`, already resolved — never hardcoded):

1. **Order detail → "Mark payment received"** chips (the reported bug).
2. **Counter checkout → "Paid now"** `<select>`. A resumed draft holding a rail
   the store no longer offers falls back to the country's first rail, because
   seeding a `<select>` with a value that isn't an `<option>` renders it blank.
3. **Orders inbox → Method filter** chips — plus **any method already
   selected** that the country doesn't offer (`methodChoicesFor`). A
   gateway-stamped rail or a deep-linked `?method=` can hold such a value, and a
   selected chip the seller can't see is a filter they can't switch off.

### HitPay rail mapping

`mapHitpayPaymentType` used to drop PayNow into `other` — its own default-branch
comment named `paynow_online`. Now `paynow_online` / `paynow` → `paynow` and
`grabpay` / `grabpay_direct` → `grabpay`. The bare `paynow` form is accepted so
an upstream naming change can't silently demote a real settlement.

### Connect-card copy

`online-payments-card.tsx` told every seller they need an **SSM-registered
business** — the Malaysian registry — and compared payout speed against a direct
**DuitNow** transfer. Both are keyed off the country now (`COUNTRY_COPY`, an
exhaustive `Record`): SG reads **"a UEN — an ACRA-registered business"** and
compares against **PayNow**. The load-bearing lines are untouched in both — the
money lands in the seller's own HitPay account, and Kedaipal adds nothing on top.

The SG fee bullet is deliberately **structural, not a quoted rate**
("lowest on PayNow, higher on cards") — MY keeps its measured "~1.2% for DuitNow
QR". Drop a real SG number in when one is confirmed.

The pitch marks are per country too (`PITCH_CODES`), and **PayNow renders as a
wordmark chip, not a mark**: `public/img/payment/paynow.svg` is a base64 PNG in
an `<svg>` shell — the recurring defect audited in
[`landing-funnel.md`](./landing-funnel.md) — so `METHOD_ICONS` deliberately has
no `paynow_online` entry and a `METHOD_CHIP_LABELS` map keeps the chip reading
"PayNow" rather than the raw API code.

### Not touched

The **buyer-facing manual payment methods** a seller configures
(`convex/lib/payment.ts`) — that's their payout details, a different concept.
The vendor guide `public/guides/hitpay-setup.html` still walks the MY KYC path;
an SG variant is a follow-up.

## What deliberately did NOT change here

- **Subscription billing currency** — per-invoice, chosen by the admin
  (PR #198); `86eyp7hn7` is parked until the SG prospect pays.
- **Marketing/landing copy** (RM examples, MY JSON-LD) — not buyer-blocking.

## Adding a country later

Append to `COUNTRIES`, then let the compile errors walk you through the
`Record` lookups: `COUNTRY_LABELS`, `COUNTRY_CURRENCY`, `COUNTRY_DIAL_CODE`,
`COUNTRY_DELIVERY_MODES`, the Places `REGION_CODES`, the address
`POSTCODE_RULES`, and the phone records in `convex/lib/slug.ts`
(`MOBILE_NSN`/`STORED_MOBILE_PATTERN`/`MOBILE_MESSAGE`/`LOOSE_NORMALIZE`) plus
the schema/copy/flag records in `src/lib/schemas.ts`, `src/lib/format.ts`, and
`ui/my-phone-input.tsx`. Then add the address arms (client
`STRICT_ADDRESS_SCHEMAS` + the server `assertValidState` switch) and widen the
inline `v.union(v.literal(…))` country validators on `retailers` and
`google.autocompleteAddress`.
