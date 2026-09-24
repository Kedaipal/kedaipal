# Phone numbers — whose number it is decides the rule

**Status:** shipped (dev) — [`z8r3fdh274`](https://app.clickup.com/t/z8r3fdh274):
buyers can give a WhatsApp number from **any country**. It settles the product
call [`z8r3fdbmcb`](https://app.clickup.com/t/z8r3fdbmcb) (online checkout was
locked to the store's country, so an SG buyer on a Johor storefront bounced
with no way forward) wider than that ticket's own option B — any country, not
just the other supported one — and folds in
[`86eyqug8w`](https://app.clickup.com/t/86eyqug8w) (the counter's manual bind
took foreign numbers with nothing on screen saying so). The trigger was
Helinox Community Malaysia's Into The Falls registration: 90–110 participants
from Singapore, Indonesia, Vietnam, Japan, Korea and more, on a Malaysian
store.

This is the canonical phone doc. [`sg-lite.md`](./sg-lite.md) keeps the
history of the MY/SG strict arms, [`design-system.md`](./design-system.md) the
plate as a UI primitive, and the courier, HitPay and opt-out docs their own
slices — each points here for the rules.

## The rule: three kinds of number, three validators

A phone number's rules follow **whose number it is**, not which screen it is
typed on. Never judge one kind with another kind's validator.

| Kind | Whose | Accepts | Validator | Control |
|---|---|---|---|---|
| **Buyer** | the person ordering, booking, or being rung up | **any country**, judged by the country **picked** on the field | `assertValidBuyerWaPhone` / `parseBuyerWaPhone` ([`convex/lib/buyerPhone.ts`](../convex/lib/buyerPhone.ts)) | `BuyerPhonePrefix` / `BuyerPhoneInput` — the plate **with a country picker** |
| **Seller / platform** | the store (its identity, the couriers' sender contact) or Kedaipal itself | a mobile of the **store's** country (Kedaipal's own: MY) | `assertValidMobileForCountry(raw, retailer.country)` ([`convex/lib/slug.ts`](../convex/lib/slug.ts)); `assertValidMyMobile` for platform numbers | `MyPhonePrefix` / `MyPhoneInput` — a **fixed** plate |
| **Machine-inbound** | whatever Meta just delivered | 8–15 digits, never refused | `assertValidWaPhone` / `normalizeWaPhone` (`convex/lib/slug.ts`) | none — no human types it |

### Buyer numbers — every surface

| Surface | Component | Mutation (arg) |
|---|---|---|
| Storefront checkout | `src/components/storefront/checkout-form.tsx` — form-bound `TextField prefix={<BuyerPhonePrefix …/>}`, judged by `checkoutFormSchemaFor` (`src/lib/schemas.ts`) | `orders.create` (`customer.waDialCountry`) |
| Booking checkout | `src/components/storefront/booking-checkout-form.tsx` — `BuyerPhoneInput` | `bookings.requestBooking` (`customer.waDialCountry`) |
| Track-page number repair | `src/components/storefront/buyer-phone-repair-form.tsx`, mounted by `PushFailedCard` in `src/routes/track.$token.tsx` | `orders.updateBuyerPhone` (`waDialCountry`) |
| Counter manual bind | `src/components/counter/manual-bind-dialog.tsx` | `counterCheckout.bindSessionManualPhone` (`waDialCountry`) |

Event RSVPs and made-to-order orders ride the storefront checkout and the
counter, so they inherit it. Two buyer-number surfaces have **no** field: the
claim page shows the number the link was sent to, locked (it came from the
counter session); and the admin opt-out panel reads buyer numbers through the
same parser (see [Opt-outs](#opt-outs)).

### Seller / platform numbers — still store-locked

- the store's contact `retailers.waPhone` — Settings → WhatsApp contact,
  onboarding, admin "Onboard a client" (`retailers.createRetailer`,
  `updateSettings`);
- the seller-alert number `retailers.notifyWaPhone` (`updateSettings`);
- a pickup point's manager `managerWaPhone` (`pickupLocations` create/update);
- Kedaipal's own support line `SUPPORT_WA_PHONE` (`convex/lib/contact.ts`,
  MY-fixed platform data).

A store has exactly one country, its number is its identity on the storefront,
and it is the courier's pickup contact — which only a number from the booking's
own country can be (see [Couriers](#couriers--the-stores-number-when-the-buyers-is-foreign)).
Their cross-country rejection copy is `mobileRejectionMessage`
([`sg-lite.md` § Cross-country rejection copy](./sg-lite.md#cross-country-rejection-copy--z8r3fdbmc9)).

### Machine-inbound numbers — loose on purpose

Meta's inbound `from`: the ORD-message relink (`convex/whatsapp.ts`), the
counter's store-QR scan (`startSessionFromStoreQr`), STOP/START opt-outs
(`registerOptOut` / `reactivateOptIn`, keyed via `normalizeWaPhone`) and the
customer backfill. WhatsApp just delivered a message from that number;
refusing it would only lose data.

## Why this is not a reversal of `86eyknr2r`

[`86eyknr2r`](https://app.clickup.com/t/86eyknr2r) (12 Aug) removed a
250-country searchable combobox (`react-phone-number-input` + `cmdk`) as "a
control with one valid answer", and `z8r3fdbmc9` rejected a per-field country
dropdown on the plate because the plate's country is a consequence of the
store's. **Both arguments are about the store's own numbers, and both still
hold there** — seller plates are unchanged and still fixed.

The premise was never true of a buyer. A buyer's number is per-person — the
Singaporean ordering from a Johor cake shop, the Japanese participant in a
Malaysian event, the tourist at the counter — so for a buyer field the store's
country is not "the one valid answer", only the likeliest one. The right
control is a picker defaulting to it. The plate's promise ("the country I show
is the country the save judges by") still holds, because the validator now
judges by the **picked** country.

What did **not** come back: the combobox, its two dependencies, the flag
barrel. The picker is a native `<select>` over the same plate, and the runtime
ships a table of dial codes. The one exception `86eyknr2r` left — the counter's
bare, loose manual bind as "the path for a foreign walk-in" — is retired: the
counter wears the buyer picker like every other buyer field.

## The picker

`src/components/ui/my-phone-input.tsx`, beside the seller plate. Two hosts, one
plate: form-bound `TextField prefix={<BuyerPhonePrefix …/>}` with the field's
`onChange` routed through `applyBuyerPhoneKeystroke`, and plain-state
`BuyerPhoneInput`. Both render through `InputPrefixFrame`.

- **A native `<select>`, on purpose.** It sits invisibly (opacity 0) over the
  whole plate, padding included, so the 44px plate is the tap target. The OS
  picker is the mobile-friendly, accessible, zero-dependency list: an iOS
  wheel, an Android sheet, desktop type-ahead. It is `text-base` (16px) so iOS
  Safari doesn't zoom on focus. The plate paints the MY/SG inline SVG flag or,
  for every other country, a 28×14 ISO badge (same footprint, so the plate
  doesn't change width), then the dial code and a chevron. A hover wash says
  "tap me" on desktop. **Keyboard focus shows on the plate**: the select is
  invisible, so a Tab onto it paints the same wash plus an inset ring
  (`peer-focus-visible`), distinct from the frame's ring around the input —
  otherwise a keyboard user can't tell the picker from the number.
- **Order.** The store's country first. Then a **Nearby** group
  (`NEARBY_DIAL_COUNTRIES` — an MY store gets SG, BN, ID, TH, PH, VN; an SG
  store gets MY, ID, BN, TH, PH, VN — the JB↔SG corridor and the neighbours
  whose buyers actually turn up). Then **All countries** A–Z by English name,
  with the neighbours repeated so an alphabetical scroll never misses one.
  Options read `Japan (+81)`.
- **Accessible name.** "Country of your WhatsApp number" on the buyer's own
  screens. The counter passes `countryLabel="Country of the buyer's WhatsApp
  number"`, because there the cashier keys someone else's number. The select
  never carries `aria-invalid`: the error belongs to the number, and focus on
  error must land in the input.
- **Auto-switch on a typed code.** A `+CC…` or `00CC…` moves the picker to
  that country and leaves only the national part in the box, so the plate never
  reads `+81 | +81 90…` (`applyBuyerPhoneKeystroke` →
  `detectTypedDialCode`, `convex/lib/phoneDial.ts`). It waits until the code
  is complete. A shared code keeps a pick that answers to it (Canada picked,
  `+1` typed, stays Canada). **Bare digits never switch anything.**
  - **Only when the code arrives at the start of the number**: typed on from
    the end (the new value starts with the old one), or inserted in bulk at
    the front — a paste or an autofill, two or more characters, including a
    select-all paste that replaces a number of similar length (the edit is
    found by comparing the old and new values' common prefix and suffix). A
    space typed right after a code the plate absorbed is dropped, so the box
    never starts with a blank. A single `+` slipped
    in front of digits already in the box is left alone: calling codes are
    prefix-free, so `+12-345 6789` would complete `+1` on the spot, jump the
    plate to the United States and eat the `1`. The submit-time parse still
    reads an explicit code there, and under an MY/SG pick falls back to the
    local reading when it isn't one ([the `+local`
    fallback](#the-server-contract)).
  - The keystroke is read through the same input cleaning as the parse, so a
    pasted `+44 …` wrapped in invisible bidi marks still switches.
- **One-tap switch.** Digits that don't fit the pick but do fit the other
  supported store country (`9123 4567` under +60) are refused with "That looks
  like a Singapore mobile number — switch the country to +65", and
  `BuyerPhoneCountrySwitch` renders **Switch to Singapore (+65)** (BM: "Tukar
  ke …"). The same happens for a Malaysian or Singapore number typed under a
  **foreign** pick — even where that country's length would take it (the
  Nearby neighbours are a slip of the thumb away, and `12-345 6789` is a
  Thai-length number), unless the country's mobile pattern vouches for it ([the wrong-pick
  refusal](#the-server-contract)). This is detection for the fix only, never
  for acceptance. The button fixes the number, so it unmounts the moment it is
  pressed; it takes the phone input's `inputId` (required) and **hands focus
  back to the field**, rather than letting it fall to the top of the page.
- **Placeholders** (`buyerPhonePlaceholder`). The store countries show a real
  example (`12-345 6789`, `9123 4567`). Every other country shows "Mobile
  number": we have no per-country example, and a made-up one is a format the
  buyer then can't match.
- **When the error speaks.** The plain-state hosts share one rule,
  `buyerPhoneRejection` (`src/lib/buyer-phone-rejection.ts`): never on an empty
  field, not on the first keystrokes (it waits for a blur or a submit), except
  at once when the one-tap switch applies, because that rejection carries its
  whole fix. The storefront checkout keys on TanStack Form's `isTouched`
  instead, so there even the one-tap switch waits until the field has been
  left. The invalid state keeps its red border and ring under focus
  (`InputPrefixFrame`), where the focus ring used to repaint it mint exactly
  while the user was fixing it.
- **Echo line.** Once the number parses, the storefront and booking checkouts
  echo it back grouped (`formatMobile`) for typo-spotting, under `MASK_PII`.
- **Defaults are derived, never copied into state.** Each host holds
  `picked ?? default`. The default is the store's country (checkout, booking,
  counter). The repair form opens on the country of the number that failed
  (`splitStoredPhone`), else the store's — a buyer who typo'd a Japanese number
  most likely retypes a Japanese one. Copying the store country into state at
  mount would open an SG store's counter on +60 while the retailer row loads.
  The counter's form unmounts with its dialog, so every open starts clean.

**Where each side is told.** The buyer: the chevron plate, rejection copy that
points at the picker ("…or tap +60 to change the country"), the one-tap switch, and the
overseas-number delivery note ([below](#telling-the-buyer-at-checkout--bookscouriers)).
The cashier: the dialog's help line — "Serving a visitor? Tap +60 to pick their
country.", then "Number from Japan — tap +81 to change it." after a pick — and
a disabled-with-reason line under **Start checkout**. The seller: the dispatch
cards' contact notices ([Couriers](#couriers--the-stores-number-when-the-buyers-is-foreign)).

## The server contract

`waDialCountry` is an optional ISO string on all four mutations. It is **never
stored**: `orders.customer` is built field by field, never spread from the
args.

- **Absent or `""` means the store's country** (`resolveBuyerDialCountry`). An
  old client, every legacy caller and every existing test are byte-identical.
  It had to be optional: production deploys Convex before Cloudflare, so the
  old frontend meets the new backend first.
- **An unknown code is refused, not defaulted** — "Pick the country your
  WhatsApp number is from". A client sending garbage should find out. The four
  [excluded countries](#the-four-excluded-countries) are unknown codes.
- **The input is cleaned first** (`cleanPhoneInput`, `convex/lib/phoneDial.ts`),
  before any arm: NFKC (full-width `０１２`, `＋`), invisible format characters
  removed (`\p{Cf}` — the bidi marks WhatsApp and the contacts app wrap a
  copied number in, U+202A…U+202C, U+2066…U+2069, U+200E, which hid a leading
  `+`), and every script's decimal digits mapped to ASCII (Arabic-Indic,
  Persian, Devanagari, Thai…), which a bare `\D` strip would silently **drop**,
  turning one number into another. The auto-switch and the opt-out panel read
  through the same function.
- **An MY or SG pick keeps the strict arm's acceptances**
  (`assertValidMobileForCountry`): local `012-345 6789`, the bare national
  number, `60…`, and landlines refused. Everything it accepted before is still
  accepted with the same digits; only the rejection copy changed, to point at
  the picker. A local buyer who never touches the picker sees no change; a test
  pins equality with the strict arm.
- **The `+local` fallback.** A Malaysian or Singaporean who habitually writes a
  `+` in front of their local number (`+012-345 6789`) was accepted by the
  strict arm before the picker existed. That `+` reads as an explicit code
  first; when the code doesn't parse as a number, an MY/SG pick gives its own
  strict arm the same chance it always had. Foreign picks don't — the typed
  code's own rejection stands.
- **Any other pick** (`parseForeign`) — libphonenumber's data, generated into
  `dialCodes.ts` and `dialMobilePatterns.ts`:
  1. **Every reading of the digits is tried**: as typed; without the
     country's **own** trunk prefix; through libphonenumber's trunk-parsing
     rule (`DIAL_TRUNK_RULES` — Argentina's `0 11 15 2345-6789` →
     `9 11 2345 6789`, Belarus's `8 0…`); and, when no `+` was typed, each of
     those again without a leading calling code (`62 812…` under Indonesia —
     the wa.me habit).
  2. **The reading that matches the country's MOBILE pattern wins**
     (`DIAL_MOBILE_PATTERNS`, anchored, within the mobile lengths). Length
     can't decide this: `628123456789` under Indonesia is 12 digits — itself a
     valid Indonesian length — and only the pattern (Indonesian mobiles start
     `8`) says the `62` is the code, not part of the number.
  3. **No reading matches → the length decides** (lenient on purpose): the
     code typed without `+` is peeled only when the digits don't already fit as
     typed; the own trunk prefix is stripped only when what is left is a valid
     length; the national length must be a mobile length; a national number
     that starts like a trunk is refused (a `0` where the country has a trunk
     prefix, a `1` across +1); at most 15 digits in all (E.164). A pattern can
     post-date a newly opened range, and refusing a real buyer is worse than a
     failed push the track page's repair recovers.
  4. **The wrong-pick refusal.** Bare digits that failed, or that only a
     length vouches for under one of the **Nearby** countries (a slip of the
     thumb below the store's own), and that are plainly a Malaysian or
     Singapore mobile, are refused with the switch copy and `suggest` — a
     wrong pick, not a new foreign range. Before this, `012-345 6789` under
     Thailand was stored as `66123456789`. **Only Nearby:** further away the
     same digits are a real local number — Buenos Aires' `11 2345-6789` is
     also the shape of a Malaysian `011` mobile — and offering "switch to +60"
     would store a stranger's Malaysian number. A typed `+CC` is taken at its
     word.

  The stored value is `dial + national`.
- **An explicit `+CC` / `00CC` is honoured over the pick.** The person typed
  the country code, so this is not sniffing, and it is what the picker's
  auto-switch does on the client — the two always agree. `+60`/`+65` route back
  to the strict arm.
- **Bare digits are never sniffed for acceptance.** A local number can begin
  with anything a calling code begins with; sniffing is how a typo in one
  country's shape gets silently accepted as another's (SG-lite's rule, kept).
  They are sniffed only to refuse with a fix — the one-tap switch and the
  wrong-pick refusal above — never to accept.

The rejection copy is written by the server module and run on the client too:

| Case | Message |
|---|---|
| empty | Enter your WhatsApp number |
| unknown pick | Pick the country your WhatsApp number is from |
| `+CC` that no country uses | That country code isn't one we recognise — check the number |
| MY/SG pick; the digits fit the other one | That looks like a Singapore mobile number — switch the country to +65 |
| MY/SG pick; anything else | the strict arm's `MOBILE_MESSAGE` plus the picker — "Enter a Malaysian mobile number (e.g. 012-345 6789), or tap +60 to change the country" |
| any other pick; the digits are plainly an MY/SG mobile | That looks like a Malaysian mobile number — switch the country to +60 |
| any other pick; wrong shape | Enter a valid Japan mobile number, or tap +81 to change the country |

A buyer's MY/SG rejection no longer says "this store takes Malaysian numbers"
(`crossCountryMobileMessage` now serves seller fields only) — that stopped
being true of a buyer.

**One parser, client and server.** `buyerPhone.ts` is a pure module.
`checkoutFormSchemaFor` judges `waPhone` in an object-level refinement (it reads
two fields) with `parseBuyerWaPhone`; Zod 4 still runs it while other fields
hold issues, so a blank name can't hide a bad number until the second submit.
The plain-state hosts call `parseBuyerWaPhone` directly.

## The generated dial table

`convex/lib/dialCodes.ts`, `convex/lib/dialMobilePatterns.ts` and
`convex/lib/dialCountryNames.ts` are **generated — never hand-edit them** — by
`scripts/generate-dial-codes.mjs`, from Google's libphonenumber metadata via
`libphonenumber-js` (an exact-pinned **devDependency**: only the script and the
oracle test import it, and it never ships in a bundle).

```bash
pnpm install                          # the devDependency
node scripts/generate-dial-codes.mjs  # rewrites all three modules
```

Re-run it after bumping `libphonenumber-js` (a numbering plan changed), then
review the diff. `convex/lib/phoneDial.test.ts` pins the table's invariants and
the rows the product leans on; `convex/lib/buyerPhone.test.ts` pins the parse
against libphonenumber fixtures, and `convex/lib/buyerPhone.oracle.test.ts`
checks every country against libphonenumber itself
([below](#e164-digits-what-meta-delivers-and-the-crm-key)). Today: 241 rows —
libphonenumber-js 1.13.13's 245 regions minus four.

| Field | Meaning |
|---|---|
| `iso` | ISO 3166 alpha-2, plus libphonenumber's non-ISO regions (AC Ascension Island, TA Tristan da Cunha, XK Kosovo). The `DialIso` type is derived from it. |
| `dial` | The ITU calling code, 1–3 digits. Codes are prefix-free, so a stored number's code is its first 1–3 digits that match a row (`splitStoredPhone`). |
| `trunk` | The national (trunk) prefix a local dials before the number, or `null` where the leading digit is **part of** the number. |
| `lengths` | National significant number lengths of a **mobile** there — the country's general lengths when libphonenumber lists none of its own for mobiles. |
| `main` | The country a shared code resolves to when nothing else says which (US for +1, GB for +44, RU for +7) — exactly one per code. |

`dialMobilePatterns.ts` carries two maps beside the table:

- **`DIAL_MOBILE_PATTERNS`** — each country's MOBILE national-number pattern,
  anchored by the caller. The +1 countries and Tristan da Cunha publish none of
  their own (their numbers are fixed-line-or-mobile), so the country's general
  pattern stands in. It picks the **reading** and spots a wrong pick; it never
  rejects a length-valid number on its own.
- **`DIAL_TRUNK_RULES`** — libphonenumber's trunk-parsing rule, and the
  transform that rewrites the match where the number itself changes, for the
  44 countries whose trunk habit is more than dropping `trunk`: Argentina's
  `0 11 15 …` (the `15` becomes the mobile `9`), Belarus's `8 0…`.

**Why trunk prefixes are per country, never "strip a leading 0".** In the
table, 109 countries dial `0`, 101 dial nothing at all, and the rest dial
something else:

- **Italy and Côte d'Ivoire have no trunk prefix** (nor do Singapore, San
  Marino or the Vatican). The `0` of Rome's `06…` or an Ivorian `07…` is part
  of the number, and stripping it would store a different number.
- **Russia's trunk is `8`** (Kazakhstan, Belarus and Turkmenistan too).
- **The +1 zone's is `1`** (NANP, plus the Marshall Islands).
- **Hungary's is `06`.**

The ticket first specified "strip one leading 0"; that would have corrupted
Italian and Ivorian numbers and missed the rest. And the prefix is stripped
only when what is left is a valid length — a Russian number that happens to
begin with `8` must not lose it.

**Why names are frozen.** English names are taken from `Intl.DisplayNames` at
generation time and written into the module, not computed at runtime. CLDR
differs across runtimes ("Turkey" vs "Türkiye"), so the Worker's SSR and each
browser would otherwise disagree about a label. The flip side: regenerating on
a Node with a different ICU can rename rows — another reason to read the diff.
Names are English only; BM and ZH stores show English country names.

**Why three modules.** `dialCodes.ts` carries no names and no patterns,
because the display helpers (`formatMobile`, `formatPhone`) need it and reach
nearly every bundle. `dialCountryNames.ts` is imported only by the picker and
by `buyerPhone.ts`'s rejection copy; `dialMobilePatterns.ts` only by
`buyerPhone.ts`. The known cost: `src/lib/schemas.ts` imports `buyerPhone.ts`,
so every bundle that imports the schemas module carries the names (about 5 KB)
and the patterns (about 24 KB, 9 KB gzipped), seller settings included. The
patterns compile lazily, one country at a time, on first use.

### The four excluded countries

**Cuba, Iran, North Korea and Syria (CU, IR, KP, SY)** are left out of the
generated table. Meta's WhatsApp Business Messaging Policy bars messaging users
in sanctioned jurisdictions, so a buyer there could pass checkout and never
receive the confirmation. They are not in the picker, `resolveBuyerDialCountry`
refuses them as unknown, and a typed `+98…` is an unknown code.

The sanctioned regions of Ukraine share +380 with the rest of the country, so
no dial table can exclude them. Meta's per-send error **130497** ("business
account is restricted from messaging users in this country") covers them, and
any country the shared number is barred from later. It classifies as
`unreachable` ([below](#push-failures--130497)).

## E.164 digits: what Meta delivers, and the CRM key

Every buyer number is stored as E.164 digits without the `+` —
`447911123456` — which is exactly Meta's inbound `from` for the same person.
Customers are keyed by `(retailerId, waPhone)`, so a buyer who types their
number at checkout and later messages the shared number, or scans the counter
QR, lands on the **same** customer row. A mismatch would fork them into a
duplicate CRM row and send to a dead number.

The parse is pinned against libphonenumber twice. `buyerPhone.test.ts` holds
fixtures: JP `090-1234-5678` → `819012345678`, GB `07911 123456` →
`447911123456`, HU `06 30 123 4567` → `36301234567`, CI `07 07 12 34 56` →
`2250707123456`, and more. **The oracle**, `buyerPhone.oracle.test.ts`, takes
libphonenumber's own example mobile for **every** country in the picker and
types it the five ways buyers do — the bare national number, national with
the trunk prefix, the calling code without its `+`, `+CC …` and `00CC …` — and
each must store exactly libphonenumber's E.164 digits. Hand-picked fixtures
missed what it caught: a length-only check stored `628123456789` under
Indonesia as `62628123456789`.

No country column is stored — the country is in the digits
(`splitStoredPhone`). For a shared code the ISO is display-only and defaults to
the main country.

At the counter, the manual bind and the store-QR scan now store the same
digits for the same buyer, so either one re-claims the other's open session.

## Downstream consumers

| Consumer | With a number from another country | Where |
|---|---|---|
| WhatsApp sends, `wa.me` | nothing special — any country's digits | `convex/lib/channels/` |
| Couriers (Lalamove, Delyva) | the courier gets the **store's** number; the buyer's goes in the notes | `convex/lib/courierContact.ts` |
| Checkout and claim page | a delivery note when the store books couriers | `src/lib/overseas-courier-note.ts` |
| HitPay | the phone is left off the payment request | `convex/lib/hitpay.ts` |
| Opt-outs | the admin panel takes any country | `convex/lib/optOutPhone.ts` |
| Confirmation push | 130497 reads as `unreachable` | `convex/lib/confirmationPush.ts` |
| Display | `+CC NATIONAL` | `formatMobile`, `formatPhone` |
| Inbox search | a trunk-0 search still finds it | `convex/lib/orderInboxFilter.ts` |
| Receipt / invoice PDF | printed through `formatPhone` | `convex/lib/pdf/document.ts` |

### Couriers — the store's number when the buyer's is foreign

Couriers book inside one country and take a contact number only from it
(Lalamove 422s a +65 contact on a Malaysian booking, and a +60 one on a
Singapore booking). `toDomesticContactPhone(waPhone, country)` is the one
provider-neutral answer: MY is `60` + 9–11 digits, SG is `65` + exactly 8. It is
a **country** check, not a mobile check — a rider can phone a landline. Null
means foreign, and the booking falls back to the store's own number:

- **Lalamove** (`toLalamoveContactPhone` delegates to it). The buyer's stop
  gets the store's number; `Buyer WhatsApp: +…` rides the remarks right after
  the order ref, where the 400-character cut can't reach it. On a collection
  trip the buyer's stop is the **pickup**, so that is where the fallback lands,
  and the remarks ride the recipient stop — the store, the only remarks slot
  in v3. The confirm dialog's notice names the store's market and the direction
  (`riderContactFallbackCopy`, `src/lib/dispatch-block.ts`); `prepareBooking`
  returns the `market` for it.
- **Delyva** (`buyerContactPhone`, `convex/delyva.ts`). The same rule, with
  `Buyer WhatsApp: +…` **first** in the booking note (`buildCreateOrderBody`
  cuts it at 400). A store with no number keeps the buyer's (a foreign contact
  beats an empty one), and an order with no buyer number is not "overseas".
  `getDispatchState` returns `country` and `buyerContactFallback`, and the card
  says so before the first quote (`courierContactFallbackCopy`). This also
  covers orders that already carried foreign numbers from the inbound
  WhatsApp path.
- **The seller's own number must be domestic** — Lalamove dispatch blocks on
  `no_seller_phone` otherwise.

See [`delivery-lalamove.md` § Phones](./delivery-lalamove.md#phones--contacts-come-from-the-bookings-market)
and [`delivery-delyva.md` § Contact phones](./delivery-delyva.md#contact-phones).

### Telling the buyer at checkout — `booksCouriers`

When a store books couriers and the buyer's number is foreign, the rider calls
the store, not the buyer. That changes what happens at the door, so the buyer
is told on the delivery step instead of finding out there.
`overseasCourierNote` renders on the storefront checkout and the claim page,
with a collection wording ("the rider collecting from you") and a BM variant.
It never says order updates might not arrive — WhatsApp reaches every country;
only the rider's call is rerouted. Nothing renders for a local number,
self-collect, or a store that doesn't book couriers.

- Checkout decides on the **picked** country (`dialCountry !== storeCountry`).
  The claim page already knows the number, so it asks the courier rule
  (`toDomesticContactPhone`).
- `booksCouriers` is `storeBooksCouriers(retailer)`
  (`convex/lib/courierBooking.ts`): Lalamove armed (booking enabled and
  `riderBookingAllowed`) **or** Delyva armed (credentials, enabled and
  `delyvaBookingAllowed`) — the same predicates the dispatch cards'
  `bookingEnabled` now read. It is exposed as **one public bit** on
  `getRetailerBySlug` and on `orderClaims.getByToken`'s `store` block; the
  courier config never leaves the owner reads.
- Plan gating is deliberately not read: it would cost the hot public
  storefront read a subscription lookup. A lapsed store with booking still on
  reads true, which at worst shows a note that turns out moot.

### HitPay — the phone only for the store's own country

`buildPaymentRequestParams` sends `phone` only when the stored digits match
`STORED_MOBILE_PATTERN[storeCountry]` — the set every checkout number belonged
to before this change, and the only set a sandbox run has verified. HitPay
documents nothing beyond "E.164"; a 422 over a foreign (or cross MY↔SG) number
would surface as `GATEWAY_DOWN` and kill Pay-now for that order, while the
phone buys us nothing (`send_sms=false`, never read back). See
[`hitpay-gateway.md`](./hitpay-gateway.md).

### Opt-outs

The admin opt-out panel is the one buyer-number field with no store behind it
and no picker beside it. `readOptOutPhone` (`convex/lib/optOutPhone.ts`, shared
by the server and the panel) cleans the input like every buyer field
(`cleanPhoneInput` — a number pasted out of WhatsApp, bidi marks and all, or
written in another script's digits keys as if typed), then tries MY strict, SG
strict, an explicit international prefix, and bare digits read as if typed with
a `+`. The status line names the country it read the number as, because a
mistyped number can now read as a real foreign one. Status and Re-activate also
find a row by its exact digits, so a STOP from a `wa_id` no parser produces
(Mexico's `521…`) can still be undone. See [`waba-protection.md` § Manual opt-out](./waba-protection.md#manual-opt-out-admin-2026-08-17-clickup-86eyn25gu).

### Push failures — 130497

`130497` (the business account is restricted from messaging users in this
country) now classifies as **`unreachable`**, not `system`. No retry fixes it,
and as `system` it would have hidden the buyer's **Update my number** repair and
told the seller the number looks fine — when the buyer's way forward is a
number from a country we can reach. The buyer and seller copy both name the
possibility ("…or be in a country we can't message on WhatsApp yet"). See
[`order-lifecycle.md`](./order-lifecycle.md#the-confirmation-push--the-order-commits-at-place-order-86eyf1rck).

### Display

- **`formatMobile`** (`src/lib/format.ts`, the typo-spotting echo lines): MY
  and SG mobiles grouped (`+60 12-345 6789`, `+65 9123 4567`); any other
  country `+CC NATIONAL` with the national part broken into **3–4 digit
  groups** (`+44 791 112 3456`), which makes a wrong code visible and keeps the
  run short enough to check a digit at a time — the echo exists to catch a
  transposed digit, which an unbroken ten-digit run defeats. The grouping is a
  reading aid, deliberately NOT a national convention: those disagree at the
  same length (a 10-digit UK mobile reads `7911 123456`, a Japanese one
  `90 1234 5678`), and shipping libphonenumber's per-country format rules would
  put them in every bundle that renders a phone number. A national part of 5
  digits or fewer is left whole. An MY/SG **non-mobile** stays
  one unbroken `+60312345678`, so `toNationalPhoneInput` can never seed a
  seller field with its country code silently dropped; no known code →
  `+<digits>`.
- **`formatPhone`** (seller dashboard, CRM, the receipt and invoice PDFs):
  `+60 …` / `+65 …`, grouped `+CC NATIONAL` for any other country,
  `+<digits>` as the fallback. **One implementation** in `convex/lib/customer.ts`;
  `src/lib/customer.ts` re-exports it. The hand-kept mirror is gone — it would
  have drifted the first time the phone format changed.

### Inbox search

Phone search matches trailing digits, and now also tries the typed digits with
leading zeros stripped (at least 4 left): `07911 123456` finds `447911123456`.
Malaysia only ever matched by luck — `60` ends in the trunk `0` — and Singapore
has no trunk. See [`order-inbox.md`](./order-inbox.md).

## Two kinds of "country"

- **`Country`** (`convex/lib/country.ts`) — the closed set a **store** can be
  in (MY, SG). Currency, address rules, seller phone fields and courier markets
  key off it, exhaustively.
- **`DialIso`** (`convex/lib/phoneDial.ts`) — the open set a **buyer's**
  number can come from. Only the buyer phone fields and the opt-out panel use
  it.

A new **store** country is the SG-lite checklist
([`sg-lite.md` § Adding a country later](./sg-lite.md#adding-a-country-later)).
Its dial row already exists; the `Record<Country, …>` maps this feature added
(`NEARBY_DIAL_COUNTRIES`, `DOMESTIC_PHONE`, `MARKET_NUMBER_ADJECTIVE`, the
Malay country names in `overseas-courier-note.ts`) turn into compile errors.
A new **buyer** country needs nothing — only a regenerated table if
libphonenumber adds one.

## Known limitations

- **A number the mobile pattern misses is still accepted by its length.**
  Outside MY and SG the pattern chooses between readings; it does not reject.
  That is deliberate — a newly opened mobile range can post-date the metadata,
  and refusing a real buyer is worse than a failed push — and it means a
  length-valid landline still passes: an Italian `06 1234 5678` (Rome) is
  stored as `390612345678`. The backstop is the confirmation push: a number
  with no WhatsApp fails as `unreachable`, and the track page's **Update my
  number** repair is how the buyer recovers. The one exception is the
  [wrong-pick refusal](#the-server-contract): a length-only number that is
  plainly Malaysian or Singaporean is refused with the one-tap switch.
- **Meta's `wa_id` is not always E.164.** Mexico's legacy `521…` accounts
  and Brazilian accounts from before the ninth digit arrive inbound in a
  different form from the E.164 digits a checkout stores (`52 55…`,
  `55 11 9…`). For those buyers the customer row can fork, and a STOP
  registers under the `wa_id` form while gated sends check the typed key, so
  it won't suppress them (transactional confirmations bypass the gate anyway);
  the ORD relink can miss too. Rare for MY/SG stores — a follow-up, not
  handled here beyond the opt-out panel's exact-digits lookup, which lets the
  admin find and re-activate such a row. Argentina is narrower than it was:
  its trunk-parsing rule turns the local `0 11 15 …` into the `9…` form
  WhatsApp uses, and only a number typed without its `9` or `15` after an
  explicit `+54` is still stored as typed.
- **The template language follows the store, not the buyer.** The confirmation
  renders in the store's locale (`TEMPLATE_LANGUAGE`: en or ms; zh reads en), so
  a Japanese buyer at a BM store reads Malay.
- **Meta bills per recipient country.** A confirmation to the UK, India or
  Indonesia is priced differently from one to Malaysia, and it always goes out
  (transactional bypasses the WABA gate). No per-country cost is metered yet.
  See [`infra-cost-scaling.md` § 3](./infra-cost-scaling.md#3-the-whatsapp-cost-model-read-this-before-touching-tiers).
- **An SG store armed only with Delyva may show the courier note for nothing.**
  `booksCouriers` reads true, but Delyva's SG tenant ships an empty courier
  catalogue in practice, so no courier may ever be booked. The note only says
  the rider will call the store, so it misleads rather than harms; the fix is
  a courier-market check in `delyvaBookingArmed`.
- **Rejection copy is English.** The server's and schemas' messages are EN; the
  one-tap switch and the overseas note are EN/BM.
- **Whether Delyva's downstream couriers ever refused foreign numbers is
  unverified.** The store-number fallback applies either way.
- **The manual-courier despatch label** prints the buyer's number as stored —
  a foreign number on a domestic label, with no warning. Left as a design call.

## Tests

`convex/lib/buyerPhone.test.ts` (libphonenumber fixtures, trunk rules, the
MY/SG equality pin, the wrong-pick refusal, the `+local` fallback, copy),
`convex/lib/buyerPhone.oracle.test.ts` (every country × five typed forms
against libphonenumber), `convex/lib/phoneDial.test.ts` (table invariants, the
excluded countries, split, auto-switch, input cleaning),
`convex/lib/optOutPhone.test.ts` (pasted and script-digit input too),
`convex/lib/courierContact.test.ts`, `convex/lib/courierBooking.test.ts`; the
mutations in `orders.test.ts`, `bookings.test.ts`, `counterCheckout.test.ts`,
`lalamove.test.ts`, `delyva.test.ts`, `hitpay.test.ts`, `wabaProtection.test.ts`,
and `seasonalHold.test.ts` + `counterCheckout.test.ts`, which pin that a paused
or lapsed store says so **before** any complaint about the number (they send
unusable numbers — a valid one can't tell which check ran first);
and on the client `my-phone-input.test.tsx`, `manual-bind-dialog.test.tsx`,
`buyer-phone-repair-form.test.tsx`, `booking-checkout-form.test.tsx`,
`buyer-phone-rejection.test.ts`, `overseas-courier-note.test.ts` and
`schemas.test.ts`.
