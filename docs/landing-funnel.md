# Landing funnel — money math, guarantee, one CTA, payment strip

ClickUp [`86eye3p6z`](https://app.clickup.com/t/86eye3p6z) · shipped 2026-08-14 · dev

The 27 Jul 2026 funnel audit found the strongest argument we own — that we never
take a cut — completely absent from `/`, three competing CTAs fighting for the
same click, no answer to the "another dead app" fear, and nothing saying how a
buyer actually pays. This is the fix.

## What landed

| § | Change | Where |
|---|---|---|
| A | Money-math block above the pricing teaser | `src/components/landing/money-math.tsx` |
| B | Guarantee line under every primary CTA | `landing-ui.tsx` → `GuaranteeLine` |
| C | Exactly one primary button per page | hero, founding-ten, nav, final-cta, pricing |
| D | Founding counter reads live on `/pricing` too | `src/routes/pricing.tsx` |
| E | Calculator stays at `/cost` | money-math CTA |
| F | Reseller copy — already gone, re-verified | `src/lib/pricing-copy.test.ts` |
| G | Payment-methods strip + footer repeat | `payment-methods.tsx`, `src/lib/payment-methods.ts` |

## The money math (§A)

`MoneyMath` renders above `PricingTeaser` on `/`; `MoneyMathRow` is its
one-line sibling between the hero and the tier cards on `/pricing`. Both read
the same `MARKETPLACE_RATES` array, so the rates are edited once.

**This is a positioning claim, not a savings claim, and the code says so.** A
seller's WhatsApp orders already cost them 0%, so Kedaipal is an *added* cost on
those orders. The page may say "we never take a cut of your sales, at any
volume". It may **not** say "save RM900/mo versus Shopee" —
`src/lib/landing-funnel.test.ts` fails on any `mm_*` string containing a savings
word in any locale.

Two more constraints baked into the copy:

- **Shopee is always hedged.** "up to ~20%", never a flat "20%": the commission
  is category-based and the 5.5% Free Shipping slice is opt-in. The test asserts
  a per-locale hedge (EN/BM lean on the tilde, ZH says 最高约).
- **Shopee leads, not GrabFood.** Food delivery's 15–22% also buys a rider
  fleet, which our BYO Lalamove integration does not. `mm_note` carries the
  caveat in full rather than burying it.

Bar widths are proportional to the top of each published range against a 22%
max, so the chart can't imply GrabFood costs less than Shopee.

### Why `/cost`, not a new `/kira`

`/cost` already exists, already runs the exact formula (`src/lib/calculator.ts`),
is SSR'd, localised and shareable via prefill params (`/cost?w=40&aov=35`). A
second calculator page would be two things to keep in sync for zero gain. The
money-math CTA is now that page's front door — which is also why `/cost` left
the nav (see below).

## The guarantee (§B)

> Your first real order lands in the dashboard in our first session, or we set
> it up until it does.

One message key, `guarantee_line`, rendered by one component
(`landing-ui.tsx` → `GuaranteeLine`), on four surfaces: the hero, the landing's
final CTA, the Pro card on both the teaser and `/pricing`, and `/pricing`'s
closing CTA. The WhatsApp outreach ladder makes the same promise word-for-word,
so a second copy of the sentence anywhere in the catalog is how the two start
drifting — `landing-funnel.test.ts` fails if any other key holds the same
string.

It is deliberately **not** shown to a seller whose CTA reads "Current plan":
they have already been onboarded, and promising them a first order would read
as a bug.

## One primary CTA (§C)

`Start 14-day free trial` is the only filled/accent button on `/`. Demoted to
text links in their own sections:

- **"Claim your free store"** — was the hero's slug-claim input
  (`kedaipal.com/[____]` → sign-up with the slug prefilled). The whole device is
  gone, not restyled: it *was* the primary CTA, and keeping it as a second one
  is exactly the problem the audit named.
- **"Apply for a founding spot"** — founding-ten section, and the Founding 10
  banner on `/pricing`. A founding spot is a WhatsApp conversation, a heavier
  commitment that shouldn't compete with a free trial.
- **"See how it works"** — hero and `/pricing`'s closing block.

**The nav lost two entries.** `Cost calculator` moved out because the
money-math block is now a better front door for it, and five links plus the
locale switcher and the CTA crowded the bar between `md` and `lg`. `Sign in`
went too — one ask in the nav. Returning sellers still reach sign-in from the
sign-up screen's own "already have an account?" link, so no path was closed.

On `/pricing` the three tier cards keep their buttons (a tier card without one
is a dead end), but only Pro's is filled.

## Founding counter (§D)

The landing already read `api.foundingMembers.getSpotsRemaining`. `/pricing`
did not — it printed a hardcoded "10 of 10 spots still open" and passed a
literal `{spots: 10}` into the Pro card. Both now read the live query, with
all-open as the SSR/loading fallback (never a fake "taken"). The
`pricingpage_banner_spots` key is deleted; the page reuses `founding_remaining`.

## Payment methods (§G)

`src/lib/payment-methods.ts` holds one `PAYMENT_METHODS` array. Adding or
pulling a rail is a data edit; `src/lib/payment-methods.test.ts` is what stops
that edit shipping a broken mark.

**This is the LANDING catalogue — HitPay's full Malaysian capability, advertised
as a fact about the gateway.** It is deliberately not shared with the storefront
checkout or Settings → Payments, which render only the rails that individual
seller has switched on in their own HitPay account (BYO, so it varies per
store — see `online-payments-card.tsx`'s `METHOD_ICONS`). One list promising
more than a seller enabled would be a lie on the surface where a buyer is about
to pay.

Rendering rules:

- **Every mark rides a white pill in both themes.** Brand marks may not be
  recoloured and most carry their own colours, so a white ground is the only
  treatment that stays legible and compliant when the page flips to dark.
- **One height for every mark.** All seven assets we hold are drawn on the same
  38×24 card artboard, so a single `CARD_MARK` normalises them — per-mark
  heights scale identical artboards to different sizes and produce exactly the
  ransom-note row the brand rules warn about.
- **No brand-approved SVG → neutral wordmark chip**, not a raster stand-in
  (Apple Pay, Google Pay, MayBank QRPay, Atome, SPayLater, GrabPay PayLater,
  and ShopeePay — whose `public/img/payment/shopeepay.svg` is an SVG shell
  wrapping a base64 PNG). Plain text naming a fact can't breach a guideline,
  and it dodges the contrast failures a coloured wordmark hits on white.
- **The brand name is the accessible name**, in every locale. Proper nouns
  don't translate, so they live in the config rather than the catalog — a BM or
  ZH screen-reader user hears "Touch 'n Go eWallet" either way.
- **Cross-border (tourist) wallets are in the array with `visible: false`.**
  Twenty logos is noise, not trust, until a seller actually serves tourists.
  The group renders itself the moment one flips true; a test pins the deferral
  so flipping it is deliberate.

### The line that does the work

> The money goes into your own HitPay account, never ours.
> Gateway fees are billed by HitPay directly — we add nothing on top.

BYO accounts mean the merchant's money never touches Kedaipal, which kills the
"app pegang duit aku" fear outright. The two sentences are always adjacent
because the strip sits one section below "0%" — and **"0% cut" is about
Kedaipal's subscription, never HitPay's per-transaction fee.**
`landing-funnel.test.ts` fails if any `pay_*` string in any locale contains a
free-processing word.

A compact repeat lives in the footer (`PaymentStripCompact`), same array,
marks only.

### Where the marks come from, and the raster trap

Every mark under `public/img/payment/` comes from **Shopify's MIT-licensed
`payment_icons` set**, via HitPay's fork (`hit-pay/payment_icons`) — the same
source the Settings chips already used. Take marks from there rather than from a
search result: the set is drawn on one 38×24 artboard, which is what makes a
single `CARD_MARK` height normalise the row instead of producing the ransom-note
effect the brand rules warn about.

**The recurring defect is a raster wearing an `.svg` extension.** Several
entries upstream are a base64 PNG wrapped in an `<svg>` shell. ShopeePay was
already documented as a wordmark chip for this reason — and auditing the rest
(14 Aug 2026) found **`paynow.svg` had the same defect and was already wired
into the config with a `src`**, sitting behind `visible: false` where nothing
rendered it. Flipping that one word would have shipped a raster onto the
landing. PayNow is now demoted to a chip; the file stays on disk because the
Settings card still points at it.

So the rule is now a test, not tribal knowledge: `payment-methods.test.ts`
parses **every** referenced file (including invisible rows — an invisible row is
one word away from rendering) and fails on an `<image>` tag or a `data:image/*`
payload. Verified red against the real PayNow file, green after.

Promoted from chip to real mark in the same pass: **Apple Pay, Google Pay,
ShopeePay** (genuine vector replacing the shell) **and Atome**, plus `src` wired
for **WeChat Pay** and **QRIS** so the deferred cross-border rows are a
one-word flip. Apple's mark is the exception the `CARD_MARK` note anticipates —
a 165.521×105.965 artboard — but its *ratio* matches the card artboard to within
a pixel at `h-7`, and ratio is what `w-auto` keys on, so it correctly uses
`CARD_MARK` anyway.

Still chips, each for a stated reason:

- **MayBank QRPay, PromptPay** — the only upstream vector is a base64 PNG shell.
- **SPayLater, GrabPay PayLater** — no mark in the set at all; lender brands
  rather than rails, and neither publishes a redistributable vector.
- **Alipay+** — the set ships `alipay.svg`, but Alipay+ is the cross-border
  *acquiring network*, not the Alipay wallet. Using the wallet's mark would name
  the wrong company, which is worse than a chip.

Note this reverses the earlier documented call that Apple Pay and Google Pay
must stay wordmarks because we held no redistributable vector. We do now, and it
is used as-published — never recoloured or redrawn, which is what both brand
guidelines actually require.

## Copy corrections that rode along

The catalogs still described a product from three months ago:

- `faq_a_3` and `pricingpage_faq_a4` said online payment was "coming next" /
  "on the S5 roadmap". **HitPay shipped in July.** Both now describe the two
  real rails.
- `handshake_point_1` said bank details ride the confirmation message. They
  don't — buyers pay from their own secure order page
  (`docs/payment-handshake.md`).
- `bento_delivery_body` and `how_step_2_body` didn't mention live Lalamove
  rider quotes; `how_step_3_body` still ended at "files it in your inbox".
- **The delivery bento card named Lalamove in a sentence but showed neither of
  its two skimmable chips.** `bento_delivery_body` says "live Lalamove rider
  quotes at checkout with one-tap booking", but the chips underneath it read
  "Free above RM 100" and "0–5 km · RM 8" — flat-fee and radius-band, the two
  modes every WhatsApp-order competitor already has. A reader who skims chips
  instead of paragraphs (which is the point of putting chips there — see the
  handshake card's order-confirm mock, the counter card's QR + pairing code,
  every other card in this grid) would never learn the feature exists.
  `bento_delivery_chip_band` is now `bento_delivery_chip_rider` ("Rider quote ·
  RM 12"), replacing the radius chip rather than adding a third — two chips
  reads as "here's the range" (set-your-own vs. real-time), and the radius case
  sits between them without needing its own pill.
- `pricingpage_faq_a3` answered "How does cold-chain Lalamove integration
  work?" with "ETA: Q4 2026" while this same page now lists **Lalamove
  delivery** as a shipped Pro row and the teaser leads Pro with "Lalamove
  rider booking". Rider booking shipped in `86eyb5hrf`. The question was also
  built on a premise that never shipped in that shape: there is no cold-chain
  *van* or *flag* anywhere in the Lalamove code (`LalamoveVehicleType` is
  `MOTORCYCLE | CAR`) and Lalamove is intra-city — frozen/outstation is served
  by the **weight/zone courier rate cards** (`86eyeea1n`, all-tier) plus manual
  consignment numbers (`86eyehvk4`). So the Q+A pair was rewritten in all three
  locales to describe both rails as they actually exist, rather than
  re-dating a roadmap item that was superseded, not delayed.
- `hero_subhead` was F&B-only. Broadened to the Jul 2026 feature-grounded ICP —
  then re-grounded again to lead with the **pattern** rather than a vertical
  list, because every post-Jul strategy doc says to: the ICP sentence of record
  is *"seller who takes made-to-order or dated/booking orders, closes them + gets
  paid manually in WhatsApp DM, and sells both online and at a physical
  counter"*, and the YC draft puts it as *"the real segment is behavioral, not
  vertical."* The subhead now opens on that behaviour, names the verticals as
  proof it travels, and adds **"sell both online and at a counter"** — half the
  pattern, previously missing from the hero entirely.
- **"Service bookings" was an over-claim and is now "service jobs"**
  (`hero_subhead`, `hero_marquee`, and `proof_card_4_heading`, which read
  "Bookings, not just products"). Bookings are spec'd, not built: the 7 Aug
  codebase audit found *"zero concept"* of slot/calendar booking —
  `orders.fulfilmentDate` is a date with no capacity or slots, "booking" in the
  schema means Lalamove rider dispatch, and there is nowhere for a seller to
  declare themselves a service business. The vertical's build gate fired on
  Sengloh/THG's payment (6 Aug, `86eyj70z1` / `86eyhwb03` / `86eyj7102`), so
  this copy can come back — **when the feature does**. What is shipped and
  therefore claimable today is dated made-to-order *jobs*: fulfilment date +
  time, min-notice, mockup approval, custom order stages, and collection
  (`86eyg0n8e`). Note the founding member behind the service cards is
  **Bearcamp = outdoor-gear laundry** (tent/sleeping-bag wash, waterproofing,
  repair) — *not* campsite booking, which is Sengloh; two sales docs
  (`kedaipal-pitch-cheat-sheet`, the A5 brochure) have them crossed and should
  be corrected at source.
- `SEO_TITLE` and the Organization JSON-LD description both said **"home
  sellers"**, the pre-Jul ICP. Multi-outlet stalls, central kitchens and
  service shops all match the cohort and none of them sell from home — and
  `SEO_TITLE` is the line Google renders. Both now name the behaviour. The
  remaining "home seller" mentions (`pricingpage_tier_pro_tagline`,
  `pricingpage_testimonial_attrib`) are lower-stakes; the testimonial one is an
  explicit placeholder awaiting the first Founding 10 quote.
- The **zh `hero_marquee` never got re-seeded** with the real cohort when EN and
  MS did — it still listed headscarves, skincare, handicrafts, electronics and
  home decor from the pre-ICP era. Locale *parity* tests only assert that keys
  exist in every catalog, so a stale translation of a live key passes silently.
  Now mirrors EN.
- Tier taglines now carry their order allowance (100 / 200 / **400**). Scale's
  card line was deliberately number-free after the flat multi-outlet
  repositioning (`86eyb9zwt`) while the comparison table already printed 400 —
  two answers to the same question on one page. Settled on 400 everywhere;
  `pricing-copy.test.ts` was updated to pin the new answer.
- The `/pricing` comparison table gained five shipped rows (online payments,
  categories, radius-band delivery, Lalamove, WhatsApp seller alerts), all
  Pro-gated to match `PLAN_FEATURES`. **Payment reminders lost their "Coming
  soon" badge and became all-tier** — they shipped in `86ey570am` and carry no
  `PLAN_FEATURES` entry.

## Other page changes

- **Hero visual is now an overflowing inbox, not a tidy conversation**
  (`hero-phone.tsx`). Order requests and a "dah transfer" sit buried among
  family chats, half already scrolled past, with "Missed order · RM 95",
  "47 unread" and "Sis dah bayar ke? 😩" floating over it. The old phone showed
  the happy path the page spends the next four sections promising to build.
- **Real sellers trimmed 4 → 2 cards.** The central-kitchen and fruit-&-fish
  cards restated the same "orders land in one inbox" point. The pair that stays
  is one stall and one *service* business, because the broadened non-F&B ICP is
  the claim that section has to carry.
- **The Counter checkout section was removed from `/`** (owner call). The
  capability is still claimed — it has a card in the features bento and its own
  FAQ entry — it just no longer gets a full section between How it works and
  the bento. `counter-checkout.tsx` and its `counterqr_*` copy are deleted.

## Mobile carousels — the page in screens, not scrolls

Stacked, the mobile page ran ~20,000px; the sections that stacked worst are now
**horizontal snap carousels below `md`**, cutting it to ~14,000px. Two shared
class helpers in `landing-ui.tsx` (`carouselTrackClass` / `carouselSlideClass`)
carry the storefront category-rail's scroller mechanics: full-bleed
`-mx-5/px-5`, `scroll-pl-5` so the snapped rest position lines up with the
section padding, hidden scrollbars, and 85%-width slides so the next card
always peeks — the peek IS the "swipe for more" affordance. At `md` the track
resets to whatever grid the caller passes, so desktop is untouched.

Carouselized: the **features bento** (7 cards ≈ 4 screens stacked), **How it
works** (each slide = number + copy + mockup; the dashed timeline connector is
a vertical device so it's `md`-only), the **problem strip** (slides carry their
own rounded border on mobile; the joined `gap-px` grid look is rebuilt at
`md`), the **pricing teaser tiers** (cheapest first, Pro peeking; the track
gets `pt-4` so Pro's absolutely-positioned "Most popular" badge isn't clipped
by the scroller), and **Real sellers** (flattened to one track — with only two
archetype cards left the nested grid collapsed to three equal columns anyway).
The **payment strip's** chip rows became one swipeable line per group below
`lg` instead of wrapping to 2–3 rows.

Two rules the helpers encode, learned the hard way:

- **Slides must be `position: relative`.** They carry absolutely-positioned
  descendants (`sr-only` spans, mockup badges), and an absolute element
  escapes an ancestor's overflow clip unless its containing block is inside
  that ancestor — an unpositioned slide scrolled to x≈900 widened the whole
  page to 978px.
- **Slides must not be individually `FadeIn`-wrapped.** A peeking slide sits
  inside FadeIn's `-80px` viewport inset and holds at opacity 0 until swiped,
  hiding the peek. One FadeIn wraps each whole track (per-card stagger was the
  price).

## Section order on `/`

Nav → Hero → Real sellers → Problem strip → Payment handshake → How it works →
Features bento → Founding 10 → **Money math** → **Payments** → Pricing teaser →
FAQ → Final CTA → Footer.

Cost context, then the rails, then the price: a visitor has to know what a
marketplace already takes and how their customers will actually pay *before*
they meet RM79/149/299.

## Not done

- **Funnel instrumentation.** PostHog isn't integrated in the repo at all yet,
  so we still can't measure whether any of this converts. Separate ticket.
- **Official SVGs** for Apple Pay, Google Pay, MayBank QRPay, Atome, SPayLater,
  GrabPay PayLater, and a real vector for ShopeePay. Drop the file into
  `public/img/payment/` and add `src` to the config row to promote a chip to a
  mark — no component change.
