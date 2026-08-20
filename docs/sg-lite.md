# SG-lite — Singapore stores on Kedaipal

**Status:** Phase 1 (country field + currency correctness, ClickUp
[`86eynw27f`](https://app.clickup.com/t/86eynw27f)) and Phase 2 (phone +65 —
buyer checkout [`86eynw28q`](https://app.clickup.com/t/86eynw28q) + seller-side
fields [`86eynw2dy`](https://app.clickup.com/t/86eynw2dy), one PR) built. The
address variant rides the remaining sibling `86eynw29u` and extends this doc
when it lands.

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

## What deliberately did NOT change here

- **Address validation / Places region / delivery-mode guards** — `86eynw29u`.
  Until it lands, an SG store must stay on free/flat delivery or self-collect
  (weight zones key off MY states; Lalamove is MY-market).
- **Subscription billing currency** — per-invoice, chosen by the admin
  (PR #198); `86eyp7hn7` is parked until the SG prospect pays.
- **Marketing/landing copy** (RM examples, MY JSON-LD) — not buyer-blocking.

## Adding a country later

Append to `COUNTRIES`, fill the `Record` lookups (`COUNTRY_LABELS`,
`COUNTRY_CURRENCY`, `COUNTRY_DIAL_CODE`, and the phone records in
`convex/lib/slug.ts` — `MOBILE_NSN`/`STORED_MOBILE_PATTERN`/`MOBILE_MESSAGE`/
`LOOSE_NORMALIZE` — plus the schema/copy/flag records in `src/lib/schemas.ts`,
`src/lib/format.ts`, and `ui/my-phone-input.tsx`; compile errors walk you
through every one), add the address arm in the SG-lite validators, and extend
the Places `REGION_CODES` allowlist.
