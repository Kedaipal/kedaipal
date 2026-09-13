# Landing v2 — eight sections, the before/after hero, the Delivery section

Branch `claude/z8r3fdegej-landing-v2` · ClickUp [z8r3fdegej](https://app.clickup.com/t/z8r3fdegej) · dev
Design: Claude Design project "Delyva Landing Page UI Mockups" → `Landing v2.dc.html`
(+ the written `Landing Review` page), approved by Arif 12 Sep 2026.

The live `/` ran fourteen sections, still carried the pre-8-Sep hero copy,
"14-day trial" in seven keys plus the meta description and JSON-LD, a hardcoded
`highPrice: "299"`, and said nothing about courier booking even though Delyva
is live for Malaysian sellers. This is the trim to eight, on the locked 8 Sep
positioning, with one new section.

| Piece | Where |
|---|---|
| Composition + structured data | [`src/routes/index.tsx`](../src/routes/index.tsx) |
| Hero copy + stage | [`hero.tsx`](../src/components/landing/hero.tsx), [`hero-stage.tsx`](../src/components/landing/hero-stage.tsx) |
| Delivery section + courier catalogue | [`delivery.tsx`](../src/components/landing/delivery.tsx), [`src/lib/couriers.ts`](../src/lib/couriers.ts) |
| One region for the page | `LandingRegionProvider` in [`useLandingRegion.ts`](../src/hooks/useLandingRegion.ts) |
| Acted-out mocks' clock | [`src/hooks/useBeatLoop.ts`](../src/hooks/useBeatLoop.ts) (hero stage, dispatch card, payment handshake) |
| FAQ ↔ JSON-LD mirror | [`src/lib/landing-faq.ts`](../src/lib/landing-faq.ts), `FAQ_MESSAGES` in [`faq.tsx`](../src/components/landing/faq.tsx) |
| Copy (en / ms / zh) | `messages/*.json` — `hero_*`, `delivery_*`, `faq_q_13`, `nav_*`, the wave-2 pricing strings |
| Tests | `couriers.test.ts`, `landing-faq.test.ts`, `useBeatLoop.test.tsx`, `delivery.test.tsx`, `hero-stage.test.tsx`, the `landing-redesign.test.ts` "cut sections stay cut" guard |

## Section order

`Nav → Hero (+ seller-kinds marquee) → Video demo → Real sellers → Payment
handshake → **Delivery** → Payment methods → Pricing → FAQ → Final CTA → Footer`

Cut, and why (from the design review):

- **Problem strip** — the two pains already ride the hero headline.
- **How it works** — the demo video *is* the how-it-works; both ran the same arc.
- **Features bento** — seven cards, four of which restated handshake, delivery
  or proof. Counter QR and made-to-order survive in the seller cards and FAQ.
- **Money math** — a marketplace-cut argument none of the paying accounts came
  off a marketplace for; the pricing headline already says "no cut of your
  sales". `MoneyMathRow` stays for `/pricing`.

Everything those four sections owned went with them: components, the
`how-*` collages (`public/img/landing/`, `assets/landing/`), 126 message keys
across three catalogs, the `carouselTrackClass`/`carouselSlideClass`/`QrPattern`
primitives, the `kp-kenburns` keyframes, and the `/#features` + `/#how` nav
anchors. `landing-redesign.test.ts` now pins the keys as gone, so a merge can't
resurrect a section by accident.

## Hero — text on top, the stage underneath

The locked tagline ("Sell on WhatsApp. / Never lose an order or a payment.",
mint highlight on the second line), one sub line, one mint button, "Book a
demo" as a text link. The badge, pain stickers, trust row and guarantee line
all left this section ("the text on top is too much info — make it concise so
the animation takes half the viewport"); the guarantee still rides the pricing
teaser and the closing CTA, where a visitor is deciding.

**The stage** (`hero-stage.tsx`) is a navy 16:9 frame: on the left a WhatsApp
inbox with orders buried under an unread count that only climbs (12 → 27 → 43
→ 61) and a "Missed · RM 181" stamp; on the right the Kedaipal Orders inbox,
grounded in the dashboard's own `status-badge.tsx` colours and `bottom-nav.tsx`
tabs, where the same order walks **Pending → Buyer marked paid → Confirmed ·
Paid → Shipped · J&T** with a toast per beat. RM 181 is the best seller's real
average ticket (COMPANY_STATE, 8 Sep): one missed order costs more than the
subscription.

Decisions:

- **CSS only.** The Lighthouse AC (mobile perf ≥ 90) rules out video, 3D and
  per-frame JS: `useBeatLoop` flips a beat index, `transition-*` classes move
  things, and a keyed remount replays the `kp-pop` keyframe on the badge, stamp
  and toast. Reduced motion renders the final beat as a still.
- **Container-query units.** Every size inside the stage is `em` off a root
  font-size set in `cqw`, so the composition scales with the stage instead of
  overflowing it at `md` — the phone sits fully inside the frame at 390 and
  1280 (verified by screenshot). Below `md` the stage is 3:4 and shows the
  Kedaipal inbox only, at ~2.5× the desktop scale, with the mint "After" pill
  centred above the phone; the "Before" card is desktop-only.
- **Solid pills, not captions.** The first cut's labels were faint text on the
  navy ground behind the cards; they are white/mint pills on top now.
- **The marquee stays** under the stage as the bridge into the demo, re-cut to
  the roster's kinds (premium meats, central kitchens, apparel drops, gear care,
  fresh fish, campsites, pre-order menus, deposits & invoices, gyms, home
  caterers, custom prints, service bookings) — never cakes or kuih first
  (`04_Brand/brand-taglines.md`).

## Delivery — "Book the courier from the order. Cold chain included."

Left: the claim, three bullets (own Delyva account and rates · parcel, chilled
or frozen per order · Lalamove same-day, hidden when no rider is live for the
region), the courier catalogue, a footnote. Right: a mock of the real dispatch
card (`delyva-dispatch-card.tsx` — weight, parcel-type pills, the quote list
with the cheapest pre-selected and "Buyer paid" beside it, the book button)
that loops quotes → chosen → booked → shipped.

**`src/lib/couriers.ts` is the same pattern as `payment-methods.ts`:** one
config array, `couriersFor(country)`, `mockQuotes(country)`, and a test that
stops a data edit shipping a broken mark. A row without `src` renders the
initials avatar the real dispatch card uses for a courier we hold no logo for
(the card "must render identically offline"), never a hot-linked PNG — the
design mock's placeholders were exactly that, and the AC requires local
brand-approved assets in `public/img/courier/`. **Drop the SVG in and add `src`
to promote a chip to a mark; no component change.** Only Lalamove has a mark
today; the Delyva partner logo pack is the ticket's open dependency.

**Catalogue:** grid on `md+`, one auto-scrolling rail below it (seventeen tiles
two-up ran 1,300 px on a phone in the design review). Cold-chain rows carry a
"COLD" pill. The rail and the payment wall render the identical chip —
`logoPillClass` + `LogoMarqueeRow` in `landing-ui.tsx` are shared on purpose.

**Singapore, honestly.** The Delyva SG tenant had no service providers behind
it on 3 Sep (`docs/delivery-delyva.md`), so every SG parcel row ships
`visible: false`; the SG view shows Lalamove (live) and the line "Delyva parcel
couriers for Singapore are being enabled". `couriers.test.ts` pins that SG
never shows a Delyva courier that isn't enabled — flip a row's `visible` when
Delyva confirms it and the test asks you to say so.

## One region for the page

Two sections now react to MY/SG (Delivery, Pricing). Each owning its own
`useLandingRegion()` would give the page two toggles that can disagree for a
render — the cookie write is shared, the React state was not. `index.tsx`
mounts `LandingRegionProvider`; both sections read
`useLandingRegionContext()`, so either toggle moves both. `/pricing`, `/cost`
and onboarding keep the plain hook (one toggle each). The context hook falls
back to a private hook instance with no provider, so a section still renders
in isolation.

## Pricing, FAQ, structured data

- **Prices** arrive from `PLAN_MONTHLY_PRICES` (Zaki's
  [#270](https://github.com/Kedaipal/kedaipal/pull/270) lands RM399/S$149); the
  JSON-LD `AggregateOffer` range is now **derived** from the same constant — the
  previous literal `"299"` outlived the reprice by weeks because nothing tied
  it to what the teaser rendered.
- **Start-when-you-sell copy** (`nav_start_free`, `hero_trust`, `pricing_sub`,
  `pricing_cta`, `faq_q_8/a_8`, `final_sub`, `final_cta`, the landing
  `SEO_DESC` and offer description) is the wave-2 pack in
  `docs/pricing-reset-copy-pack.md`, verbatim. `landing-redesign.test.ts` fails
  on "14-day" / "RM299" in any key a landing section renders.
- **FAQ** gains "Which couriers can I book?" (`faq_q_13`) as the third primary
  item; seven primary, six behind "See all". The `FAQPage` JSON-LD is built
  from the same `FAQ_PRIMARY_IDS` and message functions the component renders,
  pinned to English via paraglide's locale override — `landing-faq.test.ts`
  proves the mirror verbatim and in order, which used to be a comment asking
  the next editor to remember.
- **Nav** is the design's link set: Delivery · Payments · Pricing · FAQ.
  `trackSignupCta` placements: `hero`, `nav`, `nav-mobile`,
  `pricing-teaser-<tier>`, `final-cta`; `hero-secondary` retired with the link.

## Verified

Preview at 390 / 768 / 1280 (light + dark, reduced motion): eight sections and
nothing else; the stage inside the first viewport at 1280 with the phone fully
inside the frame at both widths; MY ↔ SG swaps the courier rail, the quote
card's currency and the tier prices together; no "RM299" / "14-day" in the DOM.
Gate: lint, typecheck, full test suite, build.

## Deliberately not done here

- **Courier marks.** Chips until Delyva's brand-approved pack lands (config
  ready, test enforces SVG-and-exists).
- **`/pricing` wave-2 copy** (`pricingpage_*`) and the Off-Season Hold card —
  z8r3fday21's remaining scope, not this ticket's.
- **Seller-proof re-cut** to the seven paying kinds and a "Trusted by 30+"
  pill (the design review's note) — the ticket says "Real sellers — keep";
  logged as a follow-up.
- **Release notes** — `src/content/releases.ts` moves in the staging → main
  release PR per `docs/release-checklist.md`.
