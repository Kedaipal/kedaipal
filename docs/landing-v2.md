# Landing v2 — eight sections, the before/after hero, the Delivery section

Branch `claude/z8r3fdegej-landing-v2` · ClickUp [z8r3fdegej](https://app.clickup.com/t/z8r3fdegej) · dev
Design: Claude Design project "Delyva Landing Page UI Mockups" → `Landing v2.dc.html`
(+ the written `Landing Review` page), approved by Arif 12 Sep 2026.
**Enhancement pass, 15 Oct 2026:** mocks + CSS-only motion studies on the
[Landing enhancement canvas](https://claude.ai/artifact/HrgVLBtMX1EvHFsnBdsS67)
(artboards 1–7, motion M1–M4), approved by Arif with his edits. Section order
unchanged; what moved is below under *October 2026 enhancement pass*.

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
| Payment handshake mock | [`payment-handshake.tsx`](../src/components/landing/payment-handshake.tsx) |
| Tests | `couriers.test.ts`, `landing-faq.test.ts`, `useBeatLoop.test.tsx`, `delivery.test.tsx`, `hero-stage.test.tsx`, `payment-handshake.test.tsx`, the `landing-redesign.test.ts` "cut sections stay cut" + "nothing is sent after the confirmation" guards |

## Section order

**Since 19 Oct 2026 (z8r3fdtpub, the showcase pass — see
[Demo-first and the seller-flow walkthrough](#demo-first-and-the-seller-flow-walkthrough-19-oct-2026)):**

`Nav → Hero (+ marquee) → Video demo → Real sellers → **Seller flow
walkthrough** → Payment methods → **Fit check** → Pricing → FAQ → Final CTA →
Footer`, plus the floating **WhatsApp dock**.

Landing v2 as shipped on 13 Sep 2026 (the Delivery and Handshake sections
below are historical — their mocks live on inside the walkthrough):

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

**The stage** (`hero-stage.tsx`) is a navy 16:9 frame that acts the order out
twice, in six story beats (~11 s, then a short fade and it loops):

| Beat | WhatsApp alone (left) | Kedaipal (right) |
|---|---|---|
| 0 | Aina's order is the newest chat; 12 unread | inbox at rest, two settled orders |
| 1 | a school group lands on top; 27 unread | the order **hands across** — a chip arcs from the chat into the inbox, the card slides in, *Pending*, toast "New order from Aina · RM 181" |
| 2 | a supplier chat lands; Aina's row sinks and dims; 43 unread | *Buyer marked paid*, toast "Aina tapped I've paid" |
| 3 | "Missed · RM 181" stamp slams on her row; 61 unread | *Confirmed · Paid*, toast "Payment confirmed · receipt on her order page" |
| 4 | — | *Shipped · J&T* with the truck, toast "Tracking number on her order page" |
| 5 | — | **Mira's flash-sale order** (ORD-0183, RM 96) lands ABOVE Aina's with a "Flash sale −20%" source tag, "New · 1" flips to "New · 2", toast "Flash sale · 14 of 30 sold · ends in 1h 52m" |
| 6 | fade | fade |

Beat 5 is the page's one sentence about promotions, flash sales and vouchers,
acted rather than listed (Oct 2026). The toast is anchored above the tab bar
and the list clips under it, so as cards land on top the settled rows at the
bottom fall out of view — a real inbox. Statuses use the dashboard's own
`status-badge.tsx` colours over `bottom-nav.tsx` tabs; each live card's slot
opens from `0fr` to `1fr` so the rows below slide down rather than jump.
RM 181 is the best seller's real average ticket (COMPANY_STATE, 8 Sep): one
missed order costs more than the subscription. The toasts never say a receipt
or tracking number was *sent*: nothing is, after the confirmation
(`one-message-per-order.md`), and `landing-redesign.test.ts` fails any
`hero_*`/`handshake_*` key that says so.

Decisions:

- **CSS only.** The Lighthouse AC (mobile perf ≥ 90) rules out video, 3D and
  per-frame JS: `useBeatLoop` flips a beat index, `transition-*` classes move
  things, and keyed remounts replay the `kp-*` keyframes (`row-in`, `stamp`,
  `handoff`, `card-in`, `toast-in`, `drive`, `pop` — all transform/opacity,
  all stopped by the reduced-motion block). Reduced motion renders the last
  story beat as a still: both arrivals in, the stamp down, the order shipped.
- **Container-query units.** Every size inside the stage is `em` off a root
  font-size set in `cqw`, so the composition scales with the stage instead of
  overflowing it at `md` — the phone sits fully inside the frame at 390 and
  1280 (verified by screenshot). On desktop the Before card and the phone
  stand at ONE height on the stage floor, a fixed gap between them, each pill
  label centred directly above its card (artboard 1). Below `md` the stage is
  3:4 and the page's argument survives: a compact **Before strip** (the
  "Before · WhatsApp alone" pill, the unread badge counting 12 → 27 → 43 → 61
  with a scale bump per tick, Aina's row dimming, the "Missed · RM 181" stamp
  with one red pulse) sits above the mint "After" pill and the phone, which
  takes the stage's remaining height and runs off its bottom edge (artboard 2
  / M2). The chat list and the hand-off chip stay desktop-only.
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
stops a data edit shipping a broken mark. Seventeen Malaysian rows (Delyva
MY's public partner network — J&T, Ninja Van, Pos Malaysia, DHL eCommerce,
City-Link, Flash, Line Clear, Pickupp, Teleport, Aramex, SF Express — the cold
lanes Ninja Cold, Chill Freshbox and DD Express, and the riders Lalamove,
GrabExpress and pandago), each row naming where its mark came from.

**Marks (13 Sep 2026).** Every visible courier carries its own mark under
`public/img/courier/`, found by one agent per courier with a fixed source
order: the brand's site or press kit, then a Wikimedia Commons file that
reproduces the official mark, then an official PNG. SVG wherever one exists.
Two brands publish no vector at all (Line Clear, DD Express), so those are
small transparent PNGs — the only rasters on the landing, capped at 40 KB by
`couriers.test.ts`, which also still rejects a base64 raster wearing an
`.svg` extension. Two identity findings from the hunt are encoded rather than
papered over: **Ninja Cold has no mark of its own** (it is Ninja Van's
cold-chain lane), so its row `borrowsMarkFrom` Ninja Van and the chip renders
the lane's name beside the mark — a test pins that a borrowed mark points at a
real parent in the same region and shares its file; and **"Chill Freshbox" is
Delyva's label for Line Clear's FreshBox lane**, whose own FreshBox lockup is
the mark. **Qxpress became TracX Logis in Nov 2024**, so the hidden SG row
carries the new name. Marks are third-party trademarks used to state a fact
("you can book X"), never to imply endorsement.

**The dispatch card's first beat is a state, not a gap** (Oct 2026, artboard 3
/ M3): three shimmering skeleton rows (`animate-kp-shimmer`) hold the list's
height — one row for SG, which asks one rider — the label reads "Asking 20+
couriers…" ("Asking Lalamove for a quote…" where no parcel lane is live) and
the book button is a disabled grey "Getting quotes…" with a spinner. Then the
quotes stagger in, the cheapest highlights, and the button walks **Book →
Booked** (tick scales in) **→ Shipped** (truck slides in). The button never
names a courier before a quote exists; `delivery.test.tsx` pins the asking
beat and the four button states. Reduced motion shows the shipped frame.

**Catalogue:** grid on `md+`, one auto-scrolling rail below it (seventeen tiles
two-up ran 1,300 px on a phone in the design review); a region with fewer than
four couriers gets the grid at every size, because a rail looping one logo
reads as broken. Cold-chain rows carry a "COLD" pill. The rail and the payment
wall render the identical chip — `logoPillClass` + `LogoMarqueeRow` in
`landing-ui.tsx` are shared on purpose.

**Singapore, honestly.** The Delyva SG tenant had no service providers behind
it on 3 Sep (`docs/delivery-delyva.md`), so every SG parcel row ships
`visible: false`; the SG view shows Lalamove (live) and the line "Delyva parcel
couriers for Singapore are being enabled". `couriers.test.ts` pins that SG
never shows a Delyva courier that isn't enabled — flip a row's `visible` when
Delyva confirms it and the test asks you to say so.

The honesty runs all the way up the section (review on #275 — the first cut
gated only the note and the rider bullet, and left "Cold chain included" and
"20+ couriers, chilled or frozen" over a one-courier catalogue). With no parcel
lane live (`hasParcelCouriers` false) the heading, sub and first bullet switch
to `delivery_*_rider` variants that name Lalamove, and the cold-chain bullet
drops. Each courier row now carries a `provider` (`delyva` | `lalamove`):
Lalamove is a BYO integration paid from the seller's own Lalamove wallet
(`docs/delivery-lalamove.md`), not a Delyva partner, so the mock card's badge,
"charged to…" note and shipped line read the provider off the quoted row
instead of saying "Delyva credit" beside a Lalamove quote. The shipped line is
`delivery_quote_shipped` with the booked courier's name — it used to borrow the
hero's literal "Shipped · J&T", which was right for MY only because J&T
happens to be the cheapest mock quote, and wrong for SG every cycle.
`delivery.test.tsx` now drives the beat loop (mocked `useInView`, one `act`
per beat) to the shipped frame in both regions rather than freezing it at
beat 0.

## Demo-first and the seller-flow walkthrough (19 Oct 2026)

ClickUp [z8r3fdtpub](https://app.clickup.com/t/z8r3fdtpub) (T1 + T2 + T3) with
[z8r3fdhj8p](https://app.clickup.com/t/z8r3fdhj8p) items 2, 3, 4 and 9 ·
mockups on the [Landing showcase redesign](https://claude.ai/artifact/2pYxCzQjMymUJwGHQDJAft)
canvas, approved by Arif 19 Oct.

**Why.** GA4, 21 Sep–18 Oct: `/` took 498 sessions in 28 days, held them for
6m25s, and 2.8% clicked a sign-up CTA — while every payer to date had closed
on a demo or a referral. The page held attention and asked for the wrong
thing. On a 390px phone it also ran 11,420px with no CTA between the hero's
link (y=381) and the pricing card (y=8,007).

| Piece | Where |
|---|---|
| The one accent ask + the sign-up text link + the badge | `DemoPill`, `StartFreeLink`, `CommissionBadge` in [`landing-ui.tsx`](../src/components/landing/landing-ui.tsx) |
| The walkthrough | [`seller-flow.tsx`](../src/components/landing/seller-flow.tsx), its clock [`seller-flow-timeline.ts`](../src/components/landing/seller-flow-timeline.ts), `useTimeline` in [`useBeatLoop.ts`](../src/hooks/useBeatLoop.ts) |
| The mocks it plays | `AfterPhone` ([`hero-stage.tsx`](../src/components/landing/hero-stage.tsx)), `HandshakePanes` ([`payment-handshake.tsx`](../src/components/landing/payment-handshake.tsx)), `DispatchCard` + `CourierCatalogue` ([`delivery.tsx`](../src/components/landing/delivery.tsx)) — all take `beat` from the walkthrough |
| The fit check | [`fit-check.tsx`](../src/components/landing/fit-check.tsx) |
| The dock | [`wa-dock.tsx`](../src/components/landing/wa-dock.tsx), [`useSectionVisibility.ts`](../src/hooks/useSectionVisibility.ts) |
| Funnel event | `demo_cta` (`placement`) — [`analytics.md`](./analytics.md) |
| Copy | `flow_*`, `fit_*`, `dock_*`, `commission_badge`, `book_demo_cta_long` in `messages/*.json` |
| Tests | `seller-flow.test.tsx`, `seller-flow-timeline.test.ts`, `cta.test.tsx`, `wa-dock.test.tsx`, `useSectionVisibility.test.tsx`, `fit-check.test.tsx`, `real-sellers.test.tsx`, the rewritten `payment-handshake.test.tsx` and `delivery.test.tsx`, and new guards in `landing-redesign.test.ts` |

**Demo-first (T1).** "Book a demo on WhatsApp" is the mint pill in the hero,
the nav bar, the final CTA and `/pricing`'s close; "Start free — pay when you
sell" is the text link under it everywhere. 86eye3p6z §C still holds — one
KIND of accent pill on the page — and it is now the demo. The guarantee line
came back under the hero's CTA pair (it is what a demo promises). The
commission badge, "Flat fee. Never a cut of your sales." (Arif, 14 Oct), rides
the hero, the pricing teaser and `/pricing`; credits are live, so the true
claim is "no cut", never "zero fees". Pricing cards went outline. Signed-in
sellers keep `Go to Dashboard` on every surface. Every demo link fires
`demo_cta` with its placement — the two-week read is demo clicks per 100
visits against sign-up clicks, and demo-booked → paid against sign-up → paid.

**The walkthrough (T3).** One navy frame, three steps, the real UI: **01** the
order lands in the Orders inbox (`AfterPhone`, beats 0–1), **02** the buyer's
order page and the seller's order card walk the handshake (`HandshakePanes`,
`HANDSHAKE_BEATS`), **03** the dispatch card quotes, books and ships
(`DispatchCard`, `DISPATCH_BEATS`) with the courier catalogue under it. The
three beat tables are flattened into ONE timeline (`TIMELINE`, 13 steps), so
the mocks stay the source of their own stories and the walkthrough cannot
drift from them; the mocks' old reset beats went — the frame cross-fades
between phases instead. **All three phases stay mounted in ONE grid cell**,
the inactive two `invisible` at their last beat: the tallest phase sets the
frame's height, so a swap never reflows the section or the page (the first
cut mounted one phase at a time and the fresh reviewer measured the heading
jumping 159px and `#payments` 318px on every loop at 1440). `useTimeline` is
`useBeatLoop` with a `goTo`: a click on a step jumps there and the
auto-advance resumes; hovering the frame pauses it and the bubble says
"Paused while you look". Reduced motion renders each phase's LAST beat as a
still, never advances by itself, and the step buttons still page through. The
frame mounts its mocks only once near the viewport and is `aria-hidden`; the
step copy (`flow_step_*`) carries the content, and each step button's
accessible name is "Step N: title body" (a visually-hidden prefix — an
`aria-label` would have replaced the copy and left the section silent to a
screen reader). The courier catalogue sits OUTSIDE the frame on every
breakpoint: it is information, not decoration. A WhatsApp bubble in the corner says
what the buyer gets at each step — the one message per order, then the order
page. Phase 03 follows the region: Singapore gets the rider-only step copy,
Lalamove on the card, no chilled or frozen pill, and the "being enabled"
note, exactly as the Delivery section did. The hero's inbox, the handshake and the card now tell ONE order
(ORD-0182 · Aina · RM 181 from Kedai Daging Amir — truth fix 4, pinned by
`landing-redesign.test.ts`). Not taken from the ticket's T3 list: the hero
split-card chips, the count-ups, the pill shimmer and the comparison row —
motion on a 174-visitor page, and a comparison needs claims we can prove.

**The fit check (T2).** The three locked ICP gates (RM2,000+ a month through
WhatsApp · money changes hands on every order · sells every week, all year)
as three cards before pricing, with the "not yet for you" row — the filter —
and an outline WhatsApp link for the unsure (`fit_wa_message`, its own ask).
The RM2,000 floor is test-pinned in every locale.

**The dock (T1).** One pill, "Book a demo on WhatsApp": a bottom bar on a
phone above the home indicator, a single pill bottom-right on desktop. It
appears once the hero has scrolled out, hides while the final CTA or the
footer is on screen (a phone's footer is taller than the viewport, and the
dock sat on its last lines), never shows to a signed-in seller (every other
surface gives them their dashboard door; the dock is a prospect's tool), and
never renders on SSR or first paint (`useSectionVisibility` is `null` until
the observer reports). The first cut copied docket.io's per-section question
chips beside the pill; three loose bubbles stacked bottom-right read as
clutter on sight (Arif, 19 Oct) and the hero already asks the one question
that matters, so the chips, their copy and the section-tracking hook went.

**Truth fixes that rode along (z8r3fdhj8p).** FAQ 1 and the final CTA stop
promising "live in 5 minutes"; the guarantee line is the one time-to-live
claim (test: no landing key says five minutes). FAQ 8 keeps the locked
"pay when you sell" and states the day-15 invoice as the backstop it is —
`docs/pricing.md`: a store with no order by day 15 gets its first invoice
then — rather than leaving the two to read as a contradiction. The proof rail
shows the five kinds the demo video names and drops the navy "why they
switch" closer with its founder metrics; a named seller quote waits on the
seller. The nav's first anchor is `/#flow` ("How it works").

## One region for the page

Two sections react to MY/SG (the seller-flow walkthrough — Delivery until 19 Oct 2026 — and Pricing). Each owning its own
`useLandingRegion()` would give the page two toggles that can disagree for a
render — the cookie write is shared, the React state was not. `index.tsx`
mounts `LandingRegionProvider`; both sections read
`useLandingRegionContext()`, so either toggle moves both. `/pricing`, `/cost`
and onboarding keep the plain hook (one toggle each). The context hook is
provider-only and throws without one: the first cut fell back to a private
hook instance, which — hooks being unconditional — ran a second router
subscription and cookie/Intl effect in every consumer even under the provider.
Tests wrap the section in `LandingRegionProvider`.

## Pricing, FAQ, structured data

- **Prices** arrive from `PLAN_MONTHLY_PRICES` (Zaki's
  [#270](https://github.com/Kedaipal/kedaipal/pull/270) lands RM399/S$149); the
  JSON-LD `AggregateOffer` range is now **derived** from the same constant — the
  previous literal `"299"` outlived the reprice by weeks because nothing tied
  it to what the teaser rendered.
- **Start-when-you-sell copy** (`nav_start_free`, `pricing_sub`,
  `pricing_cta`, `faq_q_8/a_8`, `final_sub`, `final_cta`, the landing
  `SEO_DESC` and offer description) is the wave-2 pack in
  `docs/pricing-reset-copy-pack.md`, verbatim. `hero_trust` from that pack is
  retired: its only render site (the old hero's trust line) was cut with the
  old hero, so the key went with it. `landing-redesign.test.ts` fails on
  "14-day" / "RM299" in any key a landing section renders, and on any retired
  key coming back.
- **Meta description** is held under 155 chars with "no Meta setup" inside the
  cut by `landing-seo.test.ts` — the wave-2 redraft ran to 173 and pushed the
  differentiator to char 159 while its comment claimed otherwise. The regions
  live in the title and Organization description, not the snippet.
- **FAQ** gains "Which couriers can I book?" (`faq_q_13`) as the third primary
  item; seven primary, six behind "See all". The `FAQPage` JSON-LD is built
  from the same `FAQ_PRIMARY_IDS` and message functions the component renders,
  pinned to English via paraglide's locale override — `landing-faq.test.ts`
  proves the mirror verbatim and in order, which used to be a comment asking
  the next editor to remember.
- **Nav** is the design's link set: Delivery · Payments · Pricing · FAQ.
  `trackSignupCta` placements: `hero`, `nav`, `nav-mobile`,
  `pricing-teaser-<tier>`, `final-cta`; `hero-secondary` retired with the link.

## October 2026 enhancement pass

Arif's 15 Oct review against everything shipped since mid-September (credits,
the pause plan, team members, events, promotions, flash sales, vouchers, the
store directory, Deliveries, HitPay as the one way to pay): the page only
argued "lose fewer orders", two animated mocks opened on a blank beat, the
before/after hero was desktop-only, and the handshake section still described
messages deleted on 4 Aug 2026. Everything below was mocked on the
[enhancement canvas](https://claude.ai/artifact/HrgVLBtMX1EvHFsnBdsS67) first.

### The handshake section acts out the real flow

The live section acted out a chat bubble ("Dah transfer ya kak"), a seller
card and a "✅ Payment received" WhatsApp with a receipt link — the pre-August
story. Since `86eyd63r8` the buyer is never messaged after checkout: they pay
from **How to pay** on their `/track` order page, tap **I've paid**, attach the
mandatory screenshot (`z8r3fdnpxf`) and submit; the seller's order flips to an
amber **Payment claimed** card with the screenshot and reference (plus a
WhatsApp to the SELLER on Pro, `86eyhw9zy`), the seller taps **Mark payment
received**, and both sides flip to green — the buyer's page live, receipt PDF
on it, no WhatsApp sent.

`payment-handshake.tsx` is now that, as two panes (artboard 4 / M4): the
buyer's phone beside the seller's order card, on `useBeatLoop` with CSS-only
beats like the hero stage (the framer `AnimatePresence` stack is gone):

| Beat | ms | Buyer · their order page | Seller · the order in Kedaipal |
|---|---|---|---|
| 0 | 1200 | **How to pay** — Maybank + Copy, DuitNow QR + Save QR, reference hint, mint **I've paid** | **Payment · Unpaid**, "Waiting for the buyer…", *Pending* |
| 1 | 800 | tap (press + ring); the sheet slides up, screenshot field first, submit held with its reason | — |
| 2 | 1200 | the screenshot lands (thumbnail, Replace), **Submit** goes live | — |
| 3 | 1800 | tap; the sheet drops; **Waiting for Kek Sayang to confirm** · "This page updates by itself" | amber **Payment claimed** (breathing) with the screenshot, reference + Copy, method, "Check your bank app"; the Pro WhatsApp alert drops in: "Aina says they've paid · ORD-0042 · RM 76.00" |
| 4 | 600 | — | tap on **Mark payment received** (press + ring); the alert lifts |
| 5 | 1900 | **✓ Payment received · RM 76.00**, **Download receipt (PDF)**, Status: Confirmed | **✓ Payment received · auto-confirmed**, the customer's proof, "Receipt PDF generated · on the buyer's order page and in your exports", *Confirmed*, and the caption **"No WhatsApp sent to Aina. Her order page flipped by itself — one message per order."** |
| 6 | 500 | fade | fade |

The copy changed with it: `handshake_body_2` ("…their page flips to paid with
the receipt on it — nothing to send") and `handshake_point_3` (receipt and
invoice PDFs appear on the buyer's order page and in your exports); the
heading stays. The seven `handshake_chat_*`/`handshake_card_*` keys are
retired and pinned gone. Layout: side by side from a 30rem-wide column
(`@container`, em = a clamped slice of the width), stacked below it — a 390
phone can't hold both at a legible size; the mock column takes the wider half
of the section grid. Reduced motion shows beat 5 as a still; beat 0 is a
state, so the frame is never blank.

### Pricing teaser, FAQ, proof

- **Pro** gains "Promotions, flash sales & voucher codes" right under online
  payments (Pro-gated: `convex/vouchers.ts`, `promo-price.md`), its tagline
  becomes "Orders, payments and promotions", and the team line reads "You + 2
  teammates — each sees only what you allow" (the per-area grants, said where
  the seats are bought; the key is shared with `/pricing`). Enterprise's
  "Multiple outlets — Soon" is "Per-outlet stock & reporting — Soon": several
  pickup points sharing one stock count already ships (the proof rail says
  so), and the row now names what doesn't.
- **FAQ**: `faq_q_9/a_9` rewritten around the pause plan (RM 19 / S$9 a month,
  everything kept, storefront says "on a break", resume in one tap — the price
  is spelled in because FAQ answers render param-less for the FAQPage mirror,
  and `landing-faq.test.ts` pins it to `HOLD_MONTHLY_PRICES` in every locale,
  the way `faq_a_8` is pinned to the trial constants). Three new questions:
  promotions/flash sales/vouchers (14), "Can my helper use it without seeing
  my bank details?" (15), "I'm in Singapore, or my buyers are overseas" (16).
  Primary order by the file's argument: setup → payments → **sell more (14)**
  → couriers → the fit-my-shop questions (stall, custom-made, **helper (15)**,
  **Singapore (16)**) → data → who; ten primary (all in the JSON-LD), six
  behind "See all", the pause question first among them.
- **Real sellers**: the "10+ paying sellers" chip and its two keys are gone
  from `/` and the `/pricing` band (a hand-typed number nothing kept true;
  the band leads with "Running on Kedaipal today." instead). A caption
  under the rail states the directory as a benefit: every store is listed
  free on kedaipal.com/stores, we feature shops in showcases above the list,
  nothing to sign up for, switch it off in Settings → Store. Two placements
  were rejected on sight (Arif, 15 Oct): the canvas's boxed card with a
  "New" pill in the right column stretched that column and left the heading
  dangling, and a three-line paragraph under the heading read as a legal
  footnote — so it sits under the stores it is about, and the header keeps
  its two-column balance. The
  unsourced "Time to first 5: 20 days" stat is replaced by one the page can
  stand behind: "Meta verification · Not needed".
- **Small fixes**: `SEO_TITLE` names Malaysia & Singapore; the JSON-LD
  `AggregateOffer.offerCount` is derived from `PLAN_MONTHLY_PRICES` (2 listed
  tiers, not 3 — Enterprise has no public price); the brand marks inside the
  drifting marquees (payment wall, courier rail) load `eager` (a new
  `AppImage` prop: no lazy attribute, normal priority — a lazy mark only
  started loading as its pill entered the viewport, so pills drifted in empty).

### Not done here

- The hand-off chip's text stays "ORD-0182 · Aina · RM 181.00" (M1 drew
  "RM 181 → order"); the arc itself already shipped in v2.
- MS/ZH copy for every new and changed key is drafted, not reviewed — Arif
  reads it before release.

## Verified

Enhancement pass (15 Oct 2026): rendered signed-out at 390 and 1280 with the
Playwright MCP (the in-app pane screenshots white when hidden), light + dark,
reduced motion; typecheck, explicit-path lint, full vitest.

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
