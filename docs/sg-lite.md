# SG-lite — Singapore stores on Kedaipal

**Status:** Phase 1 (country field + currency correctness, ClickUp
[`86eynw27f`](https://app.clickup.com/t/86eynw27f)) and the **address variant +
Places unlock + delivery-mode guard**
([`86eynw29u`](https://app.clickup.com/t/86eynw29u)) are built. The phone
(+65) variant rides the sibling tickets `86eynw28q`/`86eynw2dy` and extends
this doc as it lands.

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
current zones are sets of MY states), Delyva/courier-registry SG entries, and
the +65 phone arms (sibling tickets, see above).

## What deliberately did NOT change here

- **Phone validation** — an SG store still can't save a +65 `waPhone` at
  create/settings until `86eynw28q`/`86eynw2dy` land (same PR, per Arif).
- **Subscription billing currency** — per-invoice, chosen by the admin
  (PR #198); `86eyp7hn7` is parked until the SG prospect pays.
- **Marketing/landing copy** (RM examples, MY JSON-LD) — not buyer-blocking.

## Adding a country later

Append to `COUNTRIES`, fill the `Record` lookups (`COUNTRY_LABELS`,
`COUNTRY_CURRENCY`, `COUNTRY_DELIVERY_MODES`, the Places `REGION_CODES`, the
address `POSTCODE_RULES` — compile errors walk you through), add the
phone/address arms in the SG-lite validators (client `STRICT_ADDRESS_SCHEMAS`
+ the server `assertValidState` switch), and widen the inline
`v.union(v.literal(…))` country validators on `retailers` and
`google.autocompleteAddress`.
