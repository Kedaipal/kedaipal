# Landing redesign — Mobbin motion, Founding 10 off `/`, WhatsApp demo booking

Branch `arif/landing-redesign-mobbin` · dev

Three asks drove this pass: bring Mobbin-style motion/layout polish to the
landing hero, retire the Founding 10 countdown now that Kedaipal has crossed
that stage, and give visitors a one-tap way to book a demo on WhatsApp
instead of only a self-serve trial.

## What changed

| Change | Where |
|---|---|
| Founding 10 section removed from `/` | `src/routes/index.tsx`, `src/components/landing/founding-ten.tsx` (deleted) |
| "10+ paying sellers" replaces it as the trust anchor | `src/components/landing/real-sellers.tsx` |
| "Book a demo" → WhatsApp, in the nav + final CTA | `src/components/landing/nav.tsx`, `final-cta.tsx` |
| Pricing teaser reads live MYR/SGD prices, MY/SG toggle | `src/components/landing/pricing-teaser.tsx`, `src/hooks/useLandingRegion.ts` |
| Hero iPhone mockup (CSS device, storefront on-screen) replaces the buried-inbox phone | `src/components/landing/hero-device.tsx`, `phone-screen-mockup.tsx`, `hero.tsx` |

## Founding 10 off the landing page, not out of the codebase

`FoundingTen` (the 10-cell spot grid + perks + "Apply for a founding spot"
WhatsApp link) is deleted outright — it was landing-only, never reused. The
underlying founding-member system is untouched: `convex/foundingMembers.ts`,
`convex/lib/plans.ts` (`FOUNDING_MONTHLY_PRICES`, `planQualifiesForFounding`,
`FOUNDING_MEMBER_LIMIT`) and **`/pricing`'s own Founding 10 banner** all still
work exactly as before — billing still runs on founding status, and
`/pricing` is a deliberately separate surface this pass didn't touch.

That split matters for the message catalog: `founding_label`,
`founding_remaining` and `founding_wa_message` survive in all three locales
because `src/routes/pricing.tsx` still reads them. Every other `founding_*`
and `pricing_founding_*` key — the ones only `FoundingTen`/`PricingTeaser`
used — is gone. `src/lib/landing-redesign.test.ts` pins both halves of that
split (removed keys stay removed, kept keys stay kept) so a future landing
edit can't silently reopen either side.

`pricing-teaser.tsx` also dropped its `foundingPrice` tier field and the
`getSpotsRemaining` Convex query it existed for — the teaser now makes zero
Convex reads.

## "10+ paying sellers" — the new trust anchor

`RealSellers` (the section right after the hero) gained a stat band above
its existing archetype cards: a large `10+` numeral plus "paying sellers
across Malaysia & Singapore", styled in the same accent-tinted-pill language
as the rest of the page. It replaces Founding 10's spot-countdown as the
thing that answers "is anyone actually using this?" — a real, live count
Kedaipal can now make honestly, instead of the "0 of 10 spots taken" empty
state Founding 10 risked showing on a slow week. The archetype cards and the
"why they switch" stat card underneath are unchanged.

## WhatsApp demo booking

A `book_demo_cta` / `demo_wa_message` message pair (one author, mirrored by
`landing-redesign.test.ts`'s duplicate check the same way `guarantee_line`
is) drives a `buildWaContactLink()` deep link — the same helper and
`useSupportWaNumber()` hook every other seller-facing WhatsApp CTA in this
codebase already uses, so the number is never hardcoded.

**Placement is deliberately never a filled/accent pill.** `86eye3p6z §C`
("Exactly one primary button on the page") is a load-bearing, tested design
rule for this page — "Start 14-day free trial" stays the only accent CTA.
"Book a demo" rides an outline `Button` in the nav (`lg:` only, mirroring
the earlier "the nav crowds between `md` and `lg`" lesson — it's also in the
mobile menu, full-width) and an outline-on-navy pill beside the trial button
in the final CTA panel, both carrying the reused `WhatsAppIcon` brand glyph
from `src/components/dashboard/brand-icons.tsx` rather than a new asset.

## Pricing teaser: live prices, MY/SG toggle

Prices were hardcoded (`RM {tier.price}`) sourced from nowhere. They now read
`PLAN_MONTHLY_PRICES` (`convex/lib/plans.ts`, minor units — divided by 100
for display) for both `MYR` and `SGD`, and Scale's "Coming soon" state reads
`isPlanSelectable("scale")` instead of a literal `true`.

A new `RegionToggle` primitive (`landing-ui.tsx`) — a `<fieldset>` of two
pill buttons, "MY" / "SG" — lets a visitor pick their currency; the pick
persists in `localStorage` (`kp_landing_region`) via `useLandingRegion`
(`src/hooks/useLandingRegion.ts`). First visit defaults to MY and corrects
itself post-mount from either the stored override or a time-zone guess
(`Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Singapore"`) —
**not** Cloudflare's `request.cf.country`. That would need the Worker's raw
`Request` plumbed into a TanStack Start loader
(`src/server-entry.ts` → `src/router.tsx`), which this repo has no existing
pattern for and this pass didn't want to originate untested; the time-zone
heuristic is a same-render-shape, zero-infra stand-in a visitor can always
override. Real geo-detection is a clean follow-up at that seam.

`Country` (not `BillingCurrency`) is the state this hook manages — Kedaipal
bills in a narrower currency set than a storefront can trade in
(`convex/lib/country.ts` vs `convex/lib/plans.ts`), so the teaser derives
`MYR`/`SGD` from the region locally rather than widening the hook's type.
`src/lib/currency-literals.test.ts` already allowlists `components/landing/`
for bare `"MYR"`/`"SGD"` literals (Kedaipal's own subscription price, not a
seller's storefront currency) — this teaser is why that allowance exists.

## Hero iPhone mockup — CSS, not 3D

`framer-motion` (already a dependency, and what "the motion library" in the
Mobbin-style brief actually refers to — no new animation package) drives the
existing entrance stagger, `FadeIn` scroll-reveals and the floating-sticker
bobs unchanged. The hero's visual is now a **pure-CSS iPhone mockup**:

- **`hero-device.tsx`** — the device frame, modelled on the single centered
  upright phone in the Aave onboarding reference Arif supplied
  (recent.design `zq0kule`): titanium-black rounded body, inner edge
  highlight, side-button slivers, soft floor shadow. One `role="img"` with
  `hero_phone_alt` carrying the story.
- **`phone-screen-mockup.tsx`** — the screen: status bar (9:41 + signal
  icons), dynamic island, store header ("Kek Sayang Bakery" + slug pill),
  category chips, a product grid, and a WhatsApp checkout cart bar. Six
  products on purpose — the third row clips behind the cart bar
  (`auto-rows-max` + `overflow-hidden`, because a definite-height grid
  otherwise *compresses* rows and eats the price lines), which is what
  makes it read as a real scrollable storefront.
- **The product tiles are real photography** (Higgsfield
  `marketing_studio_image`, 29 Aug) — one consistent set across all six
  dishes: cream ground, soft window light, a mint linen accent, i.e. the
  brand palette in photographic form. A deliberate exception to the house
  no-raster mockup rule: this one mock is the hero's promise of what a
  seller's storefront can look like, and gradient blocks undersold it
  (owner ask). Pipeline: 640px sources in `assets/landing/` →
  `pnpm optimize:images` (the previously-dormant sharp script, first real
  cargo) → 320w AVIF+WebP in `public/img/landing/` at **5–15 KB per tile**,
  consumed via `<picture>` with `loading="lazy"` and explicit dimensions.
- The two universal pains float OUTSIDE the phone as stickers ("Missed
  order · RM 95", "Sis dah bayar ke?") — the storefront on-screen is the
  after, the stickers are the before. Trimmed from the old three to two so
  each maps 1:1 to a pain the page fixes, keeping the calm single-device
  read of the reference.

### The three.js chapter, and why it's gone

Two 3D iterations shipped before this (29 Aug): first a `@react-three/fiber`
scene whose GLB had been flattened to a single-material black slab by
`gltf-transform optimize`'s join pass, then a repaired version with per-part
materials, an env-map and a DOM screen overlay. Arif rejected both — the
verdict on the second was "i hate the 3d… replace with a proper iphone
mockup". The whole stack came out: `three`, `@react-three/fiber`,
`@react-three/drei`, `@types/three`, the 256 KB GLB, the WebGL/
reduced-motion gating, and the **~1 MB lazy chunk** — the CSS mockup weighs
effectively nothing, needs no fallback tree (it IS the fallback), and is
SSR-rendered like any other component. The old buried-inbox `HeroPhone` and
its `hero_inbox_*` keys went too: the pain story it carried lives on in the
stickers here and in `problem-strip.tsx`'s BuriedChats.

Lesson pinned for next time: for a marketing hero, a crisp CSS device
mockup beats a 3D scene on cost, reliability and — per the owner — looks.
Don't reach for WebGL there again without a specific reason.

## Seller showcase — anonymized kinds, auto-scrolling rail (29 Aug)

`real-sellers.tsx` was rebuilt from two static archetype cards into a
Mobbin-style horizontal showcase, and the presentation went through THREE
owner-directed iterations in one day — record them so the churn reads as
decisions, not noise:

1. **Named customers + photos** ("you already have all the necessary
   details of our current customer") — cards naming Lekor Mr Ganu and
   Bearcamp with documentary Higgsfield photos.
2. **Plus a trusted-by logo row** — nine real paying sellers' storefront
   logos pulled from prod Convex storage (`retailers.logoStorageId` via
   the Convex MCP, test stores excluded), normalized by a one-shot import
   script. Consent posture was defensible (being featured was literally a
   founding-member perk, and each logo is public on that seller's own
   `kedaipal.com/<slug>` page).
3. **Full anonymization** (final): "instead of showcasing our customer
   logo and name, just show the kind of business… remove the brand as
   well." All names, logos and the paying/cohort badges came back OFF the
   page; the import script and logo assets were deleted. What ships:
   **eleven business-KIND cards** — keropok lekor stalls, fashion &
   accessories, outdoor gear care, viral desserts, custom prints & merch,
   fresh fish & seafood, home kitchen catering, premium meats, campsites,
   fitness & martial arts, frozen multi-outlet — each kind drawn from a
   real paying customer, stated without naming them, each with a
   documentary Higgsfield photo (mint accent throughout), plus the navy
   "Why they switch" stat card closing each loop. The apparel and
   custom-prints cards were the owner's explicit ask ("showcase seller
   whom sells apparel and product"); the batch stalled once on exhausted
   Higgsfield credits and completed after a top-up. Every card body claims
   only shipped features — the campsites card deliberately says
   "date-based orders", never "bookings" (slot/calendar booking is
   spec'd, not built; see landing-funnel.md's service-copy audit).

**Interaction (final form)**: the rail **auto-drifts** like a marquee — the
track renders two copies (second `aria-hidden`) and a `useAnimationFrame`
loop advances the drag's own motion value, wrapping it by exactly one
copy-width whenever it leaves the loop range, so drift, drag momentum and
arrow-button nudges all compose on one unbounded value and the wrap jump is
invisible. Hover and active drag pause the drift (never chase a moving
card); `touch-action: pan-y` keeps page scroll working mid-rail; arrow
buttons remain the keyboard path; reduced motion kills the drift but keeps
drag and buttons (user-initiated). One FadeIn wraps the whole rail.

## Live sellers on the landing (29 Aug)

Claim links (`86eyq0epn`) shipped days earlier with zero landing presence,
while at least two paying customers are live-drop sellers. Three additions,
all claims mapped to shipped behavior (vendor-set 5-min–7-day window,
price-locked `/claim/<token>`, orders stamped `tiktok-live` in Insights —
see [`claim-links.md`](./claim-links.md)):

- **"Sell on live" bento card** (`feature-grid.tsx`) — wide slot, with a
  CSS mock of the claim card (item + price, amber "Expires in 14:59" pill,
  mint "Claim now"). The lg bento tiles in 3-column rows whose column units
  must sum divisibly by 3, so the inbox card widened to span-2 alongside it
  (7 cards/9 units → 9 cards/12 units, four clean rows).
- **"Live drop sellers" kind card** in the sellers rail, second position,
  with a Higgsfield ring-light/tripod photo.
- **"Live drops" appended to the hero marquee** in all three locales.

## Problem strip — the pain, animated (29 Aug)

`problem-strip.tsx`'s static buried-chats pile became a **live loop**: money
messages (an order request, a "dah transfer" — tagged with mint "New order"
/ "Payment" chips) arrive at the bottom of a chat stack and visibly sink
and fade as everyday noise piles on top — the exact mechanic
`problem_1_body` describes, now happening while the visitor watches. The
"47 unread" stamp pulses on every arrival. Each numbered pain card also
gained a `Cost:` stamp (torn-receipt styling, `TrendingDown` icon) naming
its loss in one line — deliberately restating the card's own body, never a
new numeric claim (the 20-minutes figure already lives in
`problem_2_body`).

Two hard-won constraints, both found live the same day:

- **The tick gates on `document.visibilityState` AND `useInView`.** Exit
  animations need animation frames to finish, so ticking in a hidden tab
  makes `AnimatePresence` accumulate never-unmounted bubbles without bound
  (observed: 40 bubbles in the DOM after a backgrounded minute).
- **The pile lives in a fixed-height, bottom-anchored, top-masked window**
  (`h-[264px]`, `justify-end`, mask fading the oldest bubble out through
  the top). Without it the pile's height breathed with every enter/exit
  (money bubbles are taller than noise ones) and shifted the whole page —
  Arif caught the layout shift watching the live preview.

Reduced motion: the loop never starts; the pile renders as the static
four-bubble stack.

## Payment wall — the Mobbin logo rows (29 Aug)

`payment-methods.tsx`'s static grouped rows (label + chips per group)
became **two auto-scrolling marquee rows in opposite directions** — the
treatment under Mobbin's "Your AI agents are guessing" section, which Arif
referenced directly. Mechanics: the visible catalogue interleaves across
the rows so each mixes banks/cards/wallets, tracks duplicate for the
seamless loop (`animate-kp-marquee-slow` / `-slow-reverse`, new shared
utilities off the same `kp-marquee` keyframes), hovering a ROW pauses it so
a reader can chase a logo, edge fade masks let the rows bleed through the
section, and the duplicated copy is `aria-hidden` with empty alts so names
aren't announced twice. Reduced motion stops both rows via the same media
block as the hero marquee.

**No logos were scraped.** The ask said "scrape all icon and logo online",
but this repo's payment-mark policy exists precisely because stray logos
off the web are how the row becomes a ransom note and a brand-guideline
breach ([`landing-funnel.md`](./landing-funnel.md) §G: only the MIT
`payment_icons` set, real vectors only, enforced by
`payment-methods.test.ts`). Every usable sanctioned vector was already in
`public/img/payment/` — the wall animates ALL of them, chips included; the
upstream set holds nothing else legitimately promotable (the remaining
candidates are base64-PNG shells or wrong-company marks, per the config's
per-row notes). The `pay_group_*` label keys are now unused by the landing
strip but stay in the catalogs (parity-tested, harmless, and the grouping
may return elsewhere).

## Payment handshake — the flow acted out (29 Aug)

The static three-element pile ("bland", owner) became a looping story:
typing dots → the buyer's "dah transfer" bubble → the seller's claim card
(badge pulsing amber while it waits) → a simulated tap on Confirm (a ring
blooming off the button) → the receipt springs in; hold, clear, repeat.
Beat engine is a timeout chain with the house guards, plus one refinement
worth keeping: **the hidden-tab branch must re-arm a retry, never set
identical state** — a `setBeat(b => b)` no-op doesn't re-render, so the
effect never re-runs and the loop dies permanently instead of waking when
the tab returns. Fixed-height stage (`h-[350px]`), reduced motion renders
the full stack as a still.

## How it works — photo collages + the CURRENT checkout flow (29 Aug)

Each step's CSS mockup now floats over a documentary Higgsfield backdrop
(QR standee on a counter / thumb browsing over coffee / phone mid-chat /
parcel packing), with a slow Ken Burns push-in (`animate-kp-kenburns`,
reduced-motion-disabled) and the md-only timeline connector drawing itself
on scroll (`scaleY` whileInView — per-step reveals stay off, the mobile
carousel peeking-slide rule).

**Step 3 was factually stale and Arif caught it**: the copy and mockup
still told the LEGACY wa.me story ("the cart posts into your chat"). Since
confirmation push (`86eyf1rck`), the buyer completes checkout ON the page
(name + phone, no account), the order is confirmed at create, and
Kedaipal's WABA pushes the confirmation INTO their WhatsApp — wa.me is the
fallback only (`?send=1`). The step now reads "Checkout in seconds —
confirmed in WhatsApp" and `CloseMockup` shows a checkout card plus the
INCOMING confirmation bubble; the buyer-sent order-message bubble (and its
`how_mockup_3_greeting/payment/order_id` keys) are gone in all locales.
Lesson: marketing mocks rot when flows ship — when a buyer-flow ticket
lands, grep the landing mocks for the old mechanic.

## The motion pass — five gaps, five fixes (29 Aug)

A full-section audit for interactivity gaps, all framer-motion, all
reduced-motion-safe (the drift/tick loops additionally gate on tab
visibility + `useInView`, per the AnimatePresence-accumulation trap):

| Section | Gap | Fix |
|---|---|---|
| Hero device | static | mouse-only pointer-tilt parallax (springs, ±5°/±7°, `transformPerspective`; touch deliberately excluded) |
| Money math | bars were static widths | bars GROW to their cut on scroll-into-view (once, staggered), Kedaipal's 0% pill springs in after them |
| "Sell on live" bento | static "14:59" | the expiry pill genuinely counts down (14:59→13:30 loop — always mid-flight) |
| Pricing teaser | MY/SG toggle swapped prices instantly | price rolls (slide-fade keyed by currency) — the toggle's one visible consequence responds visibly |
| FAQ | `hidden`-attribute snap | height-animated open/close via AnimatePresence, inner div carries padding so collapse reaches true 0 |

Noted and deliberately skipped: HowItWorks connector-draw (per-step reveals
collide with the mobile-carousel peeking-slide rule), FinalCta ring motion
(centered uniform circles — rotation is invisible, breathing is noise).

## Money math — marketplace logos + TikTok Shop row (29 Aug)

Each comparison row now carries its marketplace's mark (Simple Icons CC0,
inlined into `brand-icons.tsx` alongside the channel glyphs — same
nominative-use posture; GrabFood rides the parent Grab mark, the food
vertical has none in the set). A **TikTok Shop row** joined at
"up to ~19%": verified 29 Aug against the post-Feb-2026 MY rate card
(~10.3% top category commission + ~4.9% opt-in Bonus Cashback + ~3.8%
transaction fee ≈ 18.9% full-programme). It follows the Shopee hedging
discipline exactly — "up to ~", top-of-range drives bar width only, and
`mm_note` now carries TikTok's opt-in caveat symmetrically with Shopee's
(~14% without the programme). `landing-funnel.test.ts`'s hedge and
no-savings-words guards pass unchanged.

## /pricing caught up (29 Aug, evening)

The pricing page joined the redesign — its gaps were all consistency debts
against the same-day landing work:

- **Live MY/SG prices**: hardcoded RM 79/149/299 (and drift-prone annual
  literals 65/124/249) replaced by `PLAN_MONTHLY_PRICES` reads + the shared
  `RegionToggle`/`useLandingRegion`, with the teaser's price-roll animation.
  Annual per-month figures are now DERIVED (`floor(monthly × 10 / 12)`).
- **Founding 10 fully retired from marketing copy**: the banner, the Pro
  card's "RM 104 forever" box, and the `getSpotsRemaining` read are gone;
  the banner slot became the "10+ paying sellers" proof band with the
  Book-a-demo WhatsApp link. The widened test guard
  (`landing-redesign.test.ts`, now covering `pricingpage_*` too)
  immediately caught THREE more founding mentions hiding in prose keys
  (hero sub, FAQ a5, closing CTA sub) — scrubbed in all locales. The
  program's only remaining home is billing code (`convex/lib/plans.ts`,
  `docs/manual-subscription.md`). `/cost`'s founding CTA is deliberately
  out of scope (its own copy pass).
- **The placeholder testimonial is gone**: a written-by-us quote with a
  placeholder attribution was exactly the fabricated testimony the
  no-quotes-without-consent stance forbids. A real consented quote earns
  the slot back.
- **The comparison table caught up with shipped reality** (6 new rows):
  counter checkout, live claim links, receipts/invoices/AWB PDFs, courier
  rate cards (all-tier — none carry a `PLAN_FEATURES` gate), plus order
  source insights and chargeable pickup locations (Pro — ride
  `insights`/`chargeablePickup`). Row hover highlight added.

## Mobile audit + copy tightening (29 Aug, evening)

A 375px programmatic audit found **zero horizontal overflow** on both
routes but a batch of sub-44px touch targets — the design system's hard
rule. Fixed in one sweep: the RegionToggle segments (36px → `tap-target`),
the nav logo link, and every underline text link (hero secondary links,
money-math CTAs, "full breakdown"/"full list"/"see all" links, footer
legal links, /pricing's "see how it works") now carry `min-h-11`.

Copy pass (owner: "more concise"): four flagship strings tightened in all
three locales — `hero_subhead` (keeping the "orders, jobs, bookings" ICP
vocabulary that `SEO_DESC` mirrors), `bento_mto_body`, `bento_live_body`,
`how_step_3_body`. Deliberately surgical: the older section copy already
went through the 86eye3p6z audit, and blanket rewrites in three locales
rot translation quality faster than they add polish.

Two mobile-carousel follow-ups (owner-caught):

- **Equal card heights**: `h-full` on a carousel SLIDE defeats the flex
  track's `align-items: stretch` (an explicit height beats stretch), so
  bento cards ranged 234–423px. Scoping it to `md:h-full` lets flexbox
  equalize the mobile track (all cards now match the tallest); applied to
  the bento and problem-strip slides.
- **Pro centered on mobile pricing — Embla** (`embla-carousel-react`, the
  engine under shadcn's Carousel; first cut tried CSS `snap-center` + a
  `scrollLeft` park, which can't truly center edge slides — owner sent it
  back). The shared `CenterSnapCarousel` + `centerSnapSlideClass` in
  `landing-ui.tsx`: `align: "center"`, `startIndex: 1` parks Pro
  dead-center with Starter/Scale peeking, drag physics free, and the
  `(min-width: 768px)` breakpoint sets `active: false` so md+ hands the
  same flex container to the desktop grid classes untouched. Used by BOTH
  the landing teaser and `/pricing`'s tier cards (whose stacked mobile
  view became the same carousel). This is the CENTERPIECE rail pattern;
  ordinary rails keep the house CSS snap classes. `pt-4` on the flex
  container keeps the "Most popular" badge inside Embla's overflow clip.

## Deliberately unchanged / out of scope

- **`src/components/landing/money-math.tsx`, `payment-handshake.tsx`,
  `payment-methods.tsx`, `problem-strip.tsx`, `how-it-works.tsx`,
  `feature-grid.tsx`, `faq.tsx`** — the plan that scoped this pass sketched a
  simpler from-scratch 10-section skeleton, but these sections carry real,
  audited, test-guarded funnel work from `86eye3p6z` (see
  [`landing-funnel.md`](./landing-funnel.md)). Rebuilding them wasn't
  something Arif asked for, so they're untouched.
- **`/pricing`** (`src/routes/pricing.tsx`) — its own Founding 10 banner,
  hardcoded MYR pricing and section order are all out of scope; only `/`
  changed.
- **Cloudflare geo-detection** — see the pricing section above; the
  time-zone heuristic is the interim, `request.cf.country` is the follow-up.
