# SG-lite — Singapore stores on Kedaipal

**Status:** Phase 1 (country field + currency correctness) built — ClickUp
[`86eynw27f`](https://app.clickup.com/t/86eynw27f). Phone (+65) and address
variants ride the sibling tickets `86eynw28q`/`86eynw2dy` and `86eynw29u` and
extend this doc as they land.

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

## What deliberately did NOT change here

- **Phone validation** — an SG store still can't save a +65 `waPhone` at
  create/settings until `86eynw28q`/`86eynw2dy` land (same PR, per Arif).
- **Address validation / Places region / delivery-mode guards** — `86eynw29u`.
  Until it lands, an SG store must stay on free/flat delivery or self-collect
  (weight zones key off MY states; Lalamove is MY-market).
- **Subscription billing currency** — per-invoice, chosen by the admin
  (PR #198); `86eyp7hn7` is parked until the SG prospect pays.
- **Marketing/landing copy** (RM examples, MY JSON-LD) — not buyer-blocking.

## Adding a country later

Append to `COUNTRIES`, fill the `Record` lookups (`COUNTRY_LABELS`,
`COUNTRY_CURRENCY` — compile errors walk you through), add the phone/address
arms in the SG-lite validators, and extend the Places `REGION_CODES` allowlist.
